# Staff order processing implementation

> Update: the local MongoDB/API availability blocker below has been resolved. See [current workflow fix and verification](CUSTOMER_STAFF_WORKFLOW_FIX.md) for current runtime status and startup instructions.

Account creation, role assignment, and current authentication details are superseded by [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md). Staff accounts now use Supabase; the old MongoDB staff assignment method is no longer supported.

The existing application was inspected before changes. Supabase provides Google/customer authentication; Express and Mongoose store orders in MongoDB. There is no existing Supabase orders table or SQL/RLS migration in this project. The implementation retains that architecture and existing records.

## 1. Files changed

- `shared/orderWorkflow.js` (new): shared processing statuses, legacy display mapping, transitions and staff roles.
- `server/routes/orders.js`: authenticated/guest persistence, staff list, private guest tracking, guarded atomic status updates, preserved specifications, explicit failures.
- `server/middleware/auth.js`: verified staff authorization for local JWT and Supabase identities; optional guest authentication rejects invalid supplied tokens.
- `server/middleware/validate.js`: accepts the processing statuses.
- `server/db.js`: additive order fields/status values and staff role; no silent temporary database fallback.
- `server/utils.js`: serializes saved printing specifications.
- `server.js`: loads environment before auth initialization; guards legacy order/production/search endpoints; retires legacy status mutation routes; includes current statuses in dashboard calculations.
- `src/utils/orderApi.js` (new): shared authenticated API requests and private guest receipt token storage.
- `src/components/Pages/StaffOrders.jsx` and `StaffOrders.css` (new): responsive summary, searchable/filterable order table, full details, guarded actions, refresh/error states.
- `src/components/Pages/AdminPanel.jsx`: integrates Orders as the initial staff/admin section, keeps existing admin sections, updates token handling.
- `src/index.jsx`: removes fake/sample/local order success, submits through the API, refreshes saved orders, recognizes trusted staff roles.
- `src/components/Pages/OrderPage.jsx`: requires a server-confirmed receipt and displays a private guest tracking code.
- `src/components/Pages/MyOrdersPage.jsx`: periodically reloads owned database orders.
- `src/components/Pages/TrackPage.jsx`: fetches the actual order with ownership checks or a private guest receipt token, refreshes status.
- `src/components/Common/Badge.jsx`, `src/constants/products.js`: consistent status labels/colors with legacy compatibility.
- `src/components/Widgets/Navbar.jsx`: staff dashboard entry using the shared role rules.
- `tests/orderOwnership.test.js`: actual route integration coverage for checkout, staff authorization, progression, synchronization, cancellation, races, guest privacy and report failures.
- `.env.example`: documents Supabase settings and persistent database requirements.
- `STAFF_ORDER_WORKFLOW.md` (this report).

## 2. Order storage

MongoDB collection **`orders`**, accessed through the existing Mongoose **`Order`** model. Staff list, customer list, customer tracking and guest tracking all read this same collection. No alternate order store was added. Browser storage holds only guest access tokens, not order statuses or fake successful orders.

## 3. Status field and transitions

Field: **`status`**.

`Pending → Confirmed → Processing → Ready for Pickup → Completed`

Cancellation is available from any of the four non-final stages. Completed and Cancelled orders cannot be reopened. New orders always start Pending, regardless of client-supplied status. The server enforces transitions, checks the staff view's expected status, and performs a conditional atomic update to prevent conflicting writes. Completion records `completedAt`.

Existing legacy values remain permitted in the schema so existing data is not rewritten: Quoted, Payment Pending, Paid, Queued, In Production, Quality Check and Ready. Display/next-action mappings normalize them: Quoted → Pending; Payment Pending/Paid/Queued → Confirmed; In Production/Quality Check → Processing; Ready → Ready for Pickup. New status writes use the six canonical values above.

## 4. Staff authorization

`requireOrderStaff` runs on the server. Authorized roles are `admin` and `staff`. Other roles do not receive order management access.

- Existing login: verify the JWT, then read the current MongoDB User role (including role revocation).
- Supabase login: verify the bearer token against the configured Supabase Auth user endpoint. Staff authority comes only from trusted `app_metadata.role`, never editable `user_metadata`.
- Frontend role checks control navigation only; they are not the security boundary.
- Customer API results retain the existing verified ID/email ownership approach, including legacy orders associated with that email.
- Older global order search, analytics, production and file management APIs now require staff. Legacy production mutation routes return an instruction to use Orders, so they cannot bypass the state machine.

