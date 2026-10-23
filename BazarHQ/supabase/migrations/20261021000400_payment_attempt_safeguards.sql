-- BazarHQ Stage 1 corrective migration.
-- Additive: preserves migrations 001-003 and replaces function bodies / trigger logic only.
-- Option B remains approved: immutable payment facts, trusted monotonic status transitions.

create or replace function public.validate_payment_transaction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_config public.payment_configs%rowtype;
begin
  select * into v_order
  from public.orders
  where id = new.order_id
  for update;

  if not found then
    raise exception 'Payment transaction order does not exist' using errcode = '23503';
  end if;

  if v_order.status <> 'pending' then
    raise exception 'A new payment attempt requires an order in pending status' using errcode = '23514';
  end if;

  if v_order.payment_status in ('paid','cod_collected','refunded','pending_verification') then
    raise exception 'A new payment attempt is not allowed for the current order payment status' using errcode = '23514';
  end if;

  if new.method is distinct from v_order.payment_method
     or new.amount is distinct from v_order.total_amount then
    raise exception 'Payment method and amount must match the order' using errcode = '23514';
  end if;

  if new.method = 'cod' then
    if new.provider not in ('cod','manual') then
      raise exception 'COD method requires COD or manual provider' using errcode = '23514';
    end if;
    if v_order.payment_status not in ('pending','cod_pending') then
      raise exception 'COD payment attempt requires pending or cod_pending payment status' using errcode = '23514';
    end if;
  else
    if new.provider is distinct from new.method then
      raise exception 'Payment provider must match the selected payment method' using errcode = '23514';
    end if;
    if v_order.payment_status not in ('pending','failed') then
      raise exception 'A new payment attempt requires pending or failed payment status' using errcode = '23514';
    end if;
  end if;

  if new.payment_config_id is null then
    raise exception 'A new payment attempt requires an enabled payment configuration' using errcode = '23514';
  end if;

  select * into v_config
  from public.payment_configs
  where id = new.payment_config_id
  for share;

  if not found
     or v_config.store_id is distinct from v_order.store_id
     or v_config.method is distinct from new.method then
    raise exception 'Payment configuration must belong to the order store and selected method' using errcode = '23514';
  end if;
  if not v_config.is_enabled then
    raise exception 'Payment configuration is disabled' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.payment_transactions pt
    where pt.order_id = new.order_id
      and pt.status in ('pending','pending_verification')
  ) then
    raise exception 'An active payment attempt already exists for this order' using errcode = '23514';
  end if;

  if new.method = 'cod' and exists (
    select 1 from public.payment_transactions pt where pt.order_id = new.order_id
  ) then
    raise exception 'A COD payment attempt already exists for this order' using errcode = '23514';
  end if;

  if new.status <> 'pending' or new.verified_at is not null then
    raise exception 'Payment attempts must be created in pending status without verification timestamp' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- The creation function validates immutable request facts first, returns an existing
-- idempotent attempt before checking mutable order/configuration state, then applies
-- eligibility and enabled-configuration checks before creating any new attempt.
create or replace function public.create_payment_attempt(
  p_order_id uuid,
  p_payment_config_id uuid,
  p_method text,
  p_provider text,
  p_amount numeric,
  p_idempotency_key text,
  p_metadata_sanitized jsonb,
  p_actor_id uuid default null
)
returns public.payment_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_config public.payment_configs%rowtype;
  v_attempt public.payment_transactions%rowtype;
  v_inserted boolean := false;
