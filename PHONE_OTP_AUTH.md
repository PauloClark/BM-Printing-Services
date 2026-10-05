# Phone / SMS OTP Authentication (Supabase Phone Auth)

BM Printing Services supports three sign-in methods on the same Login page and
Register page. **None of them replace each other:**

| Method | Where it runs |
| --- | --- |
| Email + password | Supabase Auth (unchanged) |
| Google OAuth | Supabase Auth (unchanged) |
| Phone / SMS OTP | Supabase Phone Auth (**new**) |

## Architecture

```
Customer
   ↓  enters Philippine mobile number (0917 123 4567 → +639171234567)
Cloudflare Turnstile (server-verified, reuses the existing /api/turnstile/verify)
   ↓
Supabase Phone Auth (signInWithOtp)
   ↓
SMS provider configured in the Supabase Dashboard
   ↓
Customer receives a 6-digit OTP
   ↓  customer enters the code
Supabase (verifyOtp) → authenticated session
   ↓
Same customer session as email/Google: Products, Order Now,
My Orders, Track Order, Logout
```

The OTP is **never** generated, stored, logged or validated in application code.
Supabase GoTrue issues, expires and verifies it. The browser only relays the
digits once.

## Security properties

- No SMS provider secret exists in `.env`, in any `VITE_*` variable, in React
  components or in any Git-tracked file.
- Codes are never written to `localStorage`, `sessionStorage` or the database.
- Verification is delegated to Supabase; the client cannot approve itself.
- A resend cooldown mirrors the Supabase OTP expiry window, and the Send button
  is disabled while a request is in flight.
- Send-OTP is gated by the existing server-side Turnstile verification, so the
  SMS provider cannot be used as a free SMS relay.
- Roles come only from Supabase `app_metadata.role` (server-controlled). A
  phone-authenticated customer is always `customer` and cannot self-assign
  `staff` or `admin`; `user_metadata` is ignored for authorization.

## Manual Supabase Dashboard configuration (required)

The application code is complete, but **SMS delivery cannot work until an SMS
provider is enabled in your Supabase project.** Do this in the Supabase
Dashboard UI, not in the repository:

1. Sign in to the Supabase project that matches `VITE_SUPABASE_URL`.
2. Go to **Authentication → Providers → Phone**.
3. Enable the Phone provider.
4. Pick your SMS provider (Twilio is the most common; Semaphore, MessageBird,
   and Vonage are also supported) and enter that provider's credentials in the
   Supabase form. These credentials stay in Supabase — do not add them to
   `.env`, and do not paste them into this repository or chat.
5. Set the **SMS OTP Expiry** and rate limits to your intended values. The app's
   resend countdown follows this setting (60s is the Supabase default).
6. Save. Send a test OTP from the Dashboard's provider test tool, then use a real
   Philippine mobile number in the app.

> The `SMS_API_KEY` entry in a local `.env` is unrelated to this flow: no
> application code references it, and Supabase Phone Auth does not read it. It
> is correctly placed server-side and git-ignored. You can leave it as-is or
> remove it from `.env`; do not move it into any `VITE_` variable.

## Environment variables

Phone/SMS OTP requires **no new environment variables.** It reuses the existing
Supabase public anon key on the frontend. Only variable *names* are listed here;
never commit their values.

- `VITE_SUPABASE_URL` (existing, public)
- `VITE_SUPABASE_ANON_KEY` (existing, public — safe in the browser by design)
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` (existing, optional server-side aliases)

## Testing with one phone number

1. Complete the Supabase Dashboard steps above.
2. Run the app: `npm run dev`.
3. Open Login → **Phone** tab (Register → **Phone** behaves identically).
4. Enter a Philippine mobile number, e.g. `0917 123 4567`. It is normalized to
   `+639171234567`.
5. Complete the Turnstile widget, then click **SEND OTP**.
6. Enter the 6-digit code from the SMS and click **VERIFY OTP**.
7. You are signed in as a customer. Confirm Products, Order Now, My Orders,
   Track Order and Logout all behave exactly as with email sign-in.
8. Confirm `#staff` and `#admin` are still refused for this account.

Invalid input such as `0917` is rejected before any network call, and a wrong
code shows a safe message without revealing provider detail.