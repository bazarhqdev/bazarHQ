# Edge Functions

All functions live in `supabase/functions/<name>/index.ts`. They share `_shared/` for request handling, CORS allowlist, Zod validation, caller identity, error mapping, rate limits and log redaction. Conventions (auth headers, error shape, idempotency, rate limits, audit) are in [README.md](README.md).

Every function:

1. Accepts only the listed method (`OPTIONS` for CORS preflight), with a body-size limit (64 KiB by default).
2. Validates input with Zod and returns field-level `VALIDATION` errors.
3. Identifies the caller from the verified JWT and `public.profiles` (never from the body), and rejects suspended or deleted accounts.
4. Calls one trusted SQL function. Those take the actor id from the function and re-check role, ownership and state themselves, inside a single transaction.
5. Returns `{ error: {...} }` on failure without SQL details or secrets, and logs only redacted messages.

## Coverage by area

| Area | Edge Functions | Plus (see DATABASE_RPC.md) |
|---|---|---|
| Authentication | `admin-network-check`, `device-tokens` | Supabase Auth, `list_my_sessions`, `revoke_my_session`, `become_merchant`, `delete_my_account` |
| Store management | `payment-credentials`, `admin-suspend-store` | `check_subdomain`, `create_store`, `publish_store`, `unpublish_store`, `get_onboarding_progress`, `set_payment_method_enabled`, `get_payment_configs` |
| Product management | — | `create_product`, `update_product`, `set_product_status`, `delete_product`, `duplicate_product` |
| Inventory | `adjust-inventory` | RLS read of `inventory_movements` |
| Orders | `create-order`, `update-order-status`, `track-order` | RLS reads, `validate_cart` |
| Payments | `create-payment-attempt`, `verify-payment`, `payment-webhook`, `record-cod-collection` | — |
| Returns | `request-return`, `manage-return`, `admin-resolve-dispute` | `attach_return_evidence` (through `request-return`) |
| Refunds | `process-refund`, `admin-refund-intervention` | `refund_timeline` |
| Support | `create-support-ticket`, `escalate-support-ticket` | `reply_to_ticket`, `update_ticket_status`, `set_ticket_priority`, `reopen_ticket`, `get_ticket_thread`, `admin_assign_ticket`, `admin_resolve_ticket_dispute` |
| Notifications | `send-notification`, `device-tokens` | `mark_all_notifications_read`, RLS read/update of `notifications`, Realtime |
| Analytics | — | `merchant_dashboard`, `merchant_customers`, `admin_dashboard` |
| Super Admin | `admin-suspend-store`, `admin-delete-merchant`, `admin-governance`, `admin-refund-intervention`, `admin-resolve-dispute`, `admin-health`, `admin-network-check` | `admin_list_merchants`, `admin_list_customers`, `admin_announcement_recipient_count`, `admin_user_session_count` |

`verify_jwt` is off in `supabase/config.toml` only for functions that guests, gateways or the scheduler call: `create-order`, `create-payment-attempt`, `track-order`, `payment-webhook`, `admin-network-check` and `send-notification`. Those functions authenticate the caller themselves.

---

## Checkout and payments

### `create-order` — API-07
- **POST**. **Auth:** optional. A signed-in caller must be a `customer`; no token means guest checkout. Merchants and admins get `403`.
- **Request:**
  ```json
  { "storeId": "uuid",
    "items": [{ "productId": "uuid", "variantId": "uuid|null", "quantity": 1, "expectedUnitPrice": 120 }],
    "delivery": { "recipientName": "…", "phone": "01XXXXXXXXX", "email": "…|null", "address": "…", "district": "Dhaka", "postalCode": "1213|null" },
    "paymentMethod": "cod|bkash|nagad|rocket|sslcommerz", "saveAddress": false, "idempotencyKey": "…" }
  ```
- **Response 200:** `{ replayed, order, items, payment, next_action: "none"|"submit_wallet_reference"|"redirect_sslcommerz" }`. `payment` shows only the masked reference.
- **Atomic (one transaction in `create_order`):** customer, store (published, owner active), product visibility, variant ownership, enabled payment method, price (`expectedUnitPrice` must match → else `409 BQ002`), stock rows locked in a fixed order and decremented (never below zero → `409 BQ001`), order + items + initial `pending` delivery event + first payment attempt + `sale` inventory movements, optional saved address, merchant notification. Any failure rolls everything back.
- **Idempotency:** same key + same cart returns the original order (`replayed: true`); same key + different cart → `409`.
- **Rate limit:** 20 / 10 min per user or IP. **Audit:** `payment_transaction.created`.

