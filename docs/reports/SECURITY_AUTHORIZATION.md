# Security and authorization report

How BazarHQ enforces who can do what, and how each requirement in the backend brief is met and verified. "pgTAP" means the SQL test suite (`supabase/tests`). "Stack" means the end-to-end run against real GoTrue, PostgREST and the Edge Functions (`scripts/local-stack/adapter-flows.mts`).

## Layers

1. **Client.** Route guards and form validation, for UX only. The web middleware routes by the `app_role` claim in the session cookie, but it never authorises: a forged cookie only gets a page shell whose data calls fail.
2. **Edge Functions.** Verify the JWT with Supabase Auth, load role and status from `profiles` (never from the token's metadata or the request), validate input with Zod, apply the Super Admin gate (aal2 + allowlisted IP), rate-limit, then call one trusted SQL function.
3. **Database.** RLS on every table, column-level grants, SECURITY DEFINER functions that re-check the actor's role, ownership and state, and constraints and triggers for every invariant. This is the final boundary: it holds even if a function or client is wrong.

## Roles

| Role | How it is assigned | How it is checked |
|---|---|---|
| `customer`, `merchant` | Server-side sign-up trigger. `account_type` metadata only picks one of the two public sign-up paths; any other value becomes `customer`. | `profiles.role` + `status = 'active'` in every helper |
| `super_admin` | Only `private.grant_super_admin(user, reason)`, run as `postgres` and audited. No default account exists. | Role + **aal2** session + client IP in `private.admin_ip_allowlist`, in `is_super_admin()` and again in the functions |
| Role changes | Clients can't update `role` or `status` (column grants + `guard_profile_privileged_fields`) | pgTAP; stack ("role change must fail") |

Suspended or deleted accounts get no new tokens (access-token hook), lose every session at once (migration 011 trigger), and are refused by every helper.

## Brief requirements

| Requirement | How | Verified |
|---|---|---|
| Service-role key never in browser, mobile, APK, repo or public env | Only Edge Function secrets hold it. `assertPublicAnonKey` refuses it at client start-up; ESLint blocks the literal; `.env.example` lists only the URL and anon key as client variables | Bundle scan of the web build and APK assets |
| No client role assignment | See Roles | pgTAP; stack |
| Merchant tenant isolation (products, inventory, orders, customers, tickets) | `owns_store()` in every merchant policy; trusted functions re-check ownership; another store's resource gets the same `404` as a missing one | pgTAP `rls_behavior`; stack ("merchant B sees none of merchant A's…", cross-store order, ticket, manual review) |
| Customer privacy | Customer policies are `customer_id = auth.uid()`; merchants see only their own store's orders; addresses are owner-only | pgTAP; stack ("one customer cannot read another's orders or addresses") |
| Anonymous users can't write protected tables | No anon write grants anywhere; anon can execute only the public storefront functions and caller-scoped helpers (pinned by a catalogue test) | pgTAP `rls_policy_catalog` |
| Public reads only published store/product data | `*_select_published` policies; draft, inactive and deleted items and unpublished stores are invisible; unknown, draft and suspended stores give the same error | pgTAP; stack; browser smoke |
| Payment can't be marked paid from the client | No client grant on `payment_transactions` or `orders.payment_status`. Wallet IDs only reach `pending_verification`; `paid` comes only from the provider, a signed and re-validated IPN, or an audited manual review | pgTAP; stack (direct updates refused; browser return doesn't mark paid; contradictory callback ignored) |
| Payment attempts idempotent, duplicates rejected, retry safe | Idempotency keys, one open attempt per order, unique provider references, monotonic states (Option B, migrations 003/004 + 007) | pgTAP `payment_transactions_safeguards`, `order_payment_inventory`; stack (retry after failure ends paid; replay changes nothing) |
| COD stays `cod_pending` until collection | `record_cod_collection` only when out for delivery or delivered, amount = total | pgTAP; stack |
| Inventory never negative; no client stock writes | `CHECK (stock >= 0)`, row locks, trusted functions only; no client grant on stock columns | pgTAP; stack (oversell refused, negative adjustment refused, direct write refused) |
| Stock restored only once | `stock_released_at` guard; release on cancellation (`cancellation_release` / `payment_failure_release`) and on return receipt, server-side only | pgTAP; stack ("releases stock exactly once") |
| Refunds server-side only | No client grant on `refunds`; completion needs a reference; every step audited | pgTAP; stack (direct update refused) |
| Super Admin can't change ordinary order status | The admin service has no status mutation; `transition_order_status` refuses admins; the only admin payment path is the audited manual review | pgTAP; stack ("admin cannot change order status directly") |
| Privileged admin actions audited with IP | Every admin function writes `audit_logs` (actor, action, resource, metadata, IP); the table is append-only for every role | pgTAP; stack ("audit log records … with IP", "append-only") |
| Storage cross-merchant access blocked | `storage.objects` policies tie each path to the owning store, order, return or ticket; MIME and size limits per bucket | pgTAP; stack (cross-tenant upload refused; anonymous signed URLs only for published products) |
| Mobile tokens in secure storage | Android Keystore (`capacitor-secure-storage-plugin`) is the supabase-js auth storage | Code review |
| No tokens or secrets in logs | Function logs pass through `redact()` (URLs' query strings, JWTs, bearer tokens, key=value secrets); no bodies or headers are logged | Deno unit tests |

## Defects found during verification (fixed)

The end-to-end run caught three defects that type checks and the rolled-back pgTAP suite couldn't see:

1. **Payments could never be verified (migration 014).** Migration 003 (locked) gives `service_role` no access to `payment_transactions`, but four function code paths read it directly. Wallet verification, manual review, the SSLCommerz IPN and payment snapshots all silently found nothing. Fixed with three narrow SECURITY DEFINER readers executable only by `service_role`, keeping 003's design.
2. **Merchants couldn't create products (migration 013).** The deferred stock-model triggers fire at COMMIT as the client and called a function clients may not execute. Fixed by running the two trigger functions as definer. A regression test fires the deferred checks as a client.
3. **Supabase-mode web routing.** The access-token hook writes `app_role`, but the middleware read other claim names, and the browser kept the session in localStorage, where the middleware can't see it. The middleware now reads `app_role`, and the web app stores the session in first-party `sb-*-auth-token` cookies (the `@supabase/ssr` format).

Also fixed: the SSLCommerz webhook now acknowledges callbacks for already-final attempts instead of answering 409 (which made the gateway retry forever); the simulator treats "cancelled" as nothing happened, like the mock; `create-support-ticket` now accepts the 5,000-character descriptions the frontend and database allow; and Android Google sign-in now uses the system browser with a PKCE code exchange on `bazarhq://auth/callback`.

## Decisions to confirm

- **Failed wallet payment and stock.** SRS §18.2 says stock "may be restored only once after a definitive payment failure or an eligible cancellation". The approved Option B decision says not to invent "payment timeout or stock-release rules". A failed attempt therefore leaves the order `pending` and retryable, and the stock is released (once) when the merchant cancels the order. If the Project Owner wants automatic release on a failed attempt, it is a small change in `apply_payment_result`.
- **Merchant contact on public pages.** `resolve_store` returns the merchant's phone and email (FR-C-25, as the frontend already shows). Merchants should be told this contact is public.
- **Session cookies on the web** are readable by JavaScript, as with `@supabase/ssr`. The CSP limits script sources; nonce-based CSP can follow once pages are server-rendered.

## Advisor findings (accepted)

`supabase db lint` (plpgsql_check) reports no errors in `public` or `private`. Supabase's security advisor (splinter) reports only expected items:

- `anon/authenticated_security_definer_function_executable`: the deliberate client RPCs, each re-checking the caller.
- `rls_enabled_no_policy` on `payment_configs` and `storefront_visits`: deny-all by design; functions only.
- `multiple_permissive_policies`: separate owner, admin and public policies; a performance note only.
- `unused_index`: a fresh database.

The full output is in `verification/db/splinter.txt`.
