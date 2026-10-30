# BazarHQ API reference

BazarHQ has no separate REST server. The API is Supabase:

| Surface | What it is | Used for |
|---|---|---|
| **Edge Functions** | `POST https://<project>.supabase.co/functions/v1/<name>` (Deno, TypeScript) | Everything that moves money, stock, order/payment/refund state, or needs a secret or the Super Admin gate. See [EDGE_FUNCTIONS.md](EDGE_FUNCTIONS.md). |
| **Database RPCs** | `POST /rest/v1/rpc/<function>` (PostgREST) | Caller-scoped operations that run as `auth.uid()`: catalogue, store setup, tickets, notifications, reads that need aggregation. See [DATABASE_RPC.md](DATABASE_RPC.md). |
| **Data API reads** | `GET /rest/v1/<table>` (PostgREST) | Plain reads, limited by Row-Level Security. See [DATABASE_RPC.md § Direct reads](DATABASE_RPC.md#direct-reads-under-rls). |
| **Auth** | `/auth/v1/*` (Supabase Auth / GoTrue) | Sign-up, sign-in, Google OAuth, password reset, sessions, TOTP. See [DATABASE_RPC.md § Authentication](DATABASE_RPC.md#authentication). |
| **Storage** | `/storage/v1/*` | Images and evidence, limited by `storage.objects` RLS. See [DATABASE_RPC.md § Storage](DATABASE_RPC.md#storage). |
| **Realtime** | `wss://…/realtime/v1` | Live order, ticket and notification updates (RLS-filtered). See [DATABASE_RPC.md § Realtime](DATABASE_RPC.md#realtime). |

The web and Android apps never call these by hand. They use the typed service layer in `packages/shared/src/services/supabase/` (`createSupabaseServices`), which implements the same `PlatformServices` contract as the mock. `SUPABASE_OPERATION_MAP` in that folder lists which backend operation each frontend method uses.

## Conventions

**Transport.** HTTPS only in deployed environments (Supabase serves TLS; the web app sets HSTS). Request and response bodies are JSON (`content-type: application/json`), except the SSLCommerz IPN, which arrives as a form post.

**Authentication.** Send the user's access token as `Authorization: Bearer <jwt>` and the project's public key as `apikey`. Signed-out callers send only the public key. Edge Functions verify the token with Supabase Auth (`auth.getUser`), then read the role and status from `public.profiles`. They never use the JWT's metadata or the request body. Super Admin calls also need an `aal2` (TOTP-verified) session and a client IP on the allowlist.

**Keys.** Clients only ever hold the public anon/publishable key. The service-role key exists only in Edge Function secrets. `assertPublicAnonKey` refuses to start a client build that was given a service-role key.

**Errors.** Every function and the service layer use one shape:

```json
{ "error": { "code": "CONFLICT", "message": "Only 2 of Red Apple left. Reduce the quantity to continue.", "fieldErrors": { "phone": "…" }, "reason": "BQ001" } }
```

| `code` | HTTP | From |
|---|---|---|
| `VALIDATION` | 400 / 413 / 415 / 422 | Zod input validation; SQLSTATE `22023`, `22P02`, `23502`, `23503` |
| `UNAUTHENTICATED` | 401 | Missing, expired or revoked session |
| `FORBIDDEN` | 403 | Wrong role, suspended actor, Super Admin gate; SQLSTATE `42501` |
| `NOT_FOUND` | 404 | Unknown resource, or a resource that belongs to someone else (same answer, no enumeration); `P0002`, `BQ003` |
| `CONFLICT` | 409 | Invalid state transition, duplicate, stock or price changed; `23505`, `23514`, `55000`, `40001`, `BQ001`, `BQ002`, `BQ005` |
| `RATE_LIMITED` | 429 | Function rate limits; `BQ004` |
| `UNKNOWN` | 500 / 503 | Unexpected failure. The response never includes SQL, stack traces or secrets |

Messages are written for end users. Database messages that look like system errors (constraint names, `permission denied`, SQL fragments) are replaced by a generic message.

**Idempotency.** Every write that could be retried after a network failure takes an `idempotencyKey` (8–200 characters, unique per user action). Replaying the same key returns the original result. Replaying it with different input is a `409`. Order-status, COD and refund-settlement calls are also naturally idempotent: repeating the current target state changes nothing.

**Rate limits.** Fixed-window buckets in `private.rate_limits` (via `consume_rate_limit`), per caller or IP:

| Function | Limit |
|---|---|
| `create-order` | 20 orders / 10 min per user or IP |
| `create-payment-attempt` | 10 / 10 min per order |
| `verify-payment` (provider re-check) | 6 / 10 min per order |
| `track-order` | 10 / min per IP and 20 / hour per order number |
| `create-support-ticket` | 10 / hour per customer |
| `payment-credentials` | 10 / hour per merchant |
| `device-tokens` | 30 / hour per user |
| `admin-network-check` | 30 / min per IP |
| Auth | Supabase Auth rate limits (`supabase/config.toml` → `[auth.rate_limit]`) plus a 5-failure / 15-minute account lock (`hook_password_verification_attempt`) |

**Audit.** Privileged and money-moving actions write append-only `audit_logs` rows with the actor, action, resource, sanitised metadata and, for Super Admin actions, the client IP. Order changes also write `delivery_events`, stock changes write `inventory_movements`, and ticket changes write `ticket_audit_log`. None of these tables can be updated or deleted, by any role.

**Time and money.** Timestamps are ISO 8601 UTC. Money is BDT with two decimals (`numeric(12,2)` in the database, numbers in JSON).

## Files

- [EDGE_FUNCTIONS.md](EDGE_FUNCTIONS.md): all 23 Edge Functions: method, auth, role, request, response, errors, idempotency, rate limit and audit.
- [DATABASE_RPC.md](DATABASE_RPC.md): RPCs callable by clients, direct reads per role, Auth, Storage and Realtime.
- API coverage by area (authentication, stores, products, inventory, orders, payments, returns, refunds, support, notifications, analytics, Super Admin) is in the table at the top of EDGE_FUNCTIONS.md.
