# Split production hosting preparation

This document is a preparation checklist. It does not authorize deployment, database migration, or file migration.

## Approved hosting boundary

- **Vercel:** static Vite frontend only. `.vercelignore` excludes the legacy `api/` function adapter, root process entry, tests, and runtime artifacts. The deployment output is `dist/` only.
- **Persistent Node host:** `npm run server` runs Express, the MongoDB connection pool, health endpoints, private uploads, report generation, and the notification retry worker.
- **MongoDB Atlas:** future transaction-capable database. Migration remains a separate approved operation.
- **Supabase:** authentication plus one private Storage bucket for artwork and payment receipts.

The former Vercel `/api/*` rewrite and function declaration were removed. Set `VITE_API_BASE_URL` to the persistent API HTTPS origin for Preview and Production. Local Vite and the isolated QA launcher continue to use their existing `/api` proxy.

## Vercel frontend project

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm ci`
- Node runtime: Node 24.x, matching the validated local build and `package.json`
- Deployment role: static frontend; no Express function or `/api` rewrite

Run `npm run validate:frontend-env` in the Vercel build environment and `npm run validate:backend-env` on the persistent API host before deployment. `npm run validate:deployment-env` validates both variable sets when they are available together. Never paste secret values into build logs.

## Required environment variables

| Name | Scope | Purpose |
| --- | --- | --- |
| `DEPLOYMENT_ENVIRONMENT` | Both | `staging` requires `bmprinting_staging`; `production` requires `bmprinting` |
| `DEPLOYMENT_HOSTING_MODE` | Both | Must be `split` for this architecture |
| `MONGODB_URI` | Server | Atlas replica-set connection URI including the `bmprinting` database |
| `MONGODB_DB_NAME` | Server | `bmprinting_staging` in staging and `bmprinting` in production |
| `MONGODB_MAX_POOL_SIZE` | Server | Persistent process pool cap; start with 10 and monitor Atlas connections |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | Server | Fail-fast database selection timeout |
| `FRONTEND_ORIGINS` | Server | Comma-separated exact staging/production browser origins |
| `JWT_SECRET` | Server | Strong secret for approved legacy admin/customer JWT compatibility |
| `JWT_EXPIRES_IN` | Server | Legacy JWT lifetime |
| `ALLOW_IN_MEMORY_DB` | Server | Must be `false` |
| `SEED_DEFAULT_ADMIN` | Server | Must be `false` |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_ANON_KEY` | Server | Server token-verification public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Auth Admin operations; never use a `VITE_` prefix |
| `SUPABASE_STORAGE_BUCKET` | Server only | Name of the private Supabase Storage bucket for artwork and payment receipts |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Public anon key |
| `VITE_TURNSTILE_SITE_KEY` | Browser | Public Cloudflare Turnstile site key used by Supabase Auth and guest Contact Us |
| `TURNSTILE_SECRET_KEY` | Server only | Cloudflare secret used by backend Siteverify for guest Contact Us |
| `TURNSTILE_HOSTNAMES` | Server | Exact accepted frontend hostnames, without scheme, path, or port |
| `ALLOW_LEGACY_AUTH` | Server | `true` only while the existing MongoDB Admin account is still required; otherwise `false` |
| `LEGACY_ADMIN_AUTH_APPROVED` | Server | `true` only for the reviewed temporary Admin-login exception |
| `ALLOW_LEGACY_REGISTRATION` | Server | Must be `false`; customer registration uses Supabase |
| `VITE_API_BASE_URL` | Browser | Exact persistent API HTTPS origin; empty only for local proxy development |
| `VITE_PUBLIC_APP_URL` | Browser | Canonical deployed frontend origin used for Supabase email/OAuth callbacks; set to the working Vercel URL |
| `VITE_BASE_PATH` | Build | `/` on Vercel |
| `NOTIFICATION_WORKER_ENABLED` | Server | Must be `true` on the persistent API host |

### Private upload storage setup

Before accepting real orders or payment receipts in staging or production:

