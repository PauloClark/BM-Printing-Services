# Phase 5C.1A — dependency security, deployment validation and CI

Scope: repository-only changes on `staging`, following the [Phase 5C audit](PHASE_5C_PRODUCTION_READINESS_AUDIT.md), baseline `1240b2a`. The original audit and the excluded local smoke script are preserved. No business workflow, UI, cloud configuration, persistent database, or customer operation is changed. No commit, push or deployment is authorized by this patch.

## Dependency decisions

The baseline production audit reports **four affected packages, representing three underlying advisories**. ExcelJS is counted separately as an affected parent of its vulnerable UUID dependency.

| Affected package/path | Baseline / advisory | Compatible fix / decision |
| --- | --- | --- |
| Express 4.22.3 → `body-parser` | 1.20.8, **HIGH**, compressed request-body DoS, [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | Lock to resolved **1.20.9**, within Express's existing `~1.20.5` constraint. No Express major upgrade. |
| express-rate-limit 8.7.0 → `ip-address` | 10.7.2, **MODERATE**, IPv6 zone parsing complexity, [GHSA-rxp7-6hxx-x8q5](https://github.com/advisories/GHSA-rxp7-6hxx-x8q5) | First fixed 10.7.4; resolved **10.7.5**, within existing `^10.2.0` constraint. |
| ExcelJS → `uuid` | 8.3.2, **MODERATE**, buffer bounds in v3/v5/v6 APIs, [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | **Unresolved blocker**. First patched UUID is 11.1.1; no patched UUID 8 was available in registry inspection. |
| `exceljs` (affected parent) | 4.4.0, **MODERATE**, inherits the UUID finding | **Unresolved blocker**. Latest published ExcelJS is still 4.4.0, requiring `uuid ^8.3.0`. npm suggests an ExcelJS downgrade to 3.4.0; it is not a compatible security update. No downgrade or out-of-range UUID override applied. |

ExcelJS's inspected Node source imports UUID `v4`, while the advisory concerns other UUID entrypoints. This narrows the apparent call-path exposure but is **not** an exemption, suppression or clean-audit claim. A separately reviewed dependency replacement/override needs explicit CommonJS, XLSX read/write, conditional-formatting and report compatibility validation. The application's direct UUID 14.0.2 is separate and unchanged.

Two tooling findings were also resolved with compatible patches:

- Vite **8.1.4 → 8.1.6**, pinned to the first patched release rather than taking a new minor/major. This addresses the audited Vite editor-launch/path/cross-origin findings (including [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm)). Node 24 remains supported.
- mongodb-memory-server-core → follow-redirects **1.16.0 → 1.16.1**, within the existing range, addressing [GHSA-q3jh-wrc6-jgq8](https://github.com/advisories/GHSA-q3jh-wrc6-jgq8) and [GHSA-8r9p-f939-6h3c](https://github.com/advisories/GHSA-8r9p-f939-6h3c).

Lockfile changes include npm-generated peer metadata and optional native/WASM dependency relocation. They must be reproducible with ordinary `npm ci`; no `--force`, audit exemption or automatic audit-fix operation is used. Existing Babel 8 versus some Babel 7 syntax-plugin peer constraints emit installation warnings and remain visible; no unrelated Babel major migration is attempted.

The baseline lockfile also resolved `mongodb-memory-server-core@10.2.3`'s declared `mongodb ^6.9.0` dependency to incompatible `mongodb@7.6.0`. A clean install reproduced that invalid tree, and the disposable replica-set tests failed at the driver handshake. A package-scoped override now selects `mongodb@6.21.0`, the latest compatible 6.x release, only below `mongodb-memory-server-core`. The application's production MongoDB driver remains 6.20.0. `npm ls` reports the corrected test dependency as a valid intentional override, and the failed suites plus the full regression pass after a clean install.

## Deployment contract and enforcement

The standalone frontend/backend validators remain available. The same pure validator now runs before the deployed API's first database connection, and before Vercel/deployment-marked Vite builds. A local unmarked Vite build does not suddenly require cloud credentials. Local and QA modes still reject unapproved client variables. Direct backend module imports remain possible without starting a server or connecting to a database.

- Deployed backend `NODE_ENV` must be `production`, **including the staging service**; `DEPLOYMENT_ENVIRONMENT` selects staging versus production data. Missing deployment environment fails before connection when production/Render markers identify a deployed backend.
- Staging requires `bmprinting_staging`; production requires `bmprinting`. Atlas SRV hostname must end in `.mongodb.net`, have no port/fragment, and any URI database path/`dbName` option must agree with `MONGODB_DB_NAME`. Duplicate options and explicit insecure TLS/certificate/direct-connection settings are rejected. Optional pool/selection-timeout values must be positive safe integers.
- The host syntax check is not proof that a particular cluster, database user, network rule, backup plan or replica-set configuration has been approved. Those dashboard and recovery checks remain manual. The validator does no DNS lookup, credential authentication, database read or write.
- Separate frontend and backend required-variable sets are maintained. Public API/app URLs must be exact public HTTPS origins. Supabase URLs/keys must agree when both service sets are present. Public keys must be publishable/anon; backend administrative keys must be secret/service_role. Legacy JWT role inspection checks scope/shape, **not its signature**; real validity is still checked by Supabase.
- Missing or malformed CAPTCHA settings fail; known dummy site/secret keys fail even with test switches off. Actual Cloudflare/Supabase pairing and hostname authorization are not proven by syntax validation.
- Only the existing app's public `VITE_*` names are allowed. Server secret values must not be duplicated into a public variable. Backend and build diagnostics report variable names/requirements without echoing values. CI bundle scans additionally reject known server-secret canaries, service-role JWTs and recognizable private credential formats.
- Legacy Auth is not silently opted in by an omitted flag on deployed startup: all required feature flags must validate before the server connects. The existing explicitly approved legacy-auth exception contract remains; no authorization/business handler was rewritten.

Before reviewing a staging deployment, privately check the Render/Vercel environment against the strengthened contract, especially `NODE_ENV`, `DEPLOYMENT_ENVIRONMENT`, URI host/path/options, Supabase key scope and exact origins. Only variable names should be recorded in review evidence; do not paste credentials. No dashboard changes were made here.

## CI behavior

`.github/workflows/ci.yml` is the single new staging verification pipeline: pushes to `staging` and pull requests whose **base** is `staging`. The existing `deploy.yml` remains byte-for-byte unchanged and retains its separate main/Pages/manual behavior. The new pipeline has no deploy, seed, migration or cloud-write step.

- Ubuntu 22.04 (compatible with the disposable MongoDB 7.0.14 fixture), Node 24, lockfile-based `npm ci` with no peer-check bypass.
- Read-only `contents` permission; checkout credentials are not persisted. Checkout/setup-node actions are pinned to reviewed v4 commit SHAs. No repository/environment/application secrets are referenced.
- Regression job: source scan → synthetic staging/production frontend/backend/combined validation → isolated full Jest → production Vite build with synthetic public configuration and backend canaries → bundle scan → tracked-diff/whitespace checks. The build helper never starts the API or connects to the synthetic hosts.
- Independent production-security job: `npm audit --omit=dev`, at **all severities**. It fails on the remaining ExcelJS/UUID advisories. There is no continue-on-error or allowlist for these findings, and an audit failure does not hide the separate regression/build job's outcome.
- Clear job names and always-run GitHub step summaries distinguish failed security gating from failed application regression. There is no `pull_request_target` trigger or privileged production environment.

Owner action after a future approved push: review the actual Actions run and configure branch protection/required checks manually. This patch does not change repository settings. The legacy main deployment workflow still needs a separate production release decision.

## Verification commands and native exit codes

```text
npm ci
npm test
npm run build:ci
npm run validate:ci-env
npm audit --omit=dev
npm audit
npm run scan:secrets
npm run scan:bundle
git diff --check
```

`build:ci` invokes the production Vite build under in-memory synthetic values; ordinary `npm run build` remains the production build command. Test subprocesses strip application credentials/targets/feature flags and prevent ignored environment-file loading. Tests use their disposable MongoDB fixtures; no persistent target is provided. Production-startup regression tests intercept Mongo connection attempts before exercising invalid configurations.

`npm test` now uses a Node subprocess runner for both Jest configurations, checks native exit codes, and stops on the first failing configuration. This avoids shell `&&`/PowerShell redirection ambiguity. On Windows, verification logs are captured with direct file descriptors in a Node parent, and the command's native status is retained. PowerShell 5.1 can mark redirected stderr as `NativeCommandError` even for a successful child; that is not used to reinterpret a real audit/test exit 1 as success.

Source checks are pattern-based, include tracked and nonignored text release inputs, and exclude the preserved local smoke script. Bundle checks include exact server values from the process, synthetic canaries, and local ignored environment values compared in memory only. These checks are not a Git-history scan or a guarantee against every unknown secret format. They never print matched credential values.

Local verification on Node 24.11.0/npm 11.6.2:

- Fresh `npm ci`: passed, native exit 0. The expected Babel peer warnings and deprecated transitive-package notices remain visible.
- Focused deployment/security suite: 7 suites and 46 tests passed. The two disposable MongoDB suites that exposed the invalid driver resolution then passed independently (2 suites, 14 tests).
- Full `npm test`: 34 CommonJS suites/336 tests and 1 ESM suite/3 tests passed; both Jest child processes returned native exit 0. Expected error-path logging and replica-set shutdown warnings did not fail tests.
- `npm run build` and synthetic `npm run build:ci`: passed with Vite 8.1.6.
- Offline staging/production validation: passed for separate frontend, backend and combined contracts, plus the negative database test.
- Repository source scan: 207 files, zero findings. Synthetic frontend bundle scan: 45 files, zero findings. These have the limitations stated above.
- `git diff --check`: passed (Git emitted only line-ending conversion notices).
- Final production and complete audits: native exit 1 with 2 moderate affected packages (`exceljs` and its `uuid` dependency), zero high or critical findings. That nonzero result is intentional evidence that the CI security gate remains closed.

Until the remaining production advisories are resolved, this patch cannot make the production security gate green or change the overall production NO-GO verdict.
