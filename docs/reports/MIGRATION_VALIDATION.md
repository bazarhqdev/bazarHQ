# Migration and backend validation report

What was run against this repository, how, and the results. Every number below comes from a run on 28–29 Oct 2026, after the last code change.

## Environment

Docker images can't be pulled in this build environment, so `supabase start` and `supabase test db` (both start containers) could not run. The same checks were run without Docker:

| Supabase component | Used here |
|---|---|
| Postgres image | PostgreSQL 16.10, initialised with Supabase's own init scripts (vendored from `supabase/postgres`, role demotion included) |
| Auth (GoTrue) | Real `supabase/auth` v2.177.0 binary: its own 54 auth migrations, the BazarHQ hooks, TOTP |
| PostgREST | Real PostgREST binary |
| Edge runtime | Real function code on Deno 2.9 (`scripts/local-stack/functions-router.ts`) |
| storage-api | Emulated: Storage RLS enforced by running each object statement as the caller (`scripts/local-stack/gateway.mjs`) |
| Realtime | Not run |
| Supabase CLI | v2.121.0: `db lint` ran against the database; `config.toml` parsed by the CLI |

## Results

| Command / check | Result |
|---|---|
| All 15 migrations apply in order on a fresh database (harness and stack) | Pass, every run |
| Migrations apply on top of GoTrue's **real** auth schema (stack) | Pass |
| `supabase db lint --schema public,private --level warning` | **No schema errors found** |
| plpgsql_check over every `public` function (`run.sh --lint`) | No errors or warnings |
| pgTAP: 11 files (`scripts/db-harness/run.sh`, equivalent of `supabase test db`) | **499 / 499** assertions |
| Supabase advisor (splinter) | Expected findings only; see SECURITY_AUTHORIZATION.md and `verification/db/splinter.txt` |
| Edge Functions: `deno check` (all 23 + shared), `deno lint`, `deno fmt --check` | Pass |
| Edge Functions unit tests (`deno test`) | 15 / 15 |
| Service layer end-to-end against the stack (`adapter-flows.mts`), fresh database | **42 / 42** steps |
| Web app in Supabase mode, in a browser (`web-smoke.mjs`) | 10 / 10 steps (run on the build before migration 015 and a small import refactor; neither touches those pages) |
| Frontend: format, typecheck, lint, 51 unit tests, `npm run build` | Pass |
| Frontend (mock mode): web routes / web e2e flows / Android routes | 137 / 137, 32 / 32, 57 / 57 |
| `npm run cap:sync` | Pass |
| Service-role key in web bundle or APK assets | None. The only `service_role` string is the guard that refuses one; no JWTs in bundles |

### pgTAP files

| File | Assertions | Covers |
|---|---|---|
| `database_schema.test.sql` (supplied, unchanged) | 16 | Tables, columns, keys |
| `database_integrity.test.sql` (supplied, corrected; see TEST_CORRECTIONS.md) | 22 | Constraints, stock model, address limit, immutability, dual approval, one store per merchant |
| `payment_transactions_safeguards.test.sql` (supplied, corrected) | 24 | Option B attempts, idempotency, duplicate prevention, terminal states |
| `rls_policy_catalog.test.sql` | 46 | RLS on every table, grants, which functions anon/authenticated/service_role may execute, Storage policies |
| `rls_behavior.test.sql` | 69 | Tenant isolation, customer privacy, public storefront, Storage RLS, Super Admin gate |
| `order_payment_inventory.test.sql` | 102 | Atomic order creation, oversell, order transitions and invalid cancellation, wallet/card/COD flows, verification safeguards, stock restore once, catalogue RPCs |
| `returns_refunds_support.test.sql` | 84 | Return window, one per order, refunds and safeguards, ticket routing, 72-hour escalation, audit |
| `admin_governance_auth.test.sql` | 67 | Auth hooks, role assignment, suspension, themes, announcements, policies, notifications, device tokens, dashboards |
| `schema_hardening.test.sql` | 4 | FK indexes, per-statement auth calls in policies, primary keys |
| `visits_sessions.test.sql` | 40 | Visit analytics privacy, own sessions, session revocation on suspension, media paths |
| `adapter_alignment.test.sql` | 25 | Migrations 012–015, including a regression test that fires the deferred stock checks as a client |

