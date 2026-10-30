# Schema changes beyond SRS §18.1

DATABASE_SCHEMA.md and SRS §18.1 are the authority for table names. This file lists what the later migrations add, and how the brief's names map to the schema.

## Brief name → schema name

The backend brief uses a few names that differ from the authoritative schema. No duplicate tables were created; the brief's concept is implemented by the existing table:

| Brief | Schema (used) | Why |
|---|---|---|
| `return_requests` | `returns` | DATABASE_SCHEMA.md and SRS §18.1 name the table `returns` |
| `addresses` | `customer_addresses` | DATABASE_SCHEMA.md: "Up to three saved addresses; one default" |
| `store_themes` | `themes` | Platform themes managed by the Super Admin (FR-SA-14); a store references one through `stores.theme_id` |
| `payment_attempts` | `payment_transactions` | Option B (approved): each row *is* a payment attempt with its own lifecycle and idempotency key |
| `ticket_messages`, `ticket_audit_log`, `delivery_events`, `device_tokens`, `audit_logs`, … | same | Already in the schema |
| Storage bucket `store-assets` | `store-logos` | RLS_POLICY_MATRIX.md names `store-logos`; it holds logos and banners under `stores/{id}/logos|banners/` |
| Storage bucket `profile-images` | `profile-images` | Added in migration 009 |
| Storage bucket `support-attachments` | `support-attachments` | Ticket attachments (FR-SUP-05) |

## Added columns (migration 005 unless stated)

| Table | Column(s) | For |
|---|---|---|
| `profiles` | `suspension_reason`, `deleted_at` | FR-SA-11/13, FR-C-36 |
| `stores` | `category`, `banner_url`, `shipping_settings` (jsonb), `notification_preferences` (jsonb), `published_at` | Onboarding, FR-C-08 delivery charge, store settings |
| `themes` | `accent`, `breaking_change_effective_at`, `created_by` | Theme admin, FR-SA-15 7-day notice |
| `products` | `sku` (unique per store), `compare_at_price` (display-only original price, > base price), `deleted_at` (soft delete) | Product form, FR-M-19 duplicate |
| `orders` | `order_number` (`ORD-YYYYMMDD-BHQnnnnnn`), `subtotal`, `delivery_charge`, `currency` (BDT), `idempotency_key`, `request_fingerprint`, `stock_released_at`, `delivered_at` | API-07 idempotency, release-once guard, return window |
| `delivery_events` | `previous_status`, `note`, `idempotency_key` | Audit of every transition |
| `inventory_movements` | `idempotency_key` | Retry-safe adjustments |
| `payment_configs` | `credential_hint`, `environment`, `validation_status` | Masked credentials (DB-05) |
| `returns` | `return_number`, `return_method`, `refund_amount_requested`, `decided_at`, `closed_at`, `restocked_at`, `dispute_status`, `dispute_decision`, `dispute_admin_note`, `escalated_at` | §14 workflow, FR-RET-09 / FR-SA-21 |
| `support_tickets` | `ticket_number`, `queue` (`store`/`platform`), `dispute_*` | FR-SUP-03 routing, disputes |
| `notifications` | `push_dispatched_at` | Push delivery claiming |
| `announcements` | `recipient_count`, `created_by` | FR-SA-16 |
| `policies` | `published_at` | Policy publication |

## Added tables

| Table | Migration | For |
|---|---|---|
| `public.storefront_visits` | 011 | FR-M-36/37 unique-session visitors and popular pages; salted hash only, no personal data; written only by `record_storefront_visit` |
| `private.reference_counters` | 005 | Daily-sequence order, return and ticket numbers |
| `private.rate_limits` | 005 | Fixed-window rate limits for Edge Functions |
| `private.auth_login_attempts` | 005 | 5-failure / 15-minute lock (AUTH-07) |
| `private.admin_ip_allowlist` | 005 | Super Admin network allowlist (fail-closed when empty) |
| `private.app_settings` | 005 | Which header carries the client IP behind your proxy |

The `private` schema is not exposed through the Data API.

## Status values

Unchanged from the SRS: orders `pending, confirmed, processing, shipped, out_for_delivery, delivered, cancelled`; payments `pending, pending_verification, paid, failed, cod_pending, cod_collected, refunded`; refunds `initiated, processing, completed, failed`; payment methods `bkash, nagad, rocket, sslcommerz, cod`; roles `customer, merchant, super_admin`.

Workflow vocabularies the SRS leaves open were aligned with the frontend: returns `requested, approved, rejected, received, closed`; return methods `customer_drop_off, merchant_coordinated`; tickets `open, in_progress, waiting_for_customer, resolved, closed`; ticket categories `order, payment, delivery, return_refund, account, other`.

All non-SRS columns and tables still need Project Owner sign-off; see `docs/reports/SCHEMA_GAPS.md`.
