import { ContactMessage } from '../db.js';
import { contactMessage, contactMessageStatus } from '../middleware/validate.js';
import { optionalOrderAuth, requireInquiryStaff, requireOrderAuth } from '../middleware/auth.js';
import { safeText } from '../utils.js';
import { runNotificationBatch } from '../notificationWorker.js';
import rateLimit from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { verifyTurnstileServerToken, verifyWithCloudflare } from '../turnstileVerify.js';

export const CONTACT_STATUSES = ['new', 'read', 'awaiting_staff', 'awaiting_customer', 'resolved'];
const MAX_ID_LENGTH = 64, MAX_REPLIES = 200, MAX_NOTES = 200, MAX_MESSAGE_LENGTH = 3000;
const customerOnly = (req, res, next) => requireOrderAuth(req, res, () => req.user?.role === 'customer'
  ? next() : res.status(403).json({ error: 'Customer access required.' }));
const asDate = value => value || null;
const serializeReply = reply => ({ replyId: reply.replyId, noteId: reply.noteId, message: reply.message, authorId: reply.authorId, authorName: reply.authorName, authorRole: reply.authorRole, createdAt: reply.createdAt });
const serializeContactMessage = (doc, { customer = false, includeDelivery = false } = {}) => ({
  id: doc.id, ...(customer ? {} : { userId: doc.userId || null }), senderName: doc.senderName,
  senderEmail: customer ? undefined : doc.senderEmail, subject: doc.subject, message: doc.message,
  senderType: doc.senderType, status: doc.status, createdAt: doc.createdAt,
  readAt: asDate(doc.readAt), resolvedAt: asDate(doc.resolvedAt), lastActivityAt: asDate(doc.lastActivityAt),
  isRegisteredCustomer: Boolean(doc.userId), replies: (doc.replies || []).map(serializeReply),
  ...(customer ? {} : { internalNotes: (doc.internalNotes || []).map(serializeReply), ...(includeDelivery ? { notificationOutbox: (doc.notificationOutbox || []).map(item => ({ eventKey: item.eventKey, recipientRole: item.recipientRole, state: item.state, attempts: item.attempts, lastAttemptAt: item.lastAttemptAt || null, nextAttemptAt: item.nextAttemptAt || null, lastError: item.lastError || '', createdAt: item.createdAt })) } : {}) })
});
const replyLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many replies. Please wait before trying again.' }, standardHeaders: true, legacyHeaders: false });
const validReply = (req, res, next) => {
  const requestId = safeText(req.body?.requestId).trim();
  const message = safeText(req.body?.message).trim();
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(requestId)) return res.status(400).json({ error: 'A valid requestId is required.' });
  if (!message || message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: `Reply must be between 1 and ${MAX_MESSAGE_LENGTH} characters.` });
  req.validatedReply = { requestId, message };
  next();
};
const personName = user => safeText(user?.name || user?.email || user?.phone || 'BM Printing').trim().slice(0, 100);

