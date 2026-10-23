# BazarHQ Database Schema Dictionary — Stage 1

Source: BazarHQ SRS Version 2.1 Final, §18.1 and §18.2. Supabase-managed `auth.users` is external to the application schema. The SRS defines 24 application tables. All 24 application tables are represented in the migration set; `payment_transactions` is added by migration `20261021000300_payment_transactions_option_b.sql` following the Project Owner-approved Option B decision documented in `PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md`; forward-only safeguards are added in migration `20261021000400_payment_attempt_safeguards.sql`.

| Table | Purpose / primary relationships | Mutable? |
|---|---|---|
| `profiles` | Canonical profile; PK/FK `auth.users.id`; role/status controlled server-side | Yes; user may edit own non-role fields |
| `stores` | One store per owner; unique subdomain; theme and return window | Yes |
| `themes` | Super Admin-managed selectable themes | Yes |
| `categories` | Store-scoped categories with same-store parent | Yes |
| `products` | Product data and simple-product stock; variant products store NULL stock | Yes; stock changes via trusted operation |
| `product_variants` | Variant stock and price adjustment | Yes; stock changes via trusted operation |
| `product_images` | Image metadata and private Storage object path | Metadata mutable; binary in Storage |
| `orders` | Store order, nullable customer for guest checkout, address snapshot and canonical states | State changes trusted-server only |
| `order_items` | Immutable product/variant/price snapshots | Append-only after order creation |
| `payment_configs` | Store payment method flags and encrypted credentials ciphertext | Trusted server only for sensitive credential handling |
| `payment_transactions` | Payment attempt; `order_id -> orders.id`; optional `payment_config_id -> payment_configs.id`; order-scoped idempotency; provider-reference deduplication where supported | Financial facts immutable; trusted status lifecycle only; no client DML; creation and status changes are audited |
| `delivery_events` | Append-only merchant-managed delivery/COD history | Append-only |
| `returns` | One return request per order; eligibility and workflow status | Workflow endpoint only |
| `refunds` | One refund record per return; confirmed settlement evidence | Workflow endpoint only |
| `support_tickets` | Ticket, assignment, status, response/escalation/closure timestamps | Workflow endpoint only |
| `ticket_messages` | Append-only support conversation | Append-only |
| `ticket_audit_log` | Append-only workflow audit | Append-only |
| `inventory_movements` | Immutable stock ledger; product/store and optional variant reference | Append-only |
| `notifications` | User-targeted notice and validated resource reference | Recipient may mark read only |
| `device_tokens` | FCM token by user/platform | Trusted server endpoint only |
| `audit_logs` | Immutable system/admin audit | Append-only |
| `announcements` | Draft/scheduled/sent platform announcements | Draft/scheduled mutable; sent immutable by workflow |
| `policies` | Versioned policy with dual approval | Workflow endpoint only |
| `customer_addresses` | Up to three saved addresses; one default | Customer-owned |

## Constraints and indexes

- UUID primary keys use `gen_random_uuid()` defaults where applicable.
- Money uses `numeric(12,2)`; currency is constrained to BDT in Version 2.1.
- Statuses and enumerated fields use `CHECK` constraints aligned with §18 and the state definitions in §§13–15.
- Store subdomains are unique and restricted to lowercase DNS-label syntax; application validation must additionally reject reserved names from FR-M-08.
- Unique constraints/indexes: `stores.owner_id`, `stores.subdomain`, `(store_id, method)` for payment configuration, `returns.order_id`, `refunds.return_id`, customer default-address partial index, `(order_id, idempotency_key)` for payment attempts, and provider/reference uniqueness where provider semantics support it.
- Composite foreign keys and triggers validate same-store/product/variant relationships.
- GIN expression indexes support product name/description and store-name full-text discovery.
- Append-only event/history tables omit `updated_at`.
- All writes to stock quantities and order/payment/refund state require trusted server-side operations. Do not expose the service-role key to a client.

## Explicit implementation notes

1. Product variant stock cardinality is enforced by deferred constraint triggers. Create a variant product and its first variant in one transaction.
2. `inventory_movements.actor_id` and `delivery_events.actor_id` are nullable for authorized system-generated events; ordinary Merchant workflows must record the actor profile. No system profile or Delivery Agent role is invented.
3. `payment_configs.credentials_encrypted` stores ciphertext only. The migration does not provision Vault secrets or encryption keys; those must be configured in the trusted deployment environment before payment credentials are stored.
4. Notification `reference_type/reference_id` is polymorphic. The database allowlists types; the trusted dispatcher must validate the target resource and caller authorization.
5. `payment_transactions` uses Option B: immutable identity/financial facts; trusted functions permit `pending -> pending_verification|paid|failed` and `pending_verification -> paid|failed`; `paid`/`failed` are terminal. Each creation, status transition, and provider-reference attachment is recorded as a distinct append-only `audit_logs` event, including when status and reference change in one call. New attempts require an enabled `payment_configs` row matching the order store and method. New attempts are rejected for settled (`paid`, `cod_collected`, `refunded`) orders, non-pending orders, orders already awaiting verification, and orders with an active attempt. Exact same-key/same-facts retries return the existing attempt before mutable configuration or settlement checks; changed facts fail closed. No direct table DML is granted to clients or `service_role`; only the approved SECURITY DEFINER functions are executable by `service_role`.
6. Status CHECK constraints prevent unknown values but do not implement legal transitions. The payment-attempt transition trigger/function enforces the approved payment-attempt lifecycle; other business state transitions remain server-side operations.

## Payment-attempt creation safeguards (migration 004)

- Migration `20261021000400_payment_attempt_safeguards.sql` is additive and does not rewrite migrations 001-003.
- A new attempt requires order status `pending`, an eligible payment status, method/provider consistency, exact order amount, and an enabled payment configuration belonging to the same store and method.
- Non-COD new attempts are allowed only while payment status is `pending` or `failed`; `pending_verification` does not trigger an implicit retry or timeout. COD is limited to one attempt per order.
- A previously created attempt can be retrieved idempotently with the same order, idempotency key, and request facts even if the order later settles or the configuration is disabled.
- Provider-reference attachment and status change are separately audited when both happen in one call. Gateway verification and synchronization of `orders.payment_status` remain trusted API responsibilities.
