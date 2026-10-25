import { randomUUID } from 'node:crypto';
import { ContactMessage, Order, Production } from './db.js';
import { createNotification, recipientEventKey } from './notificationService.js';
import { isAuthorizedNotificationRecipient, listNotificationAdmins } from './staffDirectory.js';

const MAX_ATTEMPTS = 8;
const CLAIM_MS = 60_000;
const MAX_MANUAL_RETRIES = 3;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const OUTBOXES = [
  { sourceType: 'order', model: Order, idField: 'orderId', path: 'notificationOutbox' },
  { sourceType: 'production', model: Production, idField: 'jobOrderId', path: 'notificationOutbox' },
  { sourceType: 'production-reassignment', model: Production, idField: 'jobOrderId', path: 'reassignmentNotificationOutbox' },
  { sourceType: 'production-exception', model: Production, idField: 'jobOrderId', path: 'exceptionNotificationOutbox' },
  { sourceType: 'contact-message', model: ContactMessage, idField: 'id', path: 'notificationOutbox' }
];

const cleanError = error => String(error?.message || 'Notification delivery failed.').replace(/(token|secret|key|password|authorization)\s*[:=]\s*\S+/ig, '$1=[redacted]').slice(0, 300);
const dueFilter = now => ({ $or: [
  { state: { $in: ['PENDING', 'pending'] }, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] },
  { state: 'PROCESSING', lockedUntil: { $lte: now } }
] });
const candidateFilter = (path, now) => ({ [path]: { $elemMatch: dueFilter(now) } });
const isDue = (intent, now) => ['PENDING', 'pending'].includes(intent.state)
  ? !intent.nextAttemptAt || new Date(intent.nextAttemptAt) <= now
  : intent.state === 'PROCESSING' && (!intent.lockedUntil || new Date(intent.lockedUntil) <= now);

async function claimIntent(spec, docId, eventKey, now) {
  const token = randomUUID(), lockedUntil = new Date(now.getTime() + CLAIM_MS);
  const common = { _id: docId, [`${spec.path}.eventKey`]: eventKey };
  const update = { $set: {
    [`${spec.path}.$[intent].state`]: 'PROCESSING', [`${spec.path}.$[intent].lockToken`]: token,
    [`${spec.path}.$[intent].lockedUntil`]: lockedUntil, [`${spec.path}.$[intent].lastAttemptAt`]: now,
    [`${spec.path}.$[intent].lastError`]: ''
  }, $inc: { [`${spec.path}.$[intent].attempts`]: 1 } };
  for (const state of ['PENDING', 'pending']) {
    const result = await spec.model.collection.findOneAndUpdate(
      { ...common, [spec.path]: { $elemMatch: { eventKey, state, $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }] } } },
      update,
      { returnDocument: 'after', arrayFilters: [{ $and: [{ 'intent.eventKey': eventKey }, { 'intent.state': state }, { $or: [{ 'intent.nextAttemptAt': null }, { 'intent.nextAttemptAt': { $lte: now } }] }] }] }
    );
    const claimed = result?.value || result;
    if (claimed) return { doc: claimed, token, intent: (claimed[spec.path] || []).find(item => item.eventKey === eventKey) };
  }
  const recoveredResult = await spec.model.collection.findOneAndUpdate(
    { ...common, [spec.path]: { $elemMatch: { eventKey, state: 'PROCESSING', lockedUntil: { $lte: now } } } },
    update,
    { returnDocument: 'after', arrayFilters: [{ $and: [{ 'intent.eventKey': eventKey }, { 'intent.state': 'PROCESSING' }, { 'intent.lockedUntil': { $lte: now } }] }] }
  );
  const recovered = recoveredResult?.value || recoveredResult;
  return recovered ? { doc: recovered, token, intent: (recovered[spec.path] || []).find(item => item.eventKey === eventKey) } : null;
}