### `create-payment-attempt` — API-20/24/25
- **POST**. **Auth:** the order's customer, or a guest who supplies the order `phone`.
- **Request (wallet):** `{ "kind": "wallet_reference", "orderId", "reference": "TRX…", "phone"?, "idempotencyKey" }`. The customer's transaction ID is **untrusted**. The payment becomes `pending_verification`, and the server then asks the provider. Only a provider answer (or a merchant's audited manual review) can mark it `paid`. Nagad and Rocket have no lookup API, so they always go to manual review.
- **Request (card):** `{ "kind": "sslcommerz", "orderId", "phone"?, "idempotencyKey" }` returns `{ redirectUrl, sessionToken }`. Only the signed, re-validated IPN (`payment-webhook`) can mark the payment paid.
- **Response (wallet):** `{ orderId, paymentStatus, payment }` (masked reference).
- **Errors:** `409` if the order is no longer `pending`, a reference is already awaiting verification, the reference was used for another order, or the method doesn't match. **Rate limit:** 10 / 10 min per order. **Audit:** every attempt, reference attachment and status change.

### `verify-payment` — API-43
- **POST**. **Auth:** signed in.
- `{ "mode": "provider", "orderId" }`: re-asks the wallet provider (customer, owning merchant or Super Admin). Rate limit 6 / 10 min per order.
- `{ "mode": "manual_review", "orderId", "decision": "paid"|"failed", "reason": "5–500 chars", "idempotencyKey" }`: the owning merchant, or a Super Admin (TOTP + allowlisted IP), records an audited decision for a payment in `pending_verification`. Another store's order gives `404`. Replaying the same decision returns the current state.
- **Response:** `{ orderId, paymentStatus, payment }`. **Audit:** `payment_transaction.status_changed` with `source: manual_review`, reason and reviewer IP.

### `payment-webhook` — API-26
- **POST/GET**, no user JWT (`verify_jwt = false`). **CORS:** none.
- `?kind=ipn`: the SSLCommerz server-to-server IPN (form post). It verifies `verify_sign` with the store's password from Vault, then re-validates with SSLCommerz' validation API (transaction id, amount and currency must match), then applies `paid`/`failed` through `apply_payment_result`. Attempts that are already final are acknowledged with `200 { status: "ignored" }`, so replays and late contradictory callbacks change nothing and the gateway stops retrying.
- `?kind=return`: the customer's browser coming back. It **never changes payment state**; it only answers with a `303` redirect to the order page.
- `?kind=simulator`: development only (`PAYMENT_PROVIDER_MODE=simulator`, refused when `APP_ENV=production`). Completes an HMAC-signed simulator session.

### `record-cod-collection` — DM-05
- **POST**. **Role:** merchant (own store). **Request:** `{ orderId, amount, note?, idempotencyKey }`.
- Allowed only while the order is `out_for_delivery` or `delivered`, and `amount` must equal the order total. Moves `cod_pending → cod_collected` and writes a `cod_collected` delivery event with the amount. A repeat call is a no-op. **Audit:** yes.

## Orders and inventory

### `update-order-status` — API-09 / API-10
- **POST**. **Role:** merchant (own store). Super Admins are refused by design (§13.1). **Request:** `{ orderId, toStatus, note?, reason?, proofPath?, idempotencyKey }`.
- Transitions: `pending → confirmed → processing → shipped → out_for_delivery → delivered`. `cancelled` is allowed from `pending`, `confirmed`, `processing` and `shipped` only, and needs a `reason`. `pending → confirmed` also needs the payment to be `paid` or `cod_pending`.
- One transaction locks the order, writes the delivery event (actor, previous/new status, note or reason, time), releases stock **once** on cancellation (`cancellation_release`, or `payment_failure_release` when the payment had failed), notifies the customer and audits.
- **Response:** the order result. Repeating the current status is a no-op. **Errors:** `409` for an invalid transition, `422` for a missing reason.

### `adjust-inventory` — FR-M-22
- **POST**. **Role:** merchant (own product). **Request:** `{ productId, variantId|null, delta (±1…100000, not 0), note, idempotencyKey }`.
- Locks the stock row; the result can never be negative (`409`). Writes one `manual_adjustment` movement. **Response:** `{ stock_quantity, replayed, … }`. Replaying the key returns the original movement.

### `track-order` — API-21
- **POST**, no sign-in. **Request:** `{ orderNumber: "ORD-YYYYMMDD-…", phone }`.
- Any mismatch returns the same `404` ("We couldn't find an order with that Order ID and phone number."), so order numbers can't be enumerated. Orders delivered more than 90 days ago return `{ archived: true }` only. Merchant contact is phone and email only (FR-C-25).
- **Rate limit:** 10 / min per IP, 20 / hour per order number.

## Returns and refunds

### `request-return` — API-15 (customer)
- `{ action: "create", orderId, reason: wrong_item|damaged|not_as_described|change_of_mind|other, conditionDescription (10–1000), refundAmountRequested?, idempotencyKey }`: one return per delivered order, inside the store's return window (default 7 days from delivery). Returns `{ return, refund }`.
- `{ action: "attach_evidence", returnId, storagePath: "returns/{returnId}/{file}" }`: links a photo the customer uploaded. Storage RLS only lets the return's customer write there.
- `{ action: "escalate", returnId, note }`: asks BazarHQ to review a **rejected** return, once.

