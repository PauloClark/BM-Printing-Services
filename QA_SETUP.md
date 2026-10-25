# Isolated browser QA setup

The QA launcher forces Cloudflare's published test credentials through
`VITE_TURNSTILE_USE_TEST_KEYS=true` and `TURNSTILE_USE_TEST_KEYS=true`. Deployment
validation rejects these switches for staging and production.

This stack uses a fresh, disposable MongoDB replica set with files in a unique OS temporary directory for every run and a separate Supabase QA project. It never uses the normal `npm run dev` launcher. The QA launcher does not create Supabase accounts, change roles, or write to Storage during startup; it performs read-only checks of the five configured identities and the private bucket.

## 1. Create a dedicated Supabase QA project

Create a new Supabase project specifically for QA. Do not reuse the production project or its service-role key. Keep its project URL, public anon/publishable key, and service-role key in a trusted password manager while setting up the local QA environment.

Enable the email/password provider. If testing customer registration, configure a QA-only email delivery provider or inbox so confirmation messages can be verified without sending to real customers.

In **Authentication → URL Configuration**, set the Site URL to `http://127.0.0.1:3300` and allow the callback URL `http://127.0.0.1:3300/auth/confirm`. Add `http://localhost:3300/auth/confirm` only if you intentionally browse through `localhost` instead of `127.0.0.1`.

## 2. Create five synthetic accounts

In the QA project's Auth user management, create these accounts using reserved test email addresses and unique passwords held outside the repository:

| Account | Required `app_metadata.role` | Purpose |
|---|---|---|
| QA Admin | `admin` | Admin workflows and financial controls |
| QA Staff A | `staff` | Assignment ownership checks |
| QA Staff B | `staff` | Cross-staff authorization checks |
| QA Customer A | `customer` | Customer A-owned orders and inquiries |
| QA Customer B | `customer` | Customer B-owned records for IDOR checks |

Record each Auth user's UUID and email. The launcher verifies that every UUID and email match and that the server-visible `app_metadata.role` has the required value. Customers may default to `customer`; explicitly set it for consistency.

Set roles only through the QA project's authorized Auth Admin interface/API. `app_metadata` is server-controlled; do not set privileged roles in `user_metadata` or from browser code. For a trusted manual Admin API operation, use `auth.admin.updateUserById(userId, { app_metadata: { role } })` with a client created from the **QA project's** service-role key. Never paste that key into Vite variables, commit it, or print it. Do not run any role update against the existing project.

## 3. Create a private QA Storage bucket

In **Storage**, create a bucket named `private-order-files-qa` (or another valid name entered in `.env.qa.local`). Leave **Public bucket** disabled. The launcher uses the QA service-role key only to verify the bucket exists and remains private. Artwork and receipt tests should use synthetic files only. The application's authenticated API routes perform customer ownership and Admin/assigned-Staff authorization checks for private downloads.

## 4. Configure the ignored QA environment file

Copy `.env.qa.example` to `.env.qa.local` and replace every placeholder with the dedicated QA project's values and the five accounts' actual UUIDs/emails. `.env.qa.local` is ignored by Git. Keep it local and do not copy service-role credentials from another project.

The frontend child receives only the QA project URL and public anon key. The backend child receives the QA URL, anon key, service-role key, and private bucket name. The launcher reads no normal MongoDB URI as a fallback and does not pass the service-role key to Vite.

## 5. Start and stop the isolated stack

From the repository root, run:

```powershell
npm.cmd run qa:local
```

The launcher validates configuration, checks that the QA Supabase URL differs from any project URL found in normal local environment files, verifies all five existing QA identities and role metadata, and checks that the Storage bucket is private. It then starts:

- MongoDB 7.0.14 as a one-member replica set, bound to loopback, with its database files in a unique OS temporary directory;
- the backend at `http://127.0.0.1:4300`, explicitly configured for database `bmprinting_qa`;
- Vite at `http://127.0.0.1:3300`, bound to loopback and configured only with public QA Supabase settings.

The launcher seeds synthetic customer/admin directory records, two pending QA orders for Customer A/B, two linked Staff employee profiles, one QA product, and one QA raw material. The pending orders contain no payment evidence and are identified as synthetic; use only dummy receipt files if exercising payment review. Create production jobs through the Admin workflow during testing. No business records are copied from another database. Stop with **Ctrl+C**. Teardown stops both child processes and the replica set, then removes only the launcher's marked temporary directory. No `dropDatabase` or persistent MongoDB collection cleanup is used.

If `.env.qa.local` is absent or incomplete, if the configured Supabase URL matches the normal project, if any account/role check fails, or if the bucket is public, startup stops before launching MongoDB or the app. Do not use `npm run dev` as a workaround.

## 6. Isolation checks and evidence

The launcher requires the fixed database name `bmprinting_qa`, builds the MongoDB URI from the replica set it just started, checks the loopback host/port and replica-set `hello` response, and verifies the database path is exactly inside this run's unique temporary directory. The backend receives only a constructed environment with explicit QA URI/name and `ALLOW_LEGACY_AUTH=false`, `ALLOW_LEGACY_REGISTRATION=false`, and `ALLOW_IN_MEMORY_DB=false`. `BM_QA_MODE=true` prevents both backend and Vite from loading `.env` or `env`.

The launcher reports only the local frontend URL, QA database name, and seed summary. Child logs and credential values are suppressed. After stopping, ports 3300/4300 should be closed and the run's marked temporary directory removed. The persistent `bmprinting` database and configured standalone MongoDB process are not used or changed.

Uploads sent to the remote QA bucket are intentionally not deleted by local teardown. Review and remove synthetic objects manually in the dedicated QA project when appropriate; the launcher never performs remote cleanup.

## 7. Browser test accounts and workflow safety

Use the five QA logins above. Verify Staff A cannot access Staff B's assigned job, Customer A cannot access Customer B's order/inquiry/files, and non-Admin roles cannot access financial controls. Use a generated synthetic image/PDF for artwork and a clearly fake payment proof/reference; do not submit an actual payment or refund. Test emails must remain within the QA inbox/provider.

The launcher does not fabricate browser tokens or bypass production authorization. Supabase must issue the sessions, and the backend verifies those sessions against the configured QA project. The QA database is disposable; every run starts empty apart from synthetic seeds.

## 8. Archive/Restore

The launcher's disposable replica set supports transaction-capable testing, but Archive/Restore should be run as its own disposable QA session and database, separate from other workflow acceptance data. Never point Archive/Restore tests at the normal standalone MongoDB service or `bmprinting`.
