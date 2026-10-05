# Supabase staff accounts and authorization

> Update: the local MongoDB/API availability blocker below has been resolved. See [current workflow fix and verification](CUSTOMER_STAFF_WORKFLOW_FIX.md) for current runtime status and startup instructions.

## 1. Inspection and existing roles

Before this change, Google login used Supabase Auth, while email/password Login and Register called the older Express/MongoDB JWT endpoints. Profile changes were stored in the browser. The preceding order workflow already read a Supabase role from `app_metadata.role`; local accounts had a MongoDB `User.role`. These were existing systems, not authentication systems added for staff.

This implementation reuses **Supabase `auth.users.raw_app_meta_data.role`**, exposed by Auth as **`user.app_metadata.role`**. The application's roles are **customer**, **staff**, and **admin**. A missing or unrecognized Supabase role means customer. Editable `user_metadata.role` is ignored. Supabase documents that app metadata is appropriate for authorization because users cannot update it themselves: [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security).

Repository inspection found no Supabase profile table, order table migration, or RLS policy definitions. Read-only requests against the configured project's REST API returned `PGRST205` (not in the schema cache) for both `public.profiles` and `public.orders`; the schema endpoint returned 401. This does **not** prove that no private tables or policies exist. The available public key cannot inspect PostgreSQL's policy catalog. No live policies were changed or assumed safe.

Orders still use the existing MongoDB **`orders`** collection and Express API. Customer profile name/phone/address now persist in Supabase Auth user metadata. No new profile table is necessary for the features currently used by this application.

## 2. Files modified or added

- `shared/roles.js` (new): canonical roles, trusted Supabase user mapping, role landing pages and dashboard access rules.
- `shared/orderWorkflow.js`: limits staff privileges to staff/admin rather than older manager/production labels.
- `src/index.jsx`: verifies restored Supabase identity, handles role redirects, protected staff/admin pages and hash navigation.
- `src/components/Pages/LoginPage.jsx`, `RegisterPage.jsx`: Supabase password login and customer-only public signup.
- `src/utils/authActions.js` (new): tested signup whitelist and login behavior.
- `src/components/Pages/ProtectedDashboard.jsx` (new): verifies current server identity/role before rendering protected content, including direct URLs and revocation checks.
- `src/components/Widgets/Navbar.jsx`: distinct Staff Dashboard / Admin Dashboard navigation.
- `src/components/Pages/ProfilePage.jsx`: persists whitelisted profile fields and password changes through the correct authenticated provider; no role editor or browser-stored passwords.
- `src/components/Pages/StaffOrders.jsx`: authenticated reference/design viewer inside the existing order detail workflow.
- `src/components/Common/OrderDesignFiles.jsx` (new), `MyOrdersPage.jsx`, `TrackPage.jsx`, `src/utils/orderApi.js`: authenticated file fetching, safe image previews/downloads, customer ownership and private guest receipt support.
- `server/middleware/auth.js`: shared verified Supabase identity; separate staff/admin guards; legacy staff tokens rejected.
- `server/routes/auth.js`: verified `/api/auth/me`, safe legacy profile/password operations, optional legacy compatibility switch.
- `server.js`: protects administration APIs with admin authorization and mounts protected file routes.
- `server/routes/orderFiles.js` (new): order-scoped file listing/downloads and protected legacy download URLs.
- `server/designFiles.js` (new), `server/utils.js`, `server/routes/orders.js`, `server/db.js`: fixes uploaded-file field mismatch, validates file size/type, preserves original filename, and persists profile address for legacy accounts.
- `scripts/assign-supabase-role.mjs` (new), `package.json`: administrator-operated Supabase role assignment command.
- `supabase/inspect-auth-security.sql` (new): read-only schema/RLS/grants inspection queries.
- `tests/staffAccounts.test.js` (new), `tests/orderOwnership.test.js`: account, authorization, metadata-forgery, revocation, profile, legacy compatibility and file-access tests.
- `scripts/smoke-staff-ui.mjs` (new): repeatable headless Chrome checks with mocked Auth/API responses, without creating live accounts or orders.
- `.env.example`, `STAFF_ORDER_WORKFLOW.md`, `STAFF_ACCOUNTS.md`: configuration and handoff instructions.

## 3. Creating and assigning a staff account

No staff option appears on public registration. The same Register page calls `supabase.auth.signUp` with only email, password, full name and phone. It never submits a privileged role. Email-confirmation projects show a check-your-email message instead of claiming a logged-in session exists.

An administrator assigns an existing verified Supabase account:

1. The staff member registers normally and confirms their email, or uses their existing Supabase account.
2. The administrator obtains that account's UUID from Supabase Authentication → Users and checks its email.
3. In a **trusted administrator terminal**, provide `SUPABASE_SERVICE_ROLE_KEY`. The script uses the existing `VITE_SUPABASE_URL` or `SUPABASE_URL`. This secret is not needed in browser code and must never use a `VITE_` prefix.
4. Run from the project directory, replacing both placeholders:

```powershell
npm.cmd run staff:assign -- --user-id "SUPABASE_USER_UUID" --email "staff@example.com" --role staff
```

The script verifies UUID/email agreement and confirmed email, preserves unrelated app metadata, then uses Supabase's admin API to update `app_metadata.role`. Only a trusted environment with the service-role credential can run the operation. It does not create users, send invitations, expose a public role-changing endpoint, or accept role changes from a customer profile form. See [Supabase admin updateUserById](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid).

