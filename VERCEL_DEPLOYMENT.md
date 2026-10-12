# Vercel staging deployment preparation

This document is a preparation checklist. It does not authorize deployment, database migration, or file migration.

## Vercel project

- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm ci`
- Node runtime: Node 24.x, matching the validated local build and `package.json`
- API entry: `api/index.js`; `vercel.json` rewrites existing `/api/*` paths to Express
- Keep frontend and API in the same Vercel project unless `VITE_API_BASE_URL` is intentionally configured

Run `npm run validate:deployment-env` in a staging environment before deployment. Never paste secret values into build logs.

## Required environment variables

| Name | Scope | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Server | Atlas replica-set connection URI including the `bmprinting` database |
| `MONGODB_DB_NAME` | Server | Must be `bmprinting`; explicitly selects the migrated database |
| `MONGODB_MAX_POOL_SIZE` | Server | Function-instance pool cap; start with 10 and monitor Atlas connections |
| `MONGODB_SERVER_SELECTION_TIMEOUT_MS` | Server | Fail-fast database selection timeout |
| `FRONTEND_ORIGINS` | Server | Comma-separated exact staging/production browser origins |
| `JWT_SECRET` | Server | Strong secret for approved legacy admin/customer JWT compatibility |
| `JWT_EXPIRES_IN` | Server | Legacy JWT lifetime |
| `ALLOW_IN_MEMORY_DB` | Server | Must be `false` |
| `SEED_DEFAULT_ADMIN` | Server | Must be `false` |
| `ALLOW_LEGACY_AUTH` | Server | Set `false` unless a documented migration exception is approved |
| `SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_ANON_KEY` | Server | Server token-verification public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Auth Admin operations; never use a `VITE_` prefix |
| `VITE_SUPABASE_URL` | Browser | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Browser | Public anon key |
| `VITE_TURNSTILE_SITE_KEY` | Browser | Turnstile site key |
| `TURNSTILE_SECRET_KEY` | Server only | Turnstile verification secret |
| `TURNSTILE_HOSTNAMES` | Server | Comma-separated exact Vercel/custom hostnames accepted from Siteverify; no schemes, ports, or paths |
| `ALLOW_LEGACY_AUTH` | Server | `true` only while the existing MongoDB Admin account is still required; otherwise `false` |
| `LEGACY_ADMIN_AUTH_APPROVED` | Server | `true` only for the reviewed temporary Admin-login exception |
| `ALLOW_LEGACY_REGISTRATION` | Server | Must be `false`; customer registration uses Supabase |
| `VITE_API_BASE_URL` | Browser | Empty for same-origin; explicit HTTPS origin only for split hosting |
| `VITE_BASE_PATH` | Build | `/` on Vercel |

`SUPABASE_STORAGE_BUCKET` is reserved for the approved private-storage phase and is not active yet.

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

Local paths currently back customer designs, payment receipts, and generated reports. Vercel's filesystem is not durable; do not enable real uploads until private object storage is implemented.

Recommended target: a private Supabase Storage bucket with separate prefixes such as `designs/<orderId>/`, `receipts/<orderId>/`, and `reports/`. The service-role key remains server-only. Browsers must continue calling the authorized Express endpoints; do not store public URLs or expose the bucket.

Migration steps:

1. Inventory every `Order.designFilePath`, embedded payment `receiptFilePath`, and `OrderFile.storagePath` plus generated reports.
2. Verify each local file exists, record byte size and SHA-256 checksum, and flag missing/orphaned files.
3. Upload to the private staging bucket with deterministic collision-resistant keys.
4. Record storage provider/bucket/object key in a backward-compatible schema; retain original filename and MIME metadata.
5. Update server-side preview/download handlers to authorize first, then stream through the backend or issue very short-lived signed URLs.
6. Verify owner access, cross-customer denial, staff/admin policy, receipt admin-only access, byte size, and checksum.
7. Keep original local files until database and object-storage backups are verified and deletion is separately approved.

## External dashboard configuration

- Supabase Auth: add the exact Vercel staging URL and callback/redirect URLs; retain required localhost redirects for development.
- Supabase Storage: create a private bucket only during the approved storage phase; no public read policy.
- Cloudflare Turnstile: allow the exact Vercel staging hostname and eventual custom domain. Keep test keys disabled in staging.
- MongoDB Atlas: create database user, network policy, backups, monitoring, and connection alerts.
- Vercel: add variables separately for Preview/Production and ensure server-only secrets are not prefixed with `VITE_`.

## Staging verification

Use synthetic staging records only. Verify health, registration/login, all role denials, seven products, server-authoritative checkout, exact full payment, receipt authorization, job ownership, transaction-backed inventory pickup, archive/report operations, notifications, Turnstile, SPA deep links, function cold starts, and mobile/desktop UI. Never verify a real payment or confirm a real pickup during staging tests.