async function appendConversation(req, res, { customer = false, internalOnly = false } = {}) {
  const id = safeText(req.params.id).slice(0, MAX_ID_LENGTH);
  const { requestId, message } = req.validatedReply;
  const owner = customer ? { userId: req.user.id, senderType: 'customer' } : {};
  const array = internalOnly ? 'internalNotes' : 'replies';
  try {
    const existing = await ContactMessage.findOne({ id, ...owner }).lean();
    if (!existing) return res.status(404).json({ error: 'Inquiry not found.' });
    if (!customer && existing.senderType === 'guest' && !internalOnly) return res.status(409).json({ error: 'Guest inquiries support internal notes only because no verified email delivery is configured.' });
    const prior = (existing[array] || []).find(item => item.requestId === requestId);
    if (prior) {
      if (prior.authorId !== req.user.id || prior.message !== message) return res.status(409).json({ error: 'This requestId was already used for a different reply.' });
      return res.json({ success: true, duplicate: true, deliveryState: internalOnly ? 'INTERNAL_ONLY' : undefined, message: serializeContactMessage(existing, { customer, includeDelivery: req.user.role === 'admin' }) });
    }
    const now = new Date(), role = req.user.role;
    const item = internalOnly
      ? { noteId: randomUUID(), requestId, message, authorId: req.user.id, authorName: personName(req.user), authorRole: role, createdAt: now }
      : { replyId: randomUUID(), requestId, message, authorId: req.user.id, authorName: personName(req.user), authorRole: role, createdAt: now };
    const notifications = internalOnly ? [] : customer
      ? [{ eventKey: `inquiry:${id}:reply:${item.replyId}`, recipientId: '*', recipientRole: 'admin', title: 'Customer inquiry reply', message: `${existing.senderName} replied to “${existing.subject}”.`, state: 'PENDING', createdAt: now }]
      : existing.userId ? [{ eventKey: `inquiry:${id}:reply:${item.replyId}:${existing.userId}`, recipientId: existing.userId, recipientRole: 'customer', title: 'BM Printing replied to your inquiry', message: `There is a new reply to “${existing.subject}”.`, state: 'PENDING', createdAt: now }] : [];
    const condition = { id, ...owner, [`${array}.requestId`]: { $ne: requestId }, $expr: { $lt: [{ $size: { $ifNull: [`$${array}`, []] } }, internalOnly ? MAX_NOTES : MAX_REPLIES] } };
    const set = { lastActivityAt: now };
    if (!internalOnly) {
      set.status = customer ? 'awaiting_staff' : 'awaiting_customer';
      set.resolvedAt = null;
      if (customer) set.readAt = now;
    }
    const update = { $push: { [array]: item }, $set: set };
    if (notifications.length) update.$push.notificationOutbox = { $each: notifications };
    const updated = await ContactMessage.findOneAndUpdate(condition, update, { new: true, runValidators: true }).lean();
    if (!updated) {
      const latest = await ContactMessage.findOne({ id, ...owner }).lean();
      if (!latest) return res.status(404).json({ error: 'Inquiry not found.' });
      const raced = (latest[array] || []).find(entry => entry.requestId === requestId);
      if (raced) return raced.authorId === req.user.id && raced.message === message
        ? res.json({ success: true, duplicate: true, deliveryState: internalOnly ? 'INTERNAL_ONLY' : undefined, message: serializeContactMessage(latest, { customer, includeDelivery: req.user.role === 'admin' }) })
        : res.status(409).json({ error: 'This requestId was already used for a different reply.' });
      return res.status(409).json({ error: `Inquiry ${internalOnly ? 'notes' : 'conversation'} limit reached.` });
    }
    // Delivery is a durable intent embedded atomically with the reply. A failure remains visible as pending.
    if (notifications.length) await runNotificationBatch({ limit: 20 }).catch(() => {});
    const finalDoc = notifications.length ? await ContactMessage.findOne({ id }).lean() : updated;
    res.status(201).json({ success: true, deliveryState: internalOnly ? 'INTERNAL_ONLY' : undefined, message: serializeContactMessage(finalDoc, { customer, includeDelivery: req.user.role === 'admin' }) });
  } catch (error) {
    console.error(`Inquiry reply failed: ${error?.name || 'Error'}`);
    res.status(503).json({ error: 'Unable to save this reply right now.' });
  }
}

