-- =============================================================================
-- Migration 014 — payment reads for trusted Edge Functions.
--
-- Found by the end-to-end adapter run (scripts/local-stack): migration 003
-- (locked) revokes every privilege on public.payment_transactions from
-- service_role, by design: "the service role is allowed to execute those
-- functions but is not granted direct table DML", and internal fields
-- (idempotency_key, metadata_sanitized) stay unreadable. The Edge Functions
-- nevertheless read the table directly with the service client, and those
-- reads silently returned nothing. As a result:
--   * wallet verification never found the pending attempt (payments stayed
--     pending_verification),
--   * manual payment review answered "nothing awaiting verification",
--   * the SSLCommerz IPN could not find its transaction,
--   * payment snapshots returned no payment.
--
-- Fix, keeping migration 003's model (trusted functions, no table grant):
-- three narrow SECURITY DEFINER read functions, executable by service_role
-- only, returning exactly the fields each function needs. Clients cannot call
-- them (no anon/authenticated EXECUTE). idempotency_key and metadata_sanitized
-- are never returned.
--
-- Additive only. Rollback: drop the three functions (see end of file).
-- =============================================================================

-- Newest attempt of an order, in the frontend's camelCase shape, with the
-- provider reference masked (create-payment-attempt, verify-payment responses).
create or replace function public.payment_snapshot(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orderId', o.id,
    'paymentStatus', o.payment_status,
    'payment', (
      select jsonb_build_object(
        'id', t.id, 'orderId', t.order_id, 'method', t.method, 'provider', t.provider, 'status', t.status,
        'amount', t.amount, 'currency', t.currency,
        'providerReferenceMasked', case when t.provider_transaction_reference is null then null
                                        else '••••' || right(t.provider_transaction_reference, 4) end,
        'createdAt', t.created_at, 'verifiedAt', t.verified_at)
      from public.payment_transactions t
      where t.order_id = o.id
      order by t.created_at desc, t.id desc
      limit 1))
  from public.orders o
  where o.id = p_order_id;
$$;

-- Newest attempt awaiting verification, with the raw provider reference the
-- server needs to ask the wallet provider (verifyPendingWallet, manual review).
create or replace function public.pending_verification_attempt(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'order_id', t.order_id, 'amount', t.amount, 'status', t.status,
    'provider_transaction_reference', t.provider_transaction_reference)
  from public.payment_transactions t
  where t.order_id = p_order_id and t.status = 'pending_verification'
  order by t.created_at desc, t.id desc
  limit 1;
$$;

-- An SSLCommerz attempt with its order and store (payment-webhook IPN/return).
create or replace function public.sslcommerz_attempt_context(p_transaction_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'amount', t.amount, 'status', t.status,
    'order', jsonb_build_object(
      'id', o.id, 'order_number', o.order_number, 'order_phone', o.order_phone, 'payment_status', o.payment_status,
      'store', jsonb_build_object('id', s.id, 'subdomain', s.subdomain)))
  from public.payment_transactions t
  join public.orders o on o.id = t.order_id
  join public.stores s on s.id = o.store_id
  where t.id = p_transaction_id and t.method = 'sslcommerz';
$$;

revoke all on function public.payment_snapshot(uuid), public.pending_verification_attempt(uuid), public.sslcommerz_attempt_context(uuid)
  from public, anon, authenticated;
grant execute on function public.payment_snapshot(uuid), public.pending_verification_attempt(uuid), public.sslcommerz_attempt_context(uuid)
  to service_role;

comment on function public.payment_snapshot(uuid) is 'Trusted Edge Functions only: latest payment attempt of an order (masked reference).';
comment on function public.pending_verification_attempt(uuid) is 'Trusted Edge Functions only: newest pending_verification attempt for provider verification or manual review.';
comment on function public.sslcommerz_attempt_context(uuid) is 'Trusted Edge Functions only: SSLCommerz attempt with order and store for the IPN handler.';

-- -----------------------------------------------------------------------------
-- Down (manual):
--   drop function if exists public.payment_snapshot(uuid);
--   drop function if exists public.pending_verification_attempt(uuid);
--   drop function if exists public.sslcommerz_attempt_context(uuid);
-- -----------------------------------------------------------------------------