async function updateClaim(spec, docId, eventKey, token, status, details = {}) {
  const { now = new Date(), error = '', nextAttemptAt = null, deliveredAt = null } = details;
  const history = { state: status, attemptedAt: now, error: error || '' };
  const set = {
    [`${spec.path}.$[intent].state`]: status,
    [`${spec.path}.$[intent].lastError`]: error || '',
    [`${spec.path}.$[intent].nextAttemptAt`]: nextAttemptAt,
    [`${spec.path}.$[intent].lockedUntil`]: null,
    [`${spec.path}.$[intent].lockToken`]: '',
    [`${spec.path}.$[intent].deliveredAt`]: deliveredAt
  };
  await spec.model.collection.updateOne({ _id: docId, [`${spec.path}.eventKey`]: eventKey }, {
    $set: set,
    $push: { [`${spec.path}.$[intent].deliveryHistory`]: history }
    }, { arrayFilters: [{ $and: [{ 'intent.eventKey': eventKey }, { 'intent.state': 'PROCESSING' }, { 'intent.lockToken': token }] }] });
}

async function deliver(intent, doc, spec) {
  if (intent.recipientId === '*' && intent.recipientRole === 'admin') {
    const admins = await listNotificationAdmins();
    if (!admins.length) throw new Error('No active verified Admin notification recipients are configured.');
    for (const admin of admins) {
      const notification = await createNotification({
        recipientId: admin.id, recipientRole: 'admin', type: intent.type, title: intent.title, message: intent.message,
        relatedOrderId: intent.relatedOrderId || doc.orderId || '', relatedJobId: intent.relatedJobId || doc.jobOrderId || '',
        targetPage: intent.targetPage || 'admin', eventKey: recipientEventKey(intent.eventKey, admin.id)
      });
      if (!notification?._id) throw new Error('Notification record was not persisted.');
    }
    return;
  }
  const authorized = await isAuthorizedNotificationRecipient(intent.recipientRole, intent.recipientId);
  if (!authorized) throw Object.assign(new Error('The notification recipient is no longer an active authorized account.'), { permanent: true });
  const notification = await createNotification({
    recipientId: intent.recipientId, recipientRole: intent.recipientRole, type: intent.type, title: intent.title, message: intent.message,
    relatedOrderId: intent.relatedOrderId || doc.orderId || '', relatedJobId: intent.relatedJobId || doc.jobOrderId || '',
    targetPage: intent.targetPage || '', eventKey: recipientEventKey(intent.eventKey, intent.recipientId)
  });
  if (!notification?._id) throw new Error('Notification record was not persisted.');
}

async function processEvent(spec, docId, eventKey, now) {
  const claim = await claimIntent(spec, docId, eventKey, now);
  if (!claim?.intent) return false;
  const intent = claim.intent;
  try {
    if (Number(intent.attempts) > MAX_ATTEMPTS) {
      await updateClaim(spec, docId, eventKey, claim.token, 'FAILED', { now, error: 'Maximum automatic delivery attempts reached.' });
      return true;
    }
    await deliver(intent, claim.doc, spec);
    await updateClaim(spec, docId, eventKey, claim.token, 'DELIVERED', { now: new Date(), deliveredAt: new Date() });
  } catch (error) {
    const message = cleanError(error);
    const terminal = Boolean(error?.permanent) || Number(intent.attempts) >= MAX_ATTEMPTS;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * (2 ** Math.max(0, Number(intent.attempts) - 1)));
    await updateClaim(spec, docId, eventKey, claim.token, terminal ? 'FAILED' : 'PENDING', {
      now: new Date(), error: message, nextAttemptAt: terminal ? null : new Date(Date.now() + delay)
    });
  }
  return true;
}

export async function runNotificationBatch({ limit = 20, now = new Date() } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 1, 1), 50);
  let processed = 0;
  for (const spec of OUTBOXES) {
    if (processed >= boundedLimit) break;
    const docs = await spec.model.find(candidateFilter(spec.path, now)).select(`_id ${spec.idField} ${spec.path} orderId`).limit(boundedLimit - processed).lean();
    for (const doc of docs) {
      for (const intent of doc[spec.path] || []) {
        if (processed >= boundedLimit) break;
        if (isDue(intent, now)) {
          if (await processEvent(spec, doc._id, intent.eventKey, now)) processed++;
        }
      }
    }
  }
  return { processed, limit: boundedLimit };
}