Use `--role customer` to remove staff privileges. The server reads the current Auth user on each protected request, so it does not rely on a stale role stored in browser state. Sign out/in afterward to refresh navigation. `--role admin` is also available to the trusted administrator when explicitly assigning an administrator account.

**No role assignment has been executed.** The required service-role key is not configured in the available environment. Do not send that key in chat or commit it to the repository.

## 4. Login destinations and protection

- Customer → customer home and existing customer pages.
- Staff → `/#staff`, with the Staff Dashboard and order processing only.
- Admin → `/#admin`, retaining the existing AdminPanel and order management.

The development SPA also recognizes `/staff` and `/admin`. On deployment, direct pathname navigation requires the web host's usual SPA fallback to `index.html`; hash URLs work without that rewrite. Manually navigating to a protected URL does not bypass authorization.

`ProtectedDashboard` first calls `/api/auth/me` and waits for a verified role. It rechecks on focus and periodically. A customer receives Access Denied for staff/admin pages; staff receives Access Denied for admin pages. The server independently checks every protected API operation:

- Supabase bearer token → Supabase Auth `/auth/v1/user` → current trusted app metadata role.
- Staff/admin can read processing orders, customer contact details, specifications and attached files, and perform the existing guarded status transitions.
- Product/inventory management, finance, reports/analytics, employee/customer directories, system operations and audit administration remain admin-only.
- Customer files require the same order ownership checks as customer orders. Guest file access requires the private receipt token. File IDs and legacy filename URLs cannot bypass ownership checks.
- Files are confined to the configured uploads directory, downloaded with no-store/nosniff headers, and only raster image formats are rendered as previews. HTML/SVG/PDF are never embedded as same-origin executable content by the viewer.

Staff statuses remain Pending → Confirmed → Processing → Ready for Pickup → Completed, with Cancelled from non-final stages. The existing server-side transition and concurrent-write checks remain in place. The status endpoint changes status/completion time, not arbitrary order fields supplied by a caller.

## 5. Legacy account compatibility

To avoid silently locking out existing customer/admin accounts, the existing MongoDB login remains a temporary compatibility fallback **only when Supabase reports invalid credentials**. MFA, unconfirmed-email errors, rate limits and provider failures do not trigger that fallback. This retains the old implementation; it does not introduce a new staff authentication service.

New public registrations use Supabase. New staff accounts must use Supabase; old MongoDB staff tokens are rejected. Existing MongoDB customer/admin accounts continue to use their stored roles and verified passwords until migrated. No existing account was migrated, deleted or promoted automatically.

After migrating the remaining legacy accounts and checking their Supabase roles, set:

```dotenv
ALLOW_LEGACY_AUTH=false
```

This disables the legacy login/register endpoints and acceptance of legacy JWTs, leaving Supabase as the sole authentication provider. While compatibility is enabled, revoking a legacy administrator requires changing that legacy account too; changing a different Supabase account does not revoke its independent legacy credentials. The previous report's MongoDB command for assigning staff is superseded by the Supabase assignment command above.

## 6. Database/RLS changes and manual SQL

**No schema migration or RLS policy change is required for this implementation, and no SQL has been executed.** The trusted role field already exists in Supabase Auth app metadata. Orders/files are still guarded by the existing server in front of MongoDB; adding RLS to an imagined Supabase orders table would not protect these MongoDB records.

RLS has not been disabled. To inspect the actual project's tables, policies and grants, an administrator can run [supabase/inspect-auth-security.sql](supabase/inspect-auth-security.sql) in the Supabase SQL Editor. It contains only SELECT queries. For example:

```sql
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname in ('public', 'storage')
order by schemaname, tablename, policyname;
```

The full script also lists profile/order/role columns, RLS-enabled flags and grants to anon/authenticated. This audit is **not a required migration** and has not been run with privileged database access. If it reveals a separate profile-role table, existing policies granting broader access, or another deployed order store, those findings must be reviewed before changing policies or introducing another source of role truth.

## Validation and remaining setup

- **76 tests passed across six suites.** New coverage exercises actual auth/file routes with a disposable MongoDB database and mocked Supabase verification, plus the frontend login/signup helpers.
- **Production build passed.** Existing Vite/plugin deprecation warnings remain.
- **Headless browser checks passed** for customer/staff/admin login destinations, customer/staff direct-URL denial, staff revocation, full order specifications, authenticated design preview, order confirmation and the mobile viewport. Auth/API responses in these browser checks are mocked.
- The configured persistent **MongoDB is still unreachable**. Restore it before accepting or processing live orders. Supabase login alone does not replace the existing order database.
- A real staff role still needs to be assigned by an administrator; no live login credentials were supplied or used in testing.
- Full RLS catalog inspection remains pending privileged execution of the read-only audit above. No claims are made about unseen policies.
- Older uploaded files whose order metadata was never saved cannot be safely associated with customers automatically. Newly uploaded files now preserve the correct filename/path/type fields. Existing valid file references remain supported.

Run the backend and frontend normally after restoring MongoDB. Complete one real customer checkout, sign in with an assigned Supabase staff account, open the order/design, and progress its status while observing the customer's My Orders/Track Order. This live acceptance check remains necessary; mocked provider tests do not establish live OAuth or database availability.
