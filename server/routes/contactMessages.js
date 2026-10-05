import { ContactMessage } from '../db.js';
import { contactMessage, contactMessageStatus } from '../middleware/validate.js';
import { optionalOrderAuth, requireOrderStaff } from '../middleware/auth.js';
import { safeText } from '../utils.js';
import { verifyTurnstileServerToken, verifyWithCloudflare } from '../turnstileVerify.js';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';

export const CONTACT_STATUSES = ['new', 'read', 'resolved'];
const MAX_ID_LENGTH = 64;

// Only the fields staff need are ever returned. No auth metadata, tokens or
// provider internals are serialized into the response.
const serializeContactMessage = doc => ({
  id: doc.id,
  userId: doc.userId || null,
  senderName: doc.senderName,
  senderEmail: doc.senderEmail,
  subject: doc.subject,
  message: doc.message,
  senderType: doc.senderType,
  status: doc.status,
  createdAt: doc.createdAt,
  readAt: doc.readAt || null,
  resolvedAt: doc.resolvedAt || null,
  isRegisteredCustomer: Boolean(doc.userId)
});

export default function contactMessageRoutes(app, { verifyToken = verifyWithCloudflare } = {}) {
  const submitLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    message: { error: 'Too many messages sent. Please wait a few minutes and try again.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  // ── PUBLIC: guests and authenticated customers may both submit ──────────────
  app.post('/api/contact/messages', submitLimiter, optionalOrderAuth, contactMessage, async (req, res) => {
    // Identity comes only from the verified session. A client-supplied userId is
    // ignored entirely so a guest can never attach themselves to an account.
    const authenticated = req.authProvider === 'supabase' || req.authProvider === 'jwt' ? req.user : null;
    const senderType = authenticated ? 'customer' : 'guest';

    // Guests must clear Turnstile. Authenticated senders already proved identity.
    if (!authenticated) {
      const verdict = await verifyTurnstileServerToken(req.body?.turnstileToken, { verifyToken });
      if (!verdict.ok) {
        // Names the failing layer only. The token and the secret are never logged.
        console.error(`Contact submission failed: Turnstile verification (status ${verdict.status})`);
        return res.status(verdict.status).json({ error: verdict.message });
      }
    }

    const name = safeText(req.body.name).trim();
    const email = safeText(req.body.email).trim().toLowerCase();
    const subject = safeText(req.body.subject).trim();
    const message = safeText(req.body.message).trim();

    try {
      const created = await ContactMessage.create({
        id: `MSG-${randomBytes(8).toString('hex')}`,
        userId: authenticated ? authenticated.id : null,
        senderName: name,
        senderEmail: email,
        subject,
        message,
        senderType,
        status: 'new'
      });
      res.status(201).json({ success: true, message: serializeContactMessage(created) });
    } catch (error) {
      // Distinguishes a database insert failure from anything else, without
      // logging message content, contact details, tokens or secrets.
      console.error(`Contact submission failed: database insert (${error?.name || 'Error'})`);
      res.status(503).json({ error: 'Unable to send your message right now. Please try again.' });
    }
  });

  // ── STAFF/ADMIN ONLY ──────────────────────────────────────────────────────
  app.get('/api/staff/messages', requireOrderStaff, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const messages = await ContactMessage.find({}).sort({ createdAt: -1 }).limit(500).lean();
      const unread = await ContactMessage.countDocuments({ status: 'new' });
      res.json({
        messages: messages.map(serializeContactMessage),
        unread,
        total: messages.length
      });
    } catch { res.status(503).json({ error: 'Unable to load messages.' }); }
  });

  app.get('/api/staff/messages/:id', requireOrderStaff, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = safeText(req.params.id).slice(0, MAX_ID_LENGTH);
    try {
      const found = await ContactMessage.findOne({ id }).lean();
      if (!found) return res.status(404).json({ error: 'Message not found.' });
      res.json({ message: serializeContactMessage(found) });
    } catch { res.status(503).json({ error: 'Unable to load this message.' }); }
  });

  app.patch('/api/staff/messages/:id/status', requireOrderStaff, contactMessageStatus, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const id = safeText(req.params.id).slice(0, MAX_ID_LENGTH);
    const status = safeText(req.body.status);
    if (!CONTACT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });

    try {
      const now = new Date();
      const update = { status };
      if (status === 'read' || status === 'resolved') update.readAt = now;
      if (status === 'resolved') update.resolvedAt = now;
      if (status === 'new') { update.readAt = null; update.resolvedAt = null; }

      const updated = await ContactMessage.findOneAndUpdate({ id }, { $set: update }, { new: true }).lean();
      if (!updated) return res.status(404).json({ error: 'Message not found.' });
      res.json({ success: true, message: serializeContactMessage(updated) });
    } catch { res.status(503).json({ error: 'Unable to update this message.' }); }
  });
}