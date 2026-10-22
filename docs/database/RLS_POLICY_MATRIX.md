# BazarHQ RLS and Storage Policy Matrix — Stage 1

RLS is enabled on all 24 application tables. The Project Owner approved Option B for `payment_transactions`: financial facts remain immutable and status changes occur only through trusted server-side functions. No policy is equivalent to deny for a role/operation. Policies do not replace trusted server-side authorization.

| Table | Public/Guest | Customer | Merchant | Super Admin | Sensitive writes |
|---|---|---|---|---|---|
| `profiles` | Denied | Own profile; role/status cannot be changed by granted columns | Own profile; role/status cannot be changed by granted columns | Authorized read | Signup trigger/server role operation |
| `stores` | Published only | Published + own if role context permits | Own store | Read-only | Create own draft; editable store fields only |
| `themes` | Active only | Active only | Active only | All read | Admin server operation |
| `categories` | Published store only | Published store only | Own store CRUD | Read-only | Merchant own store |
| `products` | Published store/product only | Published only | Own store read | Read-only | Trusted product/inventory endpoint; no direct table writes |
| `product_variants` | Published product variants | Published product variants | Own store read | Read-only | Trusted product/inventory endpoint |
| `product_images` | Published product image metadata | Published metadata | Own store metadata | Read-only | Own metadata; Storage path authorization required |
| `orders` | No direct table access | Own authenticated orders | Own store orders | Read-only | Trusted order endpoint only |
| `order_items` | Denied | Own order items | Own store order items | Read-only | Trusted order transaction only |
| `payment_configs` | Denied | Denied | No direct raw table access; use safe server projection | Safe metadata via server only | Trusted credential/config operation |
| `payment_transactions` | No direct access | Safe summary for own order | Safe summary for own store | Safe metadata/read-only | `service_role` may execute trusted creation/state functions only; no direct table DML; audit appends via function |
| `delivery_events` | Denied | Own order timeline | Own store history | Read-only | Trusted merchant delivery/COD operation |
| `returns` | Denied | Own returns | Own store return review | Read-only/authorized oversight | Return workflow endpoint |
| `refunds` | Denied | Own safe status | Own store safe status | Authorized oversight | Refund workflow endpoint |
| `support_tickets` | Denied | Own tickets | Assigned tickets for own store | All authorized tickets | Ticket workflow endpoint |
| `ticket_messages` | Denied | Own ticket messages | Assigned ticket participants | Authorized ticket access | Append through ticket API |
| `ticket_audit_log` | Denied | Own ticket history where allowed | Assigned ticket history | Audit read | Trusted server insert only |
| `inventory_movements` | Denied | Denied | Own store read | Read-only | Trusted inventory operation; append-only |
| `notifications` | Denied | Own notifications; mark read | Own notifications; mark read | Authorized administration | Dispatcher inserts; recipient changes `is_read` only |
| `device_tokens` | Denied | Own read | Own read | Authorized read | Trusted FCM registration/revocation |
| `audit_logs` | Denied | Denied | Denied | Read-only | Trusted server append only |
| `announcements` | Sent announcements for public audience | Sent audience-matched | Sent audience-matched | All read | Trusted admin workflow; sent records immutable |
| `policies` | Published versions | Published versions | Published versions | All workflow records | Trusted dual-approval/publish workflow |
| `customer_addresses` | Denied | Own, max 3, one default | Denied | No general access | Own address CRUD, DB limit trigger |

## Payment transaction lifecycle (Option B)

- `authenticated` may SELECT only the safe column projection and only rows visible through the authorized order relationship. `anon` has no direct table access.
- `anon`, `authenticated`, and `service_role` have no direct INSERT/UPDATE/DELETE privileges on the table. `service_role` can execute only `create_payment_attempt(...)` and `record_payment_transaction_state(...)`.
- `create_payment_attempt` validates order state/payment status, method/provider/amount, a required enabled payment configuration belonging to the same store and method, customer actor where present, and order-scoped idempotency. Reuse of a key with different facts fails.
- `record_payment_transaction_state` validates allowed transitions, one-time provider-reference assignment, manual-review actor ownership/role, and reason. The trusted API must separately enforce Super Admin VPN/IP + TOTP and provider/webhook authenticity.
- Financial facts are immutable. Status changes, creation, and provider-reference attachment write sanitized audit events. The functions do not automatically set `orders.payment_status`; trusted API orchestration must coordinate both states atomically.

## Storage buckets

All buckets are private. Direct public object URLs are not enabled.

| Bucket | Required path contract | SELECT | INSERT | UPDATE/DELETE |
|---|---|---|---|---|
| `product-images` | `stores/{store_uuid}/products/{product_uuid}/{file}` | Published product objects; owner/admin read | Own store/product | Own store; object removal only through authorized operation |
| `store-logos` | `stores/{store_uuid}/logos/{file}` | Published stores | Own store | Own store |
| `delivery-evidence` | `orders/{order_uuid}/delivery/{file}` | Order customer, owning Merchant, authorized admin | Owning Merchant | No direct update/delete policy |
| `return-evidence` | `returns/{return_uuid}/{file}` | Return customer, owning Merchant, authorized admin | Return owner | No direct update/delete policy |
| `support-attachments` | `tickets/{ticket_uuid}/{file}` | Ticket participants | Ticket participants | No direct update/delete policy |

The server-side upload authorizer must validate object path, resource ownership, MIME type, byte size, and ticket/order/return/store authorization. The client must not choose an arbitrary tenant path.

## Known enforcement boundary

The Super Admin allowlisted IP/VPN and TOTP requirements cannot be satisfied by RLS alone. Trusted server endpoints must enforce those controls before privileged operations. Stage 1 does not implement those application endpoints. Do not expose `service_role` to clients or use it as a substitute for explicit endpoint authorization.

## Payment attempt creation gate (migration 004)

`create_payment_attempt` and the insert trigger both require a non-null, enabled `payment_configs` row for the same store and method. A new attempt requires `orders.status = pending`; settled payment statuses (`paid`, `cod_collected`, `refunded`), `pending_verification`, and other non-eligible payment states are rejected. Non-COD retries with a new key are permitted only when the order payment status is `pending` or `failed` and no active attempt exists. COD is limited to one attempt per order. Exact idempotent retries return the existing attempt before rechecking mutable configuration or current settlement state. Provider-reference attachment and status changes are audited as separate records. These rules do not implement provider verification, timeout, stock release, or `orders.payment_status` synchronization.