export default function contactMessageRoutes(app, verifyCaptcha = verifyWithCloudflare, captchaOptions = {}) {
  const submitLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many messages sent. Please wait a few minutes and try again.' }, standardHeaders: true, legacyHeaders: false });
  app.post('/api/contact/messages', submitLimiter, optionalOrderAuth, contactMessage, async (req, res) => {
    const authenticated = req.authProvider === 'supabase' || req.authProvider === 'jwt' ? req.user : null;
    try {
      if (!authenticated) {
        const verdict = await verifyTurnstileServerToken(req.body?.turnstileToken, { ...captchaOptions, verifyToken: verifyCaptcha });
        if (!verdict.ok) return res.status(verdict.status).json({ error: verdict.message });
      }
      const created = await ContactMessage.create({ id: `MSG-${randomBytes(8).toString('hex')}`, userId: authenticated ? authenticated.id : null,
        senderName: safeText(req.body.name).trim(), senderEmail: safeText(req.body.email).trim().toLowerCase(), subject: safeText(req.body.subject).trim(), message: safeText(req.body.message).trim(),
        senderType: authenticated ? 'customer' : 'guest', status: 'new', lastActivityAt: new Date() });
      res.status(201).json({ success: true, message: serializeContactMessage(created) });
    } catch (error) { console.error(`Contact submission failed: database insert (${error?.name || 'Error'})`); res.status(503).json({ error: 'Unable to send your message right now. Please try again.' }); }
  });

  // Private customer conversation endpoints derive ownership from the verified session only.
  app.get('/api/customers/inquiries', customerOnly, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const messages = await ContactMessage.find({ userId: req.user.id, senderType: 'customer' }).sort({ lastActivityAt: -1, createdAt: -1 }).limit(100).lean(); res.json({ messages: messages.map(message => serializeContactMessage(message, { customer: true })) }); }
    catch { res.status(503).json({ error: 'Unable to load your inquiries.' }); }
  });
  app.get('/api/customers/inquiries/:id', customerOnly, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const found = await ContactMessage.findOne({ id: safeText(req.params.id).slice(0, MAX_ID_LENGTH), userId: req.user.id, senderType: 'customer' }).lean(); if (!found) return res.status(404).json({ error: 'Inquiry not found.' }); res.json({ message: serializeContactMessage(found, { customer: true }) }); }
    catch { res.status(503).json({ error: 'Unable to load this inquiry.' }); }
  });
  app.post('/api/customers/inquiries/:id/replies', customerOnly, replyLimiter, validReply, (req, res) => appendConversation(req, res, { customer: true }));

  app.get('/api/staff/messages', requireInquiryStaff, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const messages = await ContactMessage.find({}).sort({ lastActivityAt: -1, createdAt: -1 }).limit(500).lean(); const unread = await ContactMessage.countDocuments({ status: { $in: ['new', 'awaiting_staff'] } }); res.json({ messages: messages.map(message => serializeContactMessage(message, { includeDelivery: req.user.role === 'admin' })), unread, total: messages.length }); }
    catch { res.status(503).json({ error: 'Unable to load messages.' }); }
  });
  app.get('/api/staff/messages/:id', requireInquiryStaff, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { const found = await ContactMessage.findOne({ id: safeText(req.params.id).slice(0, MAX_ID_LENGTH) }).lean(); if (!found) return res.status(404).json({ error: 'Message not found.' }); res.json({ message: serializeContactMessage(found, { includeDelivery: req.user.role === 'admin' }) }); }
    catch { res.status(503).json({ error: 'Unable to load this message.' }); }
  });
  app.post('/api/staff/messages/:id/replies', requireInquiryStaff, replyLimiter, validReply, (req, res) => appendConversation(req, res, { internalOnly: false }));
  app.post('/api/staff/messages/:id/internal-notes', requireInquiryStaff, replyLimiter, validReply, (req, res) => appendConversation(req, res, { internalOnly: true }));
  app.patch('/api/staff/messages/:id/status', requireInquiryStaff, contactMessageStatus, async (req, res) => {
    res.set('Cache-Control', 'no-store'); const id = safeText(req.params.id).slice(0, MAX_ID_LENGTH), status = safeText(req.body.status);
    if (!CONTACT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });
    try {
      const current = await ContactMessage.findOne({ id }).lean();
      if (!current) return res.status(404).json({ error: 'Message not found.' });
      const now = new Date(), update = { status };
      if (status === 'read' || status === 'resolved') update.readAt = now;
      if (status === 'resolved') update.resolvedAt = now;
      if (status === 'new' || status === 'awaiting_staff' || status === 'awaiting_customer') update.resolvedAt = null;
      const eventId = randomUUID();
      const modifier = { $set: update };
      if (status === 'resolved' && current.status !== 'resolved' && current.userId) {
        update.lastActivityAt = now;
        modifier.$push = { notificationOutbox: { eventKey: `inquiry:${id}:resolved:${eventId}:${current.userId}`, recipientId: current.userId, recipientRole: 'customer', type: 'inquiry_resolved', title: 'Inquiry resolved', message: `Your inquiry “${current.subject}” was marked resolved.`, state: 'PENDING', createdAt: now } };
      }
      const updated = await ContactMessage.findOneAndUpdate({ id, status: current.status }, modifier, { new: true, runValidators: true }).lean();
      if (!updated) return res.status(409).json({ error: 'This inquiry changed. Refresh and try again.' });
      if (status === 'resolved' && current.status !== 'resolved' && current.userId) await runNotificationBatch({ limit: 20 }).catch(() => {});
      res.json({ success: true, message: serializeContactMessage(updated) });
    } catch { res.status(503).json({ error: 'Unable to update this message.' }); }
  });
}
