-- BazarHQ SRS v2.1 Stage 1: Project Owner-approved Option B payment lifecycle.
-- Immutable financial facts; trusted server-side lifecycle updates only.
-- This migration is additive. It must be reviewed before application to any shared database.

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_config_id uuid references public.payment_configs(id) on delete restrict,
  method text not null check (method in ('bkash','nagad','rocket','sslcommerz','cod')),
  provider text not null check (provider in ('bkash','nagad','rocket','sslcommerz','cod','manual')),
  provider_transaction_reference text check (provider_transaction_reference is null or length(trim(provider_transaction_reference)) between 1 and 200),
  amount numeric(12,2) not null check (amount >= 0),
  currency text not null default 'BDT' check (currency = 'BDT'),
  status text not null default 'pending'
    check (status in ('pending','pending_verification','paid','failed')),
  idempotency_key text not null check (length(trim(idempotency_key)) between 1 and 200),
  metadata_sanitized jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata_sanitized) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  verified_at timestamptz,
  constraint payment_transaction_terminal_verification_check
    check (status not in ('paid','failed') or verified_at is not null),
  constraint payment_transaction_nonterminal_unverified_check
    check (status in ('paid','failed') or verified_at is null),
  unique (id, order_id)
);

comment on table public.payment_transactions is
  'Payment attempts. Financial identity/facts are immutable; trusted server workflow may advance status and set verification timestamps. Every creation/transition is written to append-only audit_logs.';
comment on column public.payment_transactions.metadata_sanitized is
  'Sanitized non-secret metadata only. Never store credentials, access tokens, authorization headers, or raw provider secrets.';
comment on column public.payment_transactions.provider_transaction_reference is
  'Provider reference may be assigned once; after assignment it is immutable. Deduplicated for providers with unique-reference semantics.';

-- A key is idempotent within an order; a provider reference is unique where provider semantics support it.
create unique index payment_transactions_order_idempotency_uq
  on public.payment_transactions(order_id, idempotency_key);
create unique index payment_transactions_provider_reference_uq
  on public.payment_transactions(provider, provider_transaction_reference)
  where provider_transaction_reference is not null
    and provider in ('bkash','nagad','rocket','sslcommerz');
create index payment_transactions_order_created_idx
  on public.payment_transactions(order_id, created_at desc);
create index payment_transactions_status_created_idx
  on public.payment_transactions(status, created_at)
  where status in ('pending','pending_verification');
create index payment_transactions_config_idx
  on public.payment_transactions(payment_config_id)
  where payment_config_id is not null;

-- Enforce order/payment-config consistency independently of the calling endpoint.
create or replace function public.validate_payment_transaction_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_config public.payment_configs%rowtype;
begin
  select * into v_order from public.orders where id = new.order_id;
  if not found then
    raise exception 'Payment transaction order does not exist' using errcode = '23503';
  end if;
  if new.method <> v_order.payment_method then
    raise exception 'Payment method must match the order payment method' using errcode = '23514';
  end if;
  if new.amount <> v_order.total_amount then
    raise exception 'Payment attempt amount must match the order total' using errcode = '23514';
  end if;
  if new.provider <> new.method and new.provider <> 'manual' then
    raise exception 'Payment provider must match the selected method or be manual' using errcode = '23514';
  end if;
  if new.method = 'cod' and new.provider not in ('cod','manual') then
    raise exception 'COD method requires COD or manual provider' using errcode = '23514';
  end if;
  if new.payment_config_id is not null then
    select * into v_config from public.payment_configs where id = new.payment_config_id;
    if not found or v_config.store_id <> v_order.store_id or v_config.method <> new.method then
      raise exception 'Payment configuration must belong to the order store and method' using errcode = '23514';
    end if;
    if not v_config.is_enabled then
      raise exception 'Payment configuration is disabled' using errcode = '23514';
    end if;
  end if;
  if new.status <> 'pending' or new.verified_at is not null then
    raise exception 'Payment attempts must be created in pending status without verification timestamp' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger payment_transactions_validate_insert_trg
before insert on public.payment_transactions
for each row execute function public.validate_payment_transaction_insert();

-- Protect financial facts and enforce a monotonic attempt lifecycle. DML privileges are
-- revoked from API roles; trusted SECURITY DEFINER functions below are the write path.
create or replace function public.guard_payment_transaction_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Payment transaction history is retained; DELETE is prohibited' using errcode = '55000';
  end if;

  if new.id is distinct from old.id
     or new.order_id is distinct from old.order_id
     or new.payment_config_id is distinct from old.payment_config_id
     or new.method is distinct from old.method
     or new.provider is distinct from old.provider
     or new.amount is distinct from old.amount
     or new.currency is distinct from old.currency
     or new.idempotency_key is distinct from old.idempotency_key
     or new.metadata_sanitized is distinct from old.metadata_sanitized
     or new.created_at is distinct from old.created_at then
    raise exception 'Payment transaction identity and financial facts are immutable' using errcode = '55000';
  end if;

  if old.provider_transaction_reference is not null
     and new.provider_transaction_reference is distinct from old.provider_transaction_reference then
    raise exception 'Provider transaction reference cannot be changed after assignment' using errcode = '55000';
  end if;

  if old.verified_at is not null and new.verified_at is distinct from old.verified_at then
    raise exception 'Payment verification timestamp is immutable once set' using errcode = '55000';
  end if;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'pending' and new.status in ('pending_verification','paid','failed'))
      or (old.status = 'pending_verification' and new.status in ('paid','failed'))
    ) then
      raise exception 'Invalid payment transaction status transition: % -> %', old.status, new.status using errcode = '23514';
    end if;
  end if;

  if new.status in ('paid','failed') and new.verified_at is null then
    raise exception 'Terminal payment status requires verified_at' using errcode = '23514';
  end if;
  if new.status not in ('paid','failed') and new.verified_at is not null then
    raise exception 'Non-terminal payment status must not have verified_at' using errcode = '23514';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger payment_transactions_guard_update_trg