### End-to-end steps (`adapter-flows.mts`)

Run as separate clients for two merchants, two customers, a guest and two Super Admins, through `createSupabaseServices`:

registration with a server-assigned role · subdomain rules · one store per merchant · logo upload through Storage RLS · cross-tenant upload refused · publish blocked until the checklist is complete · simple/variant products with images · duplicate (draft, stock 0, unique SKU) · COD vs. bKash credential rule (masked) · publish · store discovery returns stores only · unknown/draft store same error · storefront contact, slug lookup, anonymous signed image URLs · cart revalidation · COD order (atomic, idempotent, address saved) · oversell refused with no partial change · bKash → `pending_verification` → server-verified `paid` · failed wallet attempt keeps the order retryable, and cancellation releases stock exactly once · retry after failure ends paid · Rocket manual review (reason required, audited, other merchant refused) · SSLCommerz: browser return doesn't mark paid, simulator callback does, replay changes nothing · clients can't set payment status, write stock, insert payments or change role · tenant isolation · customer privacy · new-order notification · order state machine incl. invalid jump, missing reason, blocked cancellation and idempotent replay · COD amount check · inventory never negative, idempotent adjustment, ledger · analytics, CSV exports, customers · tracking (right phone works; wrong phone gets the same not-found) · return with evidence photo, one per order · approve → receive (restock once) → refund (amount cap; client can't complete it) → settle with reference · ticket routing to the store, reply, resolution needs a note, other merchant can't see it · platform queue, early escalation refused · notifications, unread count, masked device token · no default Super Admin; bootstrap via `grant_super_admin` + TOTP · admin sign-in (network → password → TOTP; wrong code refused) · aal1 admin session gets no admin data · admin dashboard, health, merchants, customers, stores, orders (direct status change refused) · themes, announcement (sent is immutable), policy dual approval · suspension (reason, store hidden, orders still trackable, sign-in refused) and reinstatement · audit log with IP, append-only · admin tickets, disputes, refunds.

## Defects found and fixed by these runs

| Found by | Defect | Fix |
|---|---|---|
| End-to-end run | Edge Functions read `payment_transactions` directly, but migration 003 gives `service_role` no access, so payments could never be verified, reviewed or confirmed by the IPN | Migration 014 + function changes |
| End-to-end run | Product creation failed at COMMIT (deferred trigger ran as the client) | Migration 013 + regression test |
| End-to-end run | Webhook answered 409 to callbacks for final attempts (gateway retries forever); simulator recorded "cancelled" as failed | `payment-webhook` |
| End-to-end run | `create-support-ticket` capped descriptions at 2,000 characters (frontend and database allow 5,000) | Function schema |
| End-to-end run | The storefront had no merchant contact (FR-C-25); the "Most popular" sort had no data source for anonymous visitors | Migration 012 |
| Browser smoke | Supabase-mode web routing: wrong claim name in the middleware, and the session was invisible to it (localStorage) | `middleware.ts`, `lib/cookie-storage.ts` |
| Review | Android Google sign-in would run inside the WebView (Google blocks it), and nothing exchanged the PKCE code | `apps/mobile/src/services/services.ts`, `completeOAuthRedirect` |
| Clock crossing midnight in Dhaka | Policy effective dates followed the server timezone | Migration 015 |
| Mock e2e | A stale ticket-category value in the e2e script | Script |

## Still to run on Supabase's own images

On a machine with Docker, before staging:

```bash
npx supabase start
npx supabase db reset        # migrations 001–015 + seed
npx supabase test db         # 11 pgTAP files
npx supabase db lint --schema public,private
npx supabase functions serve --env-file supabase/functions/.env
```

Then point the apps at it (`NEXT_PUBLIC_DATA_SOURCE=supabase`) and repeat the browser checks. Realtime and the real storage-api are exercised only there.