begin
  if p_order_id is null
     or p_method is null or p_method not in ('bkash','nagad','rocket','sslcommerz','cod')
     or p_provider is null or p_provider not in ('bkash','nagad','rocket','sslcommerz','cod','manual')
     or p_amount is null or p_amount < 0 then
    raise exception 'Invalid payment attempt request facts' using errcode = '22023';
  end if;
  if p_metadata_sanitized is null or jsonb_typeof(p_metadata_sanitized) <> 'object' then
    raise exception 'Sanitized metadata must be a JSON object' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;
  if (p_method = 'cod' and p_provider not in ('cod','manual'))
     or (p_method <> 'cod' and p_provider is distinct from p_method) then
    raise exception 'Payment provider is inconsistent with the selected method' using errcode = '23514';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if p_method is distinct from v_order.payment_method
     or p_amount is distinct from v_order.total_amount then
    raise exception 'Payment method and amount must match the order' using errcode = '23514';
  end if;

  if p_actor_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active' and p.role = 'customer'
      and p.id = v_order.customer_id
  ) then
    raise exception 'Actor is not the active customer for this order' using errcode = '42501';
  end if;

  -- An exact retry remains idempotent even if the order later settles or the
  -- merchant disables the method. A reused key with changed request facts fails closed.
  select * into v_attempt from public.payment_transactions
  where order_id = p_order_id and idempotency_key = p_idempotency_key
  for update;
  if found then
    if v_attempt.payment_config_id is distinct from p_payment_config_id
       or v_attempt.method is distinct from p_method
       or v_attempt.provider is distinct from p_provider
       or v_attempt.amount is distinct from p_amount
       or v_attempt.currency is distinct from 'BDT'
       or v_attempt.metadata_sanitized is distinct from p_metadata_sanitized then
      raise exception 'Idempotency key was already used with different request facts' using errcode = '23505';
    end if;
    return v_attempt;
  end if;

  -- The enabled configuration is mandatory for every newly created attempt. The
  -- idempotent return above intentionally preserves exact retries of legacy rows,
  -- including historical rows created before this safeguard with a NULL config.
  if p_payment_config_id is null then
    raise exception 'A new payment attempt requires an enabled payment configuration' using errcode = '23514';
  end if;

  -- No attempt is created for settled orders, canceled/non-pending orders, or an
  -- order awaiting provider verification. No timeout/release policy is inferred here.
  if v_order.status <> 'pending' then
    raise exception 'A new payment attempt requires an order in pending status' using errcode = '23514';
  end if;
  if v_order.payment_status in ('paid','cod_collected','refunded','pending_verification') then
    raise exception 'A new payment attempt is not allowed for the current order payment status' using errcode = '23514';
  end if;

  if p_method = 'cod' then
    if v_order.payment_status not in ('pending','cod_pending') then
      raise exception 'COD payment attempt requires pending or cod_pending payment status' using errcode = '23514';
    end if;
    if exists (select 1 from public.payment_transactions pt where pt.order_id = p_order_id) then
      raise exception 'A COD payment attempt already exists for this order' using errcode = '23514';
    end if;
  elsif v_order.payment_status not in ('pending','failed') then
    raise exception 'A new payment attempt requires pending or failed payment status' using errcode = '23514';
  end if;

  select * into v_config from public.payment_configs where id = p_payment_config_id for share;
  if not found
     or v_config.store_id is distinct from v_order.store_id
     or v_config.method is distinct from p_method then
    raise exception 'Payment configuration must belong to the order store and selected method' using errcode = '23514';
  end if;
  if not v_config.is_enabled then
    raise exception 'Payment configuration is disabled' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.payment_transactions pt
    where pt.order_id = p_order_id and pt.status in ('pending','pending_verification')
  ) then
    raise exception 'An active payment attempt already exists for this order' using errcode = '23514';
  end if;

  insert into public.payment_transactions (
    order_id, payment_config_id, method, provider, amount, currency,
    status, idempotency_key, metadata_sanitized
  ) values (
    p_order_id, p_payment_config_id, p_method, p_provider, p_amount, 'BDT',
    'pending', p_idempotency_key, p_metadata_sanitized
  )
  on conflict (order_id, idempotency_key) do nothing
  returning * into v_attempt;
  v_inserted := found;

  if not v_inserted then
    select * into v_attempt from public.payment_transactions
    where order_id = p_order_id and idempotency_key = p_idempotency_key
    for update;
    if not found then
      raise exception 'Idempotent payment attempt could not be resolved' using errcode = '40001';
    end if;
    if v_attempt.payment_config_id is distinct from p_payment_config_id
       or v_attempt.method is distinct from p_method
       or v_attempt.provider is distinct from p_provider
       or v_attempt.amount is distinct from p_amount
       or v_attempt.currency is distinct from 'BDT'
       or v_attempt.metadata_sanitized is distinct from p_metadata_sanitized then
      raise exception 'Idempotency key was already used with different request facts' using errcode = '23505';
    end if;
    return v_attempt;
  end if;

  insert into public.audit_logs(actor_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id, 'payment_transaction.created', 'payment_transaction', v_attempt.id,
    jsonb_build_object('order_id', v_attempt.order_id, 'method', v_attempt.method,
      'provider', v_attempt.provider, 'amount', v_attempt.amount, 'currency', v_attempt.currency,
      'status', v_attempt.status, 'payment_config_id', v_attempt.payment_config_id)
  );
  return v_attempt;
end;
$$;

