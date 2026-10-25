# Phase 4D Notification Delivery

## Local backend

When `server.js` starts outside Vercel, it starts one bounded notification worker after MongoDB connects. The worker scans the embedded Order, Production, and ContactMessage outboxes in batches of up to 20 intents every five seconds. It stops polling on process shutdown and retries abandoned claims after their 60-second lease expires.

Failed transient attempts use exponential backoff starting at five seconds and capped at one hour. Automatic delivery stops after eight attempts; permanent authorization failures stop immediately. Admins can inspect failed intents and schedule up to three manual retry cycles from Admin → Notification Delivery. Every attempt and manual retry is retained in the intent's delivery history; the retry limits keep that history bounded per event.

## Serverless deployment

Vercel functions are request driven, so the application does not start a background interval there. A scheduler must invoke `POST /api/internal/notification-worker/run` with `Authorization: Bearer <NOTIFICATION_WORKER_SECRET>`. Configure `NOTIFICATION_WORKER_SECRET` as a server only environment variable with at least 32 characters. The endpoint is hidden unless `VERCEL` is set and the secret is configured; it processes one bounded batch and has no public unauthenticated mode.

The repository does not install or configure a scheduler. An external cron service or a controlled scheduled job must call the endpoint at a suitable interval. Configure its URL, secret, and cadence in the hosting environment before relying on automatic retries in serverless production.

## Consistency boundary

Business events and their notification intents are written together in the same MongoDB document where the route supports a single-document update. Pickup stock updates that already require transactions keep their existing transaction behavior. The worker writes Notification records separately; deterministic recipient-specific event keys make a repeated write idempotent. MongoDB remains standalone and no cross-document transaction guarantee is claimed by this feature.

Supabase-only Admin identities are discovered through the server-only Supabase Auth Admin API using `SUPABASE_SERVICE_ROLE_KEY`. Staff delivery requires both an active employee link and a current active Supabase Staff identity. If the identity directory is unavailable, the intent remains retryable and appears in Admin delivery monitoring instead of being marked delivered.