export function startNotificationWorker({ intervalMs = 5000, batchSize = 20 } = {}) {
  if (process.env.VERCEL || process.env.NOTIFICATION_WORKER_ENABLED === 'false') return () => {};
  let stopped = false, running = false, activeBatch = Promise.resolve();
  const tick = async () => {
    if (stopped || running) return;
    running = true;
    activeBatch = (async () => {
      try { await runNotificationBatch({ limit: batchSize }); }
      catch (error) { console.error('Notification worker batch failed:', cleanError(error)); }
      finally { running = false; }
    })();
    await activeBatch;
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return async () => { stopped = true; clearInterval(timer); await activeBatch; };
}

export async function listNotificationDelivery() {
  const specs = OUTBOXES.map(spec => ({ ...spec }));
  const all = [];
  const totals = { PENDING: 0, PROCESSING: 0, DELIVERED: 0, FAILED: 0 };
  for (const spec of specs) {
    const collection = spec.model.collection;
    const statusCounts = await collection.aggregate([
      { $unwind: `$${spec.path}` },
      { $group: { _id: `$${spec.path}.state`, count: { $sum: 1 } } }
    ]).toArray();
    for (const row of statusCounts) if (totals[row._id] !== undefined) totals[row._id] += row.count;
    const rows = await collection.aggregate([
      { $unwind: `$${spec.path}` },
      { $sort: { [`${spec.path}.lastAttemptAt`]: -1, [`${spec.path}.createdAt`]: -1 } },
      { $limit: 100 },
      { $project: {
        _id: 0, sourceType: { $literal: spec.sourceType }, sourceId: `$${spec.idField}`, eventKey: `$${spec.path}.eventKey`,
        recipientRole: `$${spec.path}.recipientRole`, state: `$${spec.path}.state`, attempts: `$${spec.path}.attempts`,
        lastAttemptAt: `$${spec.path}.lastAttemptAt`, nextAttemptAt: `$${spec.path}.nextAttemptAt`, lastError: `$${spec.path}.lastError`,
        manualRetryCount: `$${spec.path}.manualRetryCount`,
        createdAt: `$${spec.path}.createdAt`, title: `$${spec.path}.title`, type: `$${spec.path}.type`
      } }
    ]).toArray();
    all.push(...rows);
  }
  all.sort((a, b) => new Date(b.lastAttemptAt || b.createdAt) - new Date(a.lastAttemptAt || a.createdAt));
  return { totals, events: all.slice(0, 150) };
}

export async function retryFailedNotification({ sourceType, sourceId, eventKey, actorId }) {
  const candidates = OUTBOXES.filter(item => item.sourceType === sourceType || (sourceType === 'production' && item.sourceType.startsWith('production-')));
  if (!candidates.length || !sourceId || !eventKey) return false;
  const now = new Date();
  for (const spec of candidates) {
    const result = await spec.model.collection.updateOne({
      [spec.idField]: sourceId,
      [spec.path]: { $elemMatch: { eventKey, state: 'FAILED', $or: [{ manualRetryCount: { $lt: MAX_MANUAL_RETRIES } }, { manualRetryCount: { $exists: false } }] } }
    }, {
      $set: {
        [`${spec.path}.$[intent].state`]: 'PENDING', [`${spec.path}.$[intent].attempts`]: 0,
        [`${spec.path}.$[intent].nextAttemptAt`]: now, [`${spec.path}.$[intent].lockedUntil`]: null,
        [`${spec.path}.$[intent].lockToken`]: '', [`${spec.path}.$[intent].lastError`]: ''
      },
      $inc: { [`${spec.path}.$[intent].manualRetryCount`]: 1 },
      $push: { [`${spec.path}.$[intent].deliveryHistory`]: { state: 'MANUAL_RETRY', attemptedAt: now, actorId, error: '' } }
    }, { arrayFilters: [{ $and: [{ 'intent.eventKey': eventKey }, { 'intent.state': 'FAILED' }, { $or: [{ 'intent.manualRetryCount': { $lt: MAX_MANUAL_RETRIES } }, { 'intent.manualRetryCount': { $exists: false } }] }] }] });
    if (result.modifiedCount > 0) return true;
  }
  return false;
}

export const notificationWorkerPolicy = { maxAttempts: MAX_ATTEMPTS, maxManualRetries: MAX_MANUAL_RETRIES, claimMs: CLAIM_MS, batchSize: 20, intervalMs: 5000 };