before update or delete on public.payment_transactions
for each row execute function public.guard_payment_transaction_update();

-- Trusted server-side creation function. Repeated calls with the same order/key return
-- the same attempt; reusing the key for different facts fails closed.
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
  v_attempt public.payment_transactions%rowtype;
  v_inserted boolean := false;
begin
  if p_metadata_sanitized is null or jsonb_typeof(p_metadata_sanitized) <> 'object' then
    raise exception 'Sanitized metadata must be a JSON object' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 1 and 200 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'Cannot create a payment attempt for a cancelled order' using errcode = '23514';
  end if;
  if p_method <> v_order.payment_method or p_amount <> v_order.total_amount then
    raise exception 'Payment method and amount must match the order' using errcode = '23514';
  end if;

  if p_actor_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_actor_id and p.status = 'active' and p.role = 'customer'
      and p.id = v_order.customer_id
  ) then
    raise exception 'Actor is not the active customer for this order' using errcode = '42501';
  end if;

  -- Return an existing idempotent attempt before re-validating mutable configuration;
  -- disabling a payment method affects future orders, not a retry of an existing attempt.
  select * into v_attempt from public.payment_transactions
  where order_id = p_order_id and idempotency_key = p_idempotency_key;
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
    where order_id = p_order_id and idempotency_key = p_idempotency_key;
    if v_attempt.payment_config_id is distinct from p_payment_config_id
       or v_attempt.method is distinct from p_method
       or v_attempt.provider is distinct from p_provider
       or v_attempt.amount is distinct from p_amount
       or v_attempt.currency is distinct from 'BDT'
       or v_attempt.metadata_sanitized is distinct from p_metadata_sanitized then
      raise exception 'Idempotency key was already used with different payment facts' using errcode = '23505';
    end if;
    return v_attempt;
  end if;

  insert into public.audit_logs(actor_id, action, resource_type, resource_id, metadata)
  values (
    p_actor_id, 'payment_transaction.created', 'payment_transaction', v_attempt.id,
    jsonb_build_object('order_id', v_attempt.order_id, 'method', v_attempt.method,
      'provider', v_attempt.provider, 'amount', v_attempt.amount, 'currency', v_attempt.currency,
      'status', v_attempt.status)
  );
  return v_attempt;
end;
$$;

-- Trusted server-side transition function. Manual review must identify an active
-- Merchant owning the order or a Super Admin; VPN/TOTP enforcement remains at the API gateway.
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
begin
  if p_new_status is null or p_new_status not in ('pending','pending_verification','paid','failed') then
    raise exception 'Unsupported payment transaction status' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('provider_verification','sslcommerz_webhook','manual_review') then
    raise exception 'Unsupported payment transaction state source' using errcode = '22023';
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

  if v_status_changed or v_reference_changed then
    insert into public.audit_logs(actor_id, action, resource_type, resource_id, metadata)
    values (
      p_actor_id,
      case when v_status_changed then 'payment_transaction.status_changed'
           else 'payment_transaction.provider_reference_attached' end,
      'payment_transaction', v_attempt.id,
      jsonb_strip_nulls(jsonb_build_object(
        'order_id', v_attempt.order_id,
        'previous_status', v_old_status,
        'new_status', v_attempt.status,
        'source', p_source,
        'reason', case when p_source = 'manual_review' then left(trim(p_reason),500) else null end
      ))
    );
  end if;
  return v_attempt;
end;
$$;

-- Do not let anon/authenticated/service_role mutate or read internal payment fields directly.
-- SECURITY DEFINER functions above are the only write API; the service role is allowed to execute
-- those functions but is not granted direct table DML. Clients receive only a safe column projection.
alter table public.payment_transactions enable row level security;
revoke all on table public.payment_transactions from public, anon, authenticated, service_role;
grant select (id, order_id, payment_config_id, method, provider, provider_transaction_reference,
  amount, currency, status, created_at, updated_at, verified_at)
  on public.payment_transactions to authenticated;

create policy payment_transactions_read_authorized on public.payment_transactions
for select to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id
      and (o.customer_id = (select auth.uid())
           or public.owns_store(o.store_id)
           or public.is_super_admin())
  )
);

revoke all on function public.create_payment_attempt(uuid,uuid,text,text,numeric,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function public.record_payment_transaction_state(uuid,text,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.create_payment_attempt(uuid,uuid,text,text,numeric,text,jsonb,uuid) to service_role;
grant execute on function public.record_payment_transaction_state(uuid,text,text,text,uuid,text) to service_role;

-- Option B decision: NFR-C-03 immutability applies to identity/financial facts and retention;
-- status lifecycle fields are controlled by the trusted functions above and audited append-only.
