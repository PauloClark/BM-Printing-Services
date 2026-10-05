# Customer to staff workflow: current fix and verification

Verified on October 1, 2026. This report supersedes the database-unavailable runtime notes in the earlier staff documentation.

## 1. Exact cause of HTTP 502

Vite was serving the frontend on port 3000 and proxying `/api` to Express on port 4000. Express was not listening: direct port-4000 requests failed with connection refused. Both `/api/health` and `/api/auth/me` returned 502 through Vite, before staff authorization could run.

The configured database was `mongodb://127.0.0.1:27017/bmprinting`, but no MongoDB listener or Windows service was running. `server.js` waits for MongoDB before listening and exits when persistent database connection fails. The old `npm run dev` started only Vite, leaving the API/database unavailable. This was a backend availability failure, not a missing Supabase staff role or an RLS rejection.

A real MongoDB executable was already present in the development tooling cache. It was copied outside `node_modules` and started directly with WiredTiger and a persistent data directory, without using MongoMemoryServer or a temporary database fallback. Express was then started successfully. Both the direct API and frontend proxy returned health 200 with `db: connected`; unauthenticated `/api/auth/me` correctly returned 401. The user confirmed their existing real staff session opens the dashboard.

## 2. Files changed in this fix

- `scripts/local-services.mjs` (new): checks the configured database/API, starts persistent local services when appropriate, fails visibly for unavailable remote/authenticated databases, and never migrates or clears data.
- `scripts/dev.mjs` (new), `package.json`: `npm run dev` ensures the database/API are ready before starting Vite; `services:start` supports an already running frontend; `dev:frontend` remains available.
- `src/components/Pages/StaffOrders.jsx`, `StaffOrders.css`: highlight and prioritize recent Pending orders; require confirmation before completion; show product specifications without duplicating identical design instructions.
- `src/components/Widgets/Navbar.jsx`: staff sees “Staff Dashboard”; admin retains “Admin.”
- `src/utils/orderApi.js`: meaningful backend-unavailable messages for non-JSON gateway errors, without fallback orders or invented success.
- `server/utils.js`: omit internal file paths from order responses; optional upload-directory override for isolated verification.
- `server/reportService.js`, `server.js`: optional report/upload directory overrides, preserving existing default locations and protected file handling.
- `scripts/check-persisted-workflow.mjs` (new): browser workflow against real Express and an isolated persistent MongoDB database, with only Auth identity responses simulated.
- `.env.example`, `README.md`, `STAFF_ACCOUNTS.md`, `STAFF_ORDER_WORKFLOW.md`, this report: configuration and current runtime documentation.
- `dist/`: regenerated production build.

Existing authentication, order routes/model, role assignment, protected dashboard, My Orders, Track Order, and secure design-file components were reused. Earlier role/order implementation files are documented in `STAFF_ACCOUNTS.md` and `STAFF_ORDER_WORKFLOW.md`.

## 3. Authoritative order storage

Orders use the existing MongoDB `bmprinting.orders` collection, not a Supabase order table. Supabase remains the authentication provider. The local persistent database files are in:

```text
C:\Users\paulo\AppData\Local\BMPrinting\mongodb\data
```

The collection was empty when this previously unavailable local database first became reachable. No existing database data, JSON files, or browser-only records were deleted or automatically imported. If historical orders reside in a different database/data directory, reconnect that original store explicitly; this fix does not claim to recover them.

`Order.status` uses Pending, Confirmed, Processing, Ready for Pickup, Completed, and Cancelled. Existing legacy statuses remain readable and map to the corresponding processing stage. New orders start Pending. Normal progress is one stage at a time; cancellation is permitted before finalization. Completed/Cancelled records cannot be advanced. The server validates transitions and conditionally updates the current status to avoid competing staff updates.

## 4. How orders reach staff

Authenticated checkout posts to `/api/orders`. The API verifies the Supabase session, binds the verified customer ID/email, saves the actual Order record and attachment metadata, and then returns success. Guests use the same persistent collection and receive a private tracking token. Database failure is shown as failure; no browser-only order is treated as received.

Staff/admin reads `/api/staff/orders`. The dashboard loads on opening, refreshes every five seconds and on window focus, supports manual Refresh, and reloads after an update. Pending orders are highlighted and sorted first, newest first within that group. An already open dashboard receives new orders on the next poll, normally within five seconds. Supabase Realtime is not used because the actual storage is MongoDB.

Details include customer contact information, product, quantity, applicable specifications, design/reference preview or download, notes, fulfillment address, payment method, total and date. Contact information is kept out of the table. Existing orders have no payment verification field, so payment status is explicitly reported as not recorded.

