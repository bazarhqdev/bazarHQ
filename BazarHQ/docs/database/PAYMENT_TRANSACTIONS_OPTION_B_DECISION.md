# Payment Transaction Lifecycle Decision — Approved Option B

**Status: RESOLVED — Project Owner approved Option B for BazarHQ SRS V2.1 Stage 1.**

## Approved interpretation

NFR-C-03 immutability applies to the payment attempt's identity and financial facts, and transaction history is retained for seven years. The following fields are immutable after creation: `id`, `order_id`, `payment_config_id`, `method`, `provider`, `amount`, `currency`, `idempotency_key`, `metadata_sanitized`, and `created_at`. A provider transaction reference may be assigned once and cannot subsequently be changed. A `verified_at` timestamp may be set once when the attempt reaches a terminal verified result.

Only trusted server-side functions may advance `status` through the allowed lifecycle (`pending` → `pending_verification` → `paid`/`failed`, with direct `pending` → `paid`/`failed` also permitted for an authoritative result). Terminal `paid` and `failed` states cannot be changed to another state. Repeated same-state requests are idempotent. Every creation, status transition, and provider-reference attachment is written to append-only `audit_logs` with sanitized metadata.

No anonymous or authenticated client can insert, update, or delete payment transaction rows directly. The `service_role` may execute the approved SECURITY DEFINER functions but is explicitly denied direct table DML. Super Admin VPN/IP and TOTP checks, actor authorization, provider signature verification, and the corresponding `orders.payment_status` update remain responsibilities of the trusted API/Edge Function and must be implemented and tested before production.

## Implementation

- Base migration: `supabase/migrations/20261021000300_payment_transactions_option_b.sql`
- Forward-only safeguards: `supabase/migrations/20261021000400_payment_attempt_safeguards.sql`
- Creation function: `public.create_payment_attempt(...)`
- State function: `public.record_payment_transaction_state(...)`
- Table RLS policy: `payment_transactions_read_authorized`
- Audit target: append-only `public.audit_logs`
- Tests: `database_schema.test.sql`, `database_integrity.test.sql`, `payment_transactions_safeguards.test.sql`, `rls_policy_catalog.test.sql`, and `rls_behavior.test.sql`

## Boundary / not claimed

The database functions do not implement the payment gateway integration or automatically synchronize `orders.payment_status`; the trusted API orchestration must coordinate the transaction status and canonical order payment status in one authorized business transaction without inventing payment timeout or stock-release rules. Migrations and SQL tests have not been executed in PostgreSQL in the current environment.

## Safeguard correction record

Migration 004 hardens creation without changing Option B: exact same-key/same-facts retries return the existing attempt; new attempts require a pending order, eligible payment state, and a matching enabled configuration; settled orders and orders awaiting verification cannot start a new attempt; active attempts prevent a second active key; COD remains limited to one attempt per order. A combined status/reference update writes two separate audit events. This migration is additive so the original migration history remains intact. Runtime results are pending until the local Supabase test suite is executed.