-- Record status and provider-reference changes as separate audit events when both
-- happen in one call. This preserves the approved Option B lifecycle and terminal states.
create or replace function public.record_payment_transaction_state(
  p_transaction_id uuid,
  p_new_status text,
  p_provider_transaction_reference text,
  p_source text,
  p_actor_id uuid default null,
  p_reason text default null
)
returns public.payment_transactions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
  v_old_status text;
  v_reference_changed boolean := false;
  v_status_changed boolean := false;
  v_verified_at timestamptz;
  v_audit_metadata jsonb;
begin
  if p_new_status is null or p_new_status not in ('pending','pending_verification','paid','failed') then
    raise exception 'Unsupported payment transaction status' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('provider_verification','sslcommerz_webhook','manual_review') then
    raise exception 'Unsupported payment transaction state source' using errcode = '22023';
  end if;
  if p_provider_transaction_reference is not null
     and length(trim(p_provider_transaction_reference)) not between 1 and 200 then
    raise exception 'Provider transaction reference must contain 1-200 non-whitespace characters' using errcode = '22023';
  end if;
  if p_source = 'manual_review' then
    if p_actor_id is null or nullif(trim(p_reason),'') is null then
      raise exception 'Manual review requires an actor and reason' using errcode = '22023';
    end if;
    if p_new_status not in ('paid','failed') then
      raise exception 'Manual review must record a final verified result' using errcode = '23514';
    end if;
  elsif p_actor_id is not null then
    raise exception 'Provider and webhook transitions must not impersonate a human actor' using errcode = '22023';
  end if;

  select * into v_attempt from public.payment_transactions where id = p_transaction_id for update;
  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id;
  if p_source = 'sslcommerz_webhook' and v_attempt.provider <> 'sslcommerz' then
    raise exception 'SSLCommerz webhook source is valid only for SSLCommerz attempts' using errcode = '23514';
  end if;
  if p_source = 'manual_review' and not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active'
      and (p.role = 'super_admin' or (p.role = 'merchant' and exists (
        select 1 from public.stores s where s.id = v_order.store_id and s.owner_id = p.id
      )))
  ) then
    raise exception 'Manual-review actor is not authorized for this order' using errcode = '42501';
  end if;

  if v_attempt.status = p_new_status then
    if p_provider_transaction_reference is null
       or p_provider_transaction_reference = v_attempt.provider_transaction_reference then
      return v_attempt;
    end if;
  else
    if not (
      (v_attempt.status = 'pending' and p_new_status in ('pending_verification','paid','failed'))
      or (v_attempt.status = 'pending_verification' and p_new_status in ('paid','failed'))
    ) then
      raise exception 'Invalid payment transaction status transition: % -> %', v_attempt.status, p_new_status using errcode = '23514';
    end if;
  end if;

  if v_attempt.provider_transaction_reference is not null
     and p_provider_transaction_reference is not null
     and v_attempt.provider_transaction_reference <> p_provider_transaction_reference then
    raise exception 'Provider transaction reference cannot be replaced' using errcode = '55000';
  end if;

  v_old_status := v_attempt.status;
  v_status_changed := v_old_status is distinct from p_new_status;
  v_reference_changed := v_attempt.provider_transaction_reference is null
    and p_provider_transaction_reference is not null;
  v_verified_at := case when p_new_status in ('paid','failed')
                        then coalesce(v_attempt.verified_at, clock_timestamp())
                        else null end;

  update public.payment_transactions
  set status = p_new_status,
      provider_transaction_reference = coalesce(provider_transaction_reference, p_provider_transaction_reference),
      verified_at = v_verified_at
  where id = p_transaction_id
  returning * into v_attempt;

  v_audit_metadata := jsonb_strip_nulls(jsonb_build_object(
    'order_id', v_attempt.order_id,
    'previous_status', v_old_status,
    'new_status', v_attempt.status,
    'source', p_source,
    'provider_transaction_reference', case when v_reference_changed then v_attempt.provider_transaction_reference else null end,
    'reason', case when p_source = 'manual_review' then left(trim(p_reason),500) else null end
  ));

  if v_status_changed then
    insert into public.audit_logs(actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'payment_transaction.status_changed', 'payment_transaction', v_attempt.id, v_audit_metadata);
  end if;

  if v_reference_changed then
    insert into public.audit_logs(actor_id, action, resource_type, resource_id, metadata)
    values (p_actor_id, 'payment_transaction.provider_reference_attached', 'payment_transaction', v_attempt.id, v_audit_metadata);
  end if;

  return v_attempt;
end;
$$;

-- The trigger is the final database guard for inserts, including privileged inserts.
-- Client DML remains revoked; the service role can call only the trusted functions.