To assign staff, use the administrator-controlled Supabase method in [STAFF_ACCOUNTS.md](STAFF_ACCOUNTS.md). No account roles were changed automatically.

## 5. New order visibility

Checkout calls `POST /api/orders` and only shows success after the server confirms persistence. Staff Orders reads `GET /api/staff/orders` on mount, every five seconds, on window focus, or via Refresh. A committed order is queryable immediately, and an already-open staff list displays it at the next refresh. Failed saves are never shown as received orders.

Supabase Realtime does not subscribe to MongoDB collections. No Realtime publication configuration is required or claimed. Moving orders to Supabase would require a separately planned data migration and RLS design; this implementation deliberately retains the existing database.

## 6. Customer synchronization

Staff changes `PATCH /api/orders/:orderId/status`. My Orders reads `/api/customers/orders`; Track Order reads `/api/customers/orders/:orderId`. Both refresh every five seconds and on focus. They read the same updated Order document.

Guests receive a random private tracking code; only its hash is saved with the order. `GET /api/guest/orders/:orderId` requires that code in `X-Order-Token`. The receipt shows the code, and the browser remembers it for convenience. A guest can use the code on another device. Order ID/email alone does not grant public access. My Orders remains an authenticated account page.

## 7. Required configuration; SQL/RLS

**No Supabase SQL or RLS changes are required or applied.** No live order data was migrated or edited.

The backend needs the same Supabase project settings as the frontend and a reachable persistent MongoDB instance. Example configuration (replace placeholders; do not replace a working database with a different empty one):

```dotenv
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/bmprinting
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
JWT_SECRET=YOUR_EXISTING_STRONG_SERVER_SECRET
ALLOW_IN_MEMORY_DB=false
```

The server also accepts `SUPABASE_URL` / `SUPABASE_ANON_KEY` aliases. Keep the existing MongoDB URI if it points to your real data; restore that database's availability instead. Start the backend with `npm.cmd run server` and frontend with `npm.cmd run dev` on this Windows environment. Deployment must route `/api` to Express; Vite already proxies it locally.

Temporary MongoDB is allowed only when explicitly setting `ALLOW_IN_MEMORY_DB=true` outside production. It is for disposable development data, never for real orders. The server now fails visibly if persistent storage is unavailable instead of silently switching to a database that loses orders on restart.

## 8. Verification and remaining blockers

- Production frontend build passed. Existing Vite/plugin deprecation warnings remain.
- Vite server-render smoke checks passed for admin Orders, staff Orders, and guest Track Order. These are render checks, not browser interaction or visual-layout tests.
- Full test suite passed: 5 suites, 64 tests, including 13 real order-route integration tests. Supabase responses are mocked for identity verification; the order database in these tests is a disposable MongoDB instance.
- The configured Supabase Auth health endpoint returned HTTP 200.
- The configured MongoDB could not be reached within five seconds. No MongoDB Windows service, `mongod`, or Docker executable was found through the available service/PATH checks. Restore the configured persistent database before accepting real orders.
- No real customer session or live Google OAuth checkout was exercised. Those flows require the running backend/database and an actual login; mock-auth integration tests do not prove the live provider-to-database flow.
- The previous guest 'success' path could succeed only in browser storage after API failure. That fallback is removed. The authenticated path's failures are now surfaced, field errors are readable, and a secondary spreadsheet failure no longer reports a committed order as failed. The exact historical live failure cannot be reproduced without the database; database unavailability is a verified current blocker.
- Payment method is stored; the existing system has no persisted payment verification field on Order. Details correctly say payment status is not recorded rather than inventing a Paid status. Confirm payment separately using the existing business process.
- Existing browser-only sample/guest orders are not uploaded automatically because their persistence and ownership cannot be trusted. Existing database records remain intact.

After restoring the database, validate one authenticated customer order and one guest order, open each from Staff Orders, progress the authenticated order through all stages, verify My Orders/Track Order from another session, then test customer denial and cancellation. Keep real customer data out of disposable test environments.
