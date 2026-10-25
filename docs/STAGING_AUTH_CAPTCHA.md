# Staging email/password CAPTCHA investigation

## Evidence and limits

- Login already calls `signInWithPassword({ email, password, options: { captchaToken } })` with the widget callback response. Signup forwards the response through `signUp.options.captchaToken`.
- There is no Render/Siteverify call in either authentication path. The backend verifier is used by anonymous contact submissions only. Supabase must perform the authentication token verification itself.
- The deployed frontend inspected on 2026-10-26 contains one production-format Turnstile site key and no built-in dummy site key. Its Supabase client contains one project URL. The deployed URL matches `BM_QA_SUPABASE_URL` in local `.env.qa.local` (the QA launcher maps this to `VITE_SUPABASE_URL`). No project-target mismatch was found. This does not verify the CAPTCHA provider or secret configured in that project.
- Confirmed code gaps: the guard accepted nonempty tokens regardless of challenge status; login/signup had no synchronous duplicate-submission lock; reset did not mark the widget status as loading. The correction requires ready status, claims each token synchronously, clears page token/status before the asynchronous import/request, and resets after success or failure. A repeated callback carrying the last consumed response is rejected.
- These gaps are reproducible in regression tests. They do **not** establish the root cause of the reported first-attempt Incognito rejection. Provider configuration and an actual browser request have not been inspected through authenticated dashboards. A widget showing Success proves challenge completion, not successful server-side validation with Supabase's configured secret.

## Settings that must agree (manual checks only)

| Service | Required setting | Contract |
| --- | --- | --- |
| Cloudflare Turnstile | Widget site key and secret pair | The public key embedded in the deployed frontend and Supabase's secret must belong to the same active widget. Verify privately in dashboards; never paste secret values into chat, logs, screenshots, or repository files. Check whether a secret was rotated. |
| Cloudflare Turnstile | Allowed hostname | Include `bm-printing-services.vercel.app` as a hostname, without scheme or path. Add preview/custom hostnames separately if used. The Render/Supabase API hostname is not the browser hostname. |
| Vercel | `VITE_TURNSTILE_SITE_KEY` | Set the real public site key for the environment serving the affected URL. A real widget secret must not be used as the public key. |
| Vercel | `VITE_TURNSTILE_USE_TEST_KEYS` | False or absent. Production builds ignore this switch because the override is guarded by `import.meta.env.DEV`; nevertheless do not configure test credentials for staging. Explicitly setting a dummy site key would still be incorrect. |
| Vercel | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Both must belong to the intended BM Printing QA project. Check the deployed request host against its dashboard project reference, rather than trusting the display name or a local env file. Use only a public browser key. |
| Vercel | Environment scope and build | Confirm the deployment's branch is `staging` and whether its environment scope is Production or Preview. A staging branch may serve a Vercel Production deployment. Vite substitutes `VITE_*` values at build time; a dashboard edit requires a new build/deployment. Local `.env.qa.local` is not automatically loaded by a default production build. |
| Supabase BM Printing QA | Authentication CAPTCHA protection | Keep enabled; provider must be Cloudflare Turnstile, with the matching real widget secret. Configuring a secret in Render does not configure Supabase Auth. |
| Supabase BM Printing QA | URL Configuration | Site URL should be the staging frontend; allow its `/auth/confirm` callback. This supports confirmation/OAuth redirects and is separate from Siteverify token validation. |
| Render | `TURNSTILE_SECRET_KEY`, `TURNSTILE_HOSTNAMES` | Used for guest contact verification, not password login. Never pre-verify an authentication response here: tokens are single-use. No Render change is indicated for this login investigation. |

The QA launcher intentionally uses Cloudflare dummy credentials for local widgets/contact verification. It cannot change the hosted Supabase CAPTCHA secret. If hosted Supabase Auth uses a real secret, tokens generated with a dummy site key will fail even when the local widget shows Success. Do not disable CAPTCHA or swap a shared staging project to test credentials as a workaround; use matching real widget credentials for manual auth QA or a separately isolated test configuration.

## Distinguish configuration from lifecycle

1. Open the deployed page in a fresh Incognito window with DevTools Network open. Complete a new challenge and submit once promptly. Do not export a HAR or copy request payloads containing passwords/tokens.
2. Confirm exactly one password-grant request goes directly to the intended QA project's `/auth/v1/token?grant_type=password`. The SDK serializes `options.captchaToken` as `gotrue_meta_security.captcha_token`; check only that the field is a nonempty string. The public site key or widget ID is not a response token. Do not send the response to Siteverify manually: that would consume it.
3. Check the response error and corresponding Supabase Auth logs without copying credentials. If a new token, correct host, and single request still produce `invalid-input-response`, privately verify the key/secret pair, real versus dummy credentials, provider, project, and secret rotation. The error alone cannot identify which setting is wrong. Cloudflare ordinarily reports an expired or duplicate response as `timeout-or-duplicate`.
4. After any failed attempt, confirm the widget resets. Wait for a fresh successful challenge before retrying. A duplicate click must create only one request. Repeat signup with a separate fresh token if registration is intentionally being tested; signup creates an account, so it was not performed during this investigation.
5. After a manually authorized configuration correction or deployment, repeat password login for the existing QA account. Leave Google OAuth and role metadata unchanged.

No database records, provider settings, commits, pushes, or deployments are needed to inspect these contracts. The local lifecycle patch requires a reviewed Git change and a later frontend deployment to affect staging. A confirmed dashboard mismatch additionally requires its own manual correction; a Git patch alone cannot repair a mismatched secret.

References: [Supabase CAPTCHA](https://supabase.com/docs/guides/auth/auth-captcha), [Cloudflare validation and error codes](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), [Cloudflare test credentials](https://developers.cloudflare.com/turnstile/troubleshooting/testing/).