### `manage-return` — API-16 (merchant)
- `decide` (`approved`/`rejected`; rejection needs a reason), `set_method` (`customer_drop_off`/`merchant_coordinated`), `confirm_receipt` (`restock: true` restores stock once, as a `return` movement; inspection note required; idempotent), `close`. Own store only; audited; the customer is notified.

### `process-refund` — API-17 / API-42 (merchant)
- `create`: `{ returnId, amount (≤ order total), method: original_method|bkash|nagad|rocket|bank_transfer, idempotencyKey }`. One refund per received return. COD orders cannot use `original_method`.
- `mark_processing` / `mark_failed` (note required).
- `settle`: `{ refundId, reference, referenceKind, note, idempotencyKey }`. **Completion needs the provider or settlement reference.** It marks the order's payment `refunded` and closes the return.
- Clients can't change refunds directly: there is no table write grant. Every step is audited and appears in `refund_timeline`.

### `admin-refund-intervention` — FR-REF-07 (Super Admin)
- `{ refundId, action: mark_processing|mark_failed|settle, reference? (required to settle), note }`. TOTP + allowlisted IP; audited as `refund.admin_intervention` with the IP.

### `admin-resolve-dispute` — FR-SA-21 (Super Admin)
- `{ returnId, action: request_info|override|close, note }`. `override` approves a return the merchant rejected; `close` upholds the rejection. Audited. Ticket disputes use the `admin_resolve_ticket_dispute` RPC.

## Support

### `create-support-ticket` — API-18 (customer)
- `{ category: order|payment|delivery|return_refund|account|other, subject (5–150), description (10–5000), priority: normal|urgent, orderId? }`.
- Store, order, payment, delivery and return tickets go to the order's store (active merchant). Account and other tickets, and tickets for an inactive or suspended merchant, go to the platform queue. This starts the 72-hour response timer and writes the first message and audit entry. **Rate limit:** 10 / hour.

### `escalate-support-ticket` — FR-SUP-10 (customer)
- `{ ticketId }`: moves the ticket to the Super Admin queue once 72 hours have passed since **creation** without a public merchant reply. Reassignment never resets the timer. Earlier attempts get `409`.

## Notifications

### `device-tokens` — MOB-08
- `{ action: "register", token, platform: "android" }` returns `{ id, platform, token_hint, … }` (masked). `{ action: "unregister", token }` returns `{ removed: true }`. Any signed-in role. The raw token is never returned or readable by clients.

### `send-notification` — scheduler only
- `POST` with header `x-cron-secret` (≥ 32 characters; constant-time compare). It sends due scheduled announcements, then claims undelivered notifications (`FOR UPDATE SKIP LOCKED`) and pushes them through FCM HTTP v1 using a service-account token. Invalid tokens are deleted. Without FCM credentials, in-app notifications and Realtime still work.

## Super Admin

All of these need: `super_admin` role + `aal2` session + client IP inside `private.admin_ip_allowlist`, checked in the function (`requireSuperAdmin`) **and again in SQL** (`is_super_admin()`). Each one writes `audit_logs` with the admin's id and IP.

| Function | Request | Notes |
|---|---|---|
| `admin-network-check` | none | `{ allowed, ip }` for the caller's own IP only; the login screen uses it. |
| `admin-suspend-store` | `{ merchantId, action: suspend\|reinstate, reason? }` | Suspend needs a 5–500 character reason. It unpublishes the store (orders stay trackable), ends every session, and makes the token hook refuse new tokens. Reinstating leaves the store unpublished until the merchant republishes it. |
| `admin-delete-merchant` | `{ merchantId, confirmation: "DELETE <email>" }` | Personal data is anonymised; orders, payments and audit history are kept (§20.6). |
| `admin-governance` | `op: theme.save\|theme.delete\|announcement.save\|announcement.unschedule\|announcement.delete\|policy.submit\|policy.approve\|policy.publish` | A theme in use can't be deleted. A breaking theme change starts a 7-day notice. Sent announcements are immutable. Policies need a second admin to approve (the submitter can't). |
| `admin-health` | none | Database, Auth, Storage, Functions and push probes with latency; no secrets. |
| `admin-refund-intervention`, `admin-resolve-dispute` | see above | |
| `verify-payment` (`manual_review`) | see above | The only admin path that touches payment state. There is **no** admin path to change an ordinary order or delivery status. |

## Local verification

`scripts/local-stack/` runs all of these functions on Deno behind real GoTrue and PostgREST. `adapter-flows.mts` exercises them through the frontend service layer (42 steps). See `docs/reports/MIGRATION_VALIDATION.md`.