1. In the Supabase Dashboard for the same project as the frontend, open **Storage** and create a bucket named to match `SUPABASE_STORAGE_BUCKET` (the example is `private-order-files`).
2. Keep **Public bucket** disabled. Do not add anonymous read access or publish a public bucket URL.
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` to the same project. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only; never use a `VITE_` prefix.
4. Add the bucket name and credentials to the server environment. The API checks that the bucket exists and is private before uploading or downloading files.
5. Run `npm run validate:deployment-env` in the deployment environment, then test artwork upload, receipt upload, customer ownership, and Admin receipt access with synthetic staging accounts and orders.

The validator checks configuration and project URL consistency without printing secret values. It does not connect to Supabase or create, change, or verify a remote bucket. Verify the bucket privacy setting manually in the Dashboard. Local development can use `npm run validate:deployment-env -- --mode=local`; the normal frontend build does not require production-only storage, Atlas, or worker settings.

The persistent API starts the notification worker after MongoDB connects and drains the active batch during SIGTERM/SIGINT shutdown. Begin with one API instance. The outbox claim lease and event keys protect concurrent delivery, but horizontal scaling should be load-tested and Atlas pool limits reviewed before increasing instance count.

## API host runtime requirements

- Start command: `npm run server`
- Readiness: `GET /api/health` returns 200 only after MongoDB responds; use this for traffic readiness.
- Liveness: `GET /api/health/live` does not query MongoDB; use this only to detect a stopped Node process.
- Graceful shutdown allowance: at least 30 seconds so the active notification batch and HTTP server can stop.
- Request body limit: the application accepts at most 15 MB of JSON. A 10 MiB binary upload expands to about 13.4 MiB as base64; configure the reverse proxy for at least 15 MB and no less than the application limit. Larger requests receive JSON HTTP 413 responses.
- CORS: `FRONTEND_ORIGINS` contains only exact deployed frontend HTTPS origins. Preview origins must be deliberately added; wildcards are not used.
- HTTPS: terminate TLS only at a trusted hosting proxy and forward the original protocol and client address. The application trusts one proxy hop in production.
- Rate limiting: authentication limits are process-local. One API instance is suitable initially; multiple instances require a shared limiter or acceptance that limits apply independently per process.
- Error monitoring: capture process exits, readiness failures, HTTP 5xx rates, MongoDB pool failures, upload 413/503 rates, and failed notification outbox counts. Redact authorization headers, tokens, connection strings, receipt data, and uploaded file contents.
- CSP: Helmet remains enabled, but the application Content Security Policy is currently disabled because the existing frontend has inline styles and external Auth resources. Define and stage-test an explicit CSP before public production launch; do not enable a restrictive policy without testing login, images, downloads, and Supabase callbacks.

The current browser upload contract uses base64 JSON and temporarily holds the encoded request plus decoded bytes in memory. Keep instance memory sized for the expected concurrent uploads. A future multipart streaming migration is recommended if upload sizes or concurrency increase; it requires a coordinated client and route change and is outside this compatibility phase.

## Atlas prerequisites and migration plan

The repository includes `scripts/migrate-mongodb-to-atlas.mjs`. It is dry-run
only unless both `--execute` and the exact `MIGRATION_WRITE_APPROVAL` value are
provided. Use `LOCAL_MONGODB_URI` and `ATLAS_MONGODB_URI` only in the current
PowerShell process; never place the Atlas URI in a command argument, Git file,
Vercel browser variable, or shell-history entry. The generated JSON report is
ignored by Git.

Dry-run behavior:

- compares every local and Atlas document by `_id` and canonical BSON value;
- blocks same-`_id` content conflicts and unique-key collisions;
- plans only missing-document upserts using `$setOnInsert`;
- compares indexes without copying version-specific index metadata;
- validates Admin, products, linked employees, orders, productions, inventory,
  stock movements, order files, notifications, and their relationships;
- writes only a local comparison report, never database data.

1. Create a staging Atlas cluster and database user with least-privilege access to `bmprinting`.
2. Restrict network access to the deployment strategy. Do not use an unrestricted rule without compensating controls.
3. Take a consistent local backup with `mongodump --db bmprinting --archive=<private path> --gzip` while writes are paused or from a snapshot.
4. Store the archive outside Git and calculate a SHA-256 checksum.
5. Restore into a new staging database, never over an existing production database.
6. Verify counts for `products`, `employees`, `users`, `orders`, `productions`, `inventories`, `stockmovements`, `notifications`, `orderfiles`, `contactmessages`, and `auditlogs`.
7. Verify relationships: unique product IDs; unique order IDs; each `Order.jobOrderId` maps to one Production; each Production order exists; linked employee Supabase IDs are unique; notification order/job references either resolve or are documented historical references; stock movements reference existing inventory/jobs; payment submissions remain embedded in their original orders.
8. Compare financial control totals: order totals, verified-payment totals, order count by status, and archived/non-archived counts.
9. Run the full-payment mismatch audit before enabling staging assignment workflows.
10. Point only the staging Vercel environment at Atlas, validate, then obtain approval before changing any active environment.

Transaction-dependent operations are material reservation/consumption, inventory-backed pickup, and order archiving. They must be exercised on Atlas before staging approval.

## Private file migration plan

Local paths may back development uploads. Production artwork and receipts use private Supabase Storage. Daily order spreadsheets are generated on demand after Admin authorization and streamed from memory, so they do not depend on local disk or public object URLs.

Recommended target: a private Supabase Storage bucket with separate order-scoped design and receipt prefixes. Reports are generated on demand and do not require a storage prefix. The service-role key remains server-only. Browsers must continue calling the authorized Express endpoints; do not store public URLs or expose the bucket.

Migration steps:

1. Inventory every `Order.designFilePath`, embedded payment `receiptFilePath`, and `OrderFile.storagePath`.
2. Verify each local file exists, record byte size and SHA-256 checksum, and flag missing/orphaned files.
3. Upload to the private staging bucket with deterministic collision-resistant keys.
4. Record storage provider/bucket/object key in a backward-compatible schema; retain original filename and MIME metadata.
5. Update server-side preview/download handlers to authorize first, then stream through the backend or issue very short-lived signed URLs.
6. Verify owner access, cross-customer denial, staff/admin policy, receipt admin-only access, byte size, and checksum.
7. Keep original local files until database and object-storage backups are verified and deletion is separately approved.

## External dashboard configuration

- Supabase Auth: add the exact Vercel staging URL and callback/redirect URLs; retain required localhost redirects for development.
- Supabase Storage: create a private bucket only during the approved storage phase; no public read policy.
- MongoDB Atlas: create database user, network policy, backups, monitoring, and connection alerts.
- Vercel: add variables separately for Preview/Production and ensure server-only secrets are not prefixed with `VITE_`.

## Staging verification

Use synthetic staging records only. Verify readiness and liveness, registration/login, all role denials, seven products, server-authoritative checkout, exact full payment, receipt authorization, job ownership, transaction-backed inventory pickup, archive/report operations, notifications, SPA deep links, API CORS, and mobile/desktop UI. Never verify a real payment or confirm a real pickup during staging tests.

### CAPTCHA setup required before hosted authentication testing

1. Create separate Cloudflare Turnstile widgets for staging and production. Allow only each environment's exact frontend hostname. Add localhost only to a development widget; never reuse production credentials locally.
2. Put the public staging site key in Vercel as `VITE_TURNSTILE_SITE_KEY`. Put its matching secret in the staging Supabase project under **Authentication > Bot and Abuse Protection > CAPTCHA** and enable Cloudflare Turnstile.
3. Put the same staging secret in the persistent API host as `TURNSTILE_SECRET_KEY` for server-side guest Contact Us verification. Keep it server-only and configure `TURNSTILE_HOSTNAMES` with the exact staging frontend hostname.
4. Keep `VITE_TURNSTILE_USE_TEST_KEYS` and `TURNSTILE_USE_TEST_KEYS` false in staging and production. Cloudflare test keys are permitted only in isolated local QA.
5. Repeat with separate production credentials and the production Supabase project. Verify password login, signup, phone OTP initiation, token expiry/reuse rejection, and guest Contact Us with synthetic accounts before accepting traffic.

Google OAuth does not use this widget. The current application has no public password-reset initiation screen or `resetPasswordForEmail` call; add CAPTCHA token forwarding if that feature is introduced.

## Rollback preparation

1. Record the frontend build identifier, backend release identifier, environment-variable revision, and database migration state before enabling staging traffic.
2. Keep the prior frontend and backend artifacts available for redeployment. Rolling back one side requires checking API contract compatibility with the other side.
3. Do not roll Atlas data backward by deploying older application code. Stop writes and restore from a verified backup only through a separately approved database recovery procedure.
4. Keep migrated local uploads until private-object checksums and database references are verified. A code rollback must continue to read both legacy local references and private-storage references used by the selected release.
5. If readiness, authentication, uploads, payments, inventory transactions, or notification delivery fail, remove staging traffic first, preserve logs and outbox state, and diagnose before retrying deployment.
6. Re-run the environment validators, authorization tests, full Jest suite, frontend build, and synthetic staging smoke tests after rollback.