## 5. Authorization and staff accounts

Staff keeps their existing Supabase account and password; no shared/default staff credentials were created. The existing trusted assignment script (`npm run staff:assign`) verifies the account UUID/email and updates `app_metadata.role` using a server-only administrator credential. Public registration creates customers; editable profile metadata cannot promote a user.

The protected dashboard verifies `/api/auth/me`. Independently, Express verifies the bearer token with Supabase Auth and checks trusted `app_metadata.role` on every protected request. Only staff/admin can read all processing orders and update status. Admin-only operations retain the separate admin guard. Changing localStorage, frontend state or editable user metadata does not grant API access. Customer reads are restricted by the existing verified ID/email ownership rules; guest tracking requires its private token. File routes enforce the same order access and filesystem confinement.

Existing legacy MongoDB customer/admin login compatibility was preserved; legacy staff login is rejected. No Supabase secret was added to frontend configuration.

## 6. Customer status synchronization

Staff PATCHes `/api/orders/:orderId/status`, updating the same MongoDB record that My Orders and Track Order read. Customer views reload from the API and poll for changes. There are no separate customer/staff status records or local fake status updates. Completion and cancellation both require confirmation in the staff UI and are checked on the server.

## 7. Verification

- `npm.cmd test -- --runInBand`: 6 suites, 76 tests passed, including ownership, trusted roles, registration and order-route checks. The report-disk-error log is an intentional failure-case test.
- `npm.cmd run build`: passed after the navbar change. Existing Vite/React plugin deprecation warnings remain nonblocking.
- `node scripts/check-persisted-workflow.mjs`: passed against real Express and persistent MongoDB in a uniquely named isolated test database. No shop orders were inserted. Test files/reports and the test database were removed afterward.
- Browser sequence: customer login; Polo Shirt checkout with quantity 12, XL, Red and a PNG; verify stored customer ID/specifications/file and Pending status; restart Express and verify persistence; logout; staff login; find/open order; view the protected image; Confirmed; logout/customer login; verify both My Orders and Track Order; repeat for Processing and Ready for Pickup; verify completion confirmation and Completed synchronization.
- Additional browser/API checks: customer staff URL/API denied, other-customer order/file access denied, invalid status jump rejected, staff admin URL denied, guest order saved, new order appeared through polling, non-apparel specifications displayed, cancellation confirmation enforced, private guest tracking returned the saved Cancelled status.
- Local `services:start` was run repeatedly and reused the reachable services. The final Express source was loaded by restarting only the API, preserving the running database.
- Live evidence: the user confirmed their real staff account can open the dashboard after the 502 fix.

Limit: automated workflow tests simulate Supabase identity responses to avoid using real account passwords. They do not prove a live customer password/Google OAuth checkout. No real customer account or order was created by these tests. A live customer checkout is the remaining account-level acceptance check; no backend availability blocker remains in this local environment.

## 8. Environment and startup

No additional environment values are needed on this machine for the now-running local workflow. Keep the existing `.env` values. Essential configuration is `MONGODB_URI`, Supabase URL/public anon key (same project frontend/backend), `PORT=4000`, and the existing JWT secret for legacy compatibility. Keep `ALLOW_IN_MEMORY_DB=false` for real orders.

From the nested application directory:

```powershell
# Normal local startup: database/API readiness, then Vite
npm.cmd run dev

# If the frontend is already running:
npm.cmd run services:start
```

Services remain running after Vite closes; they are not installed as Windows services. Run the startup command again after reboot. Logs and the preserved executable are under `%LOCALAPPDATA%\BMPrinting`. Back up the MongoDB data and the existing `uploads/orders` directory together. This launcher is for local development; a hosted shop needs a managed persistent MongoDB/API deployment and `/api` reverse proxy.

On another machine, install MongoDB or configure a reachable persistent `MONGODB_URI`. Optional `MONGOD_BINARY` and `MONGODB_DATA_DIR` specify an installed executable and existing local data directory. Do not point at a new empty directory expecting old orders to appear. The launcher does not download MongoDB automatically.

## 9. SQL/RLS and manual database steps

No SQL, Supabase table migration, or RLS policy change is required or has been executed. No RLS policy was disabled. Existing Supabase policy catalog access was unavailable with the public credentials; no claim is made that private project policies were audited. The application's order authorization is enforced by Express over MongoDB, rather than Supabase order-table policies.

No manual database operation is required for this local setup. Keeping the existing MongoDB architecture was the smaller fix; migrating orders to Supabase was unnecessary and was not performed. The user's existing staff role assignment remains intact.
