-- =============================================================================
-- Migration 005 — schema additions the frontend and backend workflows need.
--
-- Additive only: no table is dropped or renamed and no Stage 1 column changes
-- meaning. Every addition is listed in docs/database/MIGRATIONS.md and the
-- non-SRS fields remain flagged in docs/reports/SCHEMA_GAPS.md for Project Owner
-- sign-off. Written with IF [NOT] EXISTS so it also applies over a recovered
-- original 001/002.
--
-- Down (manual, development only): drop the columns/indexes/constraints added
-- below and `drop schema private cascade`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- private schema: internal state never exposed through the Data API
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- Public reference numbers: ORD-/RET-/TKT-YYYYMMDD-BHQnnnnnn (FR-C-19, FR-RET-04, FR-SUP-02).
create table if not exists private.reference_counters (
  prefix text not null check (prefix in ('ORD','RET','TKT')),
  day date not null,
  last_value integer not null check (last_value between 1 and 999999),
  primary key (prefix, day)
);

create or replace function private.next_reference(p_prefix text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Dhaka')::date;
  v_next integer;
begin
  insert into private.reference_counters as c (prefix, day, last_value)
  values (p_prefix, v_day, 1)
  on conflict (prefix, day) do update set last_value = c.last_value + 1
  returning last_value into v_next;
  return p_prefix || '-' || to_char(v_day, 'YYYYMMDD') || '-BHQ' || lpad(v_next::text, 6, '0');
end;
$$;
revoke all on function private.next_reference(text) from public;

-- Fixed-window rate limiting shared by Edge Functions (SEC-04, FR-C-23, API-25).
create table if not exists private.rate_limits (
  bucket text primary key check (length(bucket) <= 300),
  window_started_at timestamptz not null,
  hits integer not null
);

-- Login lockout state for the password-verification auth hook (AUTH-07, FR-SA-02).
create table if not exists private.auth_login_attempts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  failed_count integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Super Admin network allowlist (AUTH-08, SEC-08/11). Empty = no admin access (fail closed).
create table if not exists private.admin_ip_allowlist (
  cidr cidr primary key,
  note text not null default '',
  created_at timestamptz not null default now()
);

-- Small key/value settings for trusted server logic (never secrets — those live in Vault).
create table if not exists private.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into private.app_settings (key, value) values
  ('admin_ip_header', 'x-forwarded-for'),
  ('admin_ip_header_position', 'last')
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists suspension_reason text check (suspension_reason is null or length(suspension_reason) <= 500),
  add column if not exists deleted_at timestamptz;

-- -----------------------------------------------------------------------------
-- stores (UI fields with no SRS column: see SCHEMA_GAPS)
-- -----------------------------------------------------------------------------
alter table public.stores
  add column if not exists category text
    check (category is null or category in ('groceries','fashion','electronics','home_living','health_beauty','books_stationery','other')),
  add column if not exists banner_url text check (banner_url is null or length(banner_url) <= 1024),
  add column if not exists shipping_settings jsonb not null default
    '{"inside_dhaka_charge":60,"outside_dhaka_charge":120,"estimated_days_inside_dhaka":2,"estimated_days_outside_dhaka":4}'::jsonb,
  add column if not exists notification_preferences jsonb not null default
    '{"new_order_email":true,"new_order_sms":false,"low_stock_email":true,"support_ticket_email":true}'::jsonb,
  add column if not exists published_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stores_subdomain_not_reserved_check') then
    -- FR-M-08 reserved words, enforced in the database as well as the API.
    alter table public.stores add constraint stores_subdomain_not_reserved_check
      check (subdomain not in ('admin','api','www','app','mail','help','support','static'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stores_shipping_settings_shape_check') then
    alter table public.stores add constraint stores_shipping_settings_shape_check check (
      jsonb_typeof(shipping_settings) = 'object'
      and (shipping_settings ->> 'inside_dhaka_charge')::numeric between 0 and 100000
      and (shipping_settings ->> 'outside_dhaka_charge')::numeric between 0 and 100000
      and (shipping_settings ->> 'estimated_days_inside_dhaka')::int between 0 and 60
      and (shipping_settings ->> 'estimated_days_outside_dhaka')::int between 0 and 60
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stores_notification_preferences_shape_check') then
    alter table public.stores add constraint stores_notification_preferences_shape_check
      check (jsonb_typeof(notification_preferences) = 'object');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- themes
-- -----------------------------------------------------------------------------
alter table public.themes
  add column if not exists accent text not null default '#059669' check (accent ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists breaking_change_effective_at timestamptz;

-- -----------------------------------------------------------------------------
-- products: SKU, display-only original price, soft delete (API-14)
-- -----------------------------------------------------------------------------
alter table public.products
  add column if not exists sku text check (sku is null or (length(trim(sku)) between 1 and 64 and sku ~ '^[A-Za-z0-9._-]+$')),
  add column if not exists compare_at_price numeric(12,2),
  add column if not exists deleted_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_compare_at_price_check') then
    -- Display-only "original / asking" price; checkout always charges base_price (+ variant adjustment).
    alter table public.products add constraint products_compare_at_price_check
      check (compare_at_price is null or compare_at_price > base_price);
  end if;
end $$;
create unique index if not exists products_store_sku_uq
  on public.products (store_id, lower(sku)) where sku is not null and deleted_at is null;
create index if not exists products_live_idx on public.products (store_id, status) where deleted_at is null;

-- Effective variant price must stay positive.
create or replace function public.validate_variant_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_base numeric;
begin
  select base_price into v_base from public.products where id = new.product_id;
  if v_base + new.price_adjustment <= 0 then
    raise exception 'Variant price (base price + adjustment) must be positive' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists product_variants_validate_price on public.product_variants;
create trigger product_variants_validate_price before insert or update of price_adjustment, product_id
on public.product_variants for each row execute function public.validate_variant_price();

-- -----------------------------------------------------------------------------
-- orders: public number, amount breakdown, idempotency, stock-release and delivery markers
-- -----------------------------------------------------------------------------
alter table public.orders
  add column if not exists order_number text,
  add column if not exists subtotal numeric(12,2),
  add column if not exists delivery_charge numeric(12,2) not null default 0 check (delivery_charge >= 0),
  add column if not exists currency text not null default 'BDT' check (currency = 'BDT'),
  add column if not exists idempotency_key text check (idempotency_key is null or length(trim(idempotency_key)) between 8 and 200),
  add column if not exists request_fingerprint text,
  add column if not exists stock_released_at timestamptz,
  add column if not exists delivered_at timestamptz;

update public.orders set order_number = private.next_reference('ORD') where order_number is null;
update public.orders set subtotal = total_amount - delivery_charge where subtotal is null;
alter table public.orders alter column order_number set default private.next_reference('ORD');
alter table public.orders alter column order_number set not null;

create or replace function public.default_order_amounts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subtotal is null then
    new.subtotal := new.total_amount - coalesce(new.delivery_charge, 0);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_default_amounts on public.orders;
create trigger orders_default_amounts before insert on public.orders
for each row execute function public.default_order_amounts();
alter table public.orders alter column subtotal set not null;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'orders_amounts_check') then
    alter table public.orders add constraint orders_amounts_check
      check (subtotal > 0 and subtotal + delivery_charge = total_amount);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'orders_delivered_at_check') then
    alter table public.orders add constraint orders_delivered_at_check
      check (status <> 'delivered' or delivered_at is not null);
  end if;
end $$;
create unique index if not exists orders_order_number_uq on public.orders (order_number);
create unique index if not exists orders_store_idempotency_uq on public.orders (store_id, idempotency_key)
  where idempotency_key is not null;

-- delivery_events: record the previous status of each transition.
alter table public.delivery_events
  add column if not exists previous_status text check (previous_status is null or previous_status in
    ('pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled'));

-- inventory_movements: optional note and idempotency key for manual adjustments.
alter table public.inventory_movements
  add column if not exists note text check (note is null or length(note) <= 500),
  add column if not exists idempotency_key text check (idempotency_key is null or length(trim(idempotency_key)) between 8 and 200);
create unique index if not exists inventory_movements_idempotency_uq
  on public.inventory_movements (store_id, idempotency_key) where idempotency_key is not null;

-- payment_configs: safe metadata for the masked projection (FR-M-33/34).
alter table public.payment_configs
  add column if not exists credential_hint text check (credential_hint is null or length(credential_hint) <= 8),
  add column if not exists environment text not null default 'sandbox' check (environment in ('sandbox','live')),
  add column if not exists validation_status text not null default 'unverified'
    check (validation_status in ('valid','invalid','unverified','not_required'));

-- -----------------------------------------------------------------------------
-- returns: public number, method, amounts, workflow timestamps, dispute (FR-RET-04/07/09)
-- -----------------------------------------------------------------------------
alter table public.returns
  add column if not exists return_number text,
  add column if not exists return_method text check (return_method is null or return_method in ('customer_drop_off','merchant_coordinated')),
  add column if not exists refund_amount_requested numeric(12,2) check (refund_amount_requested is null or refund_amount_requested > 0),
  add column if not exists decided_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists restocked_at timestamptz,
  add column if not exists dispute_status text not null default 'none' check (dispute_status in ('none','open','info_requested','resolved')),
  add column if not exists dispute_decision text check (dispute_decision is null or dispute_decision in ('upheld','overridden')),
  add column if not exists dispute_admin_note text check (dispute_admin_note is null or length(dispute_admin_note) <= 2000),
  add column if not exists escalated_at timestamptz;
update public.returns set return_number = private.next_reference('RET') where return_number is null;
alter table public.returns alter column return_number set default private.next_reference('RET');
alter table public.returns alter column return_number set not null;
create unique index if not exists returns_return_number_uq on public.returns (return_number);

-- -----------------------------------------------------------------------------
-- support_tickets: public number, explicit queue, dispute (FR-SUP-02/03, FR-SA-20/21)
-- -----------------------------------------------------------------------------
alter table public.support_tickets
  add column if not exists ticket_number text,
  add column if not exists queue text not null default 'platform' check (queue in ('store','platform')),
  add column if not exists dispute_status text not null default 'none' check (dispute_status in ('none','open','info_requested','resolved')),
  add column if not exists dispute_decision text check (dispute_decision is null or dispute_decision in ('upheld','overridden')),
  add column if not exists dispute_admin_note text check (dispute_admin_note is null or length(dispute_admin_note) <= 2000);
update public.support_tickets set ticket_number = private.next_reference('TKT') where ticket_number is null;
alter table public.support_tickets alter column ticket_number set default private.next_reference('TKT');
alter table public.support_tickets alter column ticket_number set not null;
create unique index if not exists support_tickets_ticket_number_uq on public.support_tickets (ticket_number);
create index if not exists support_tickets_queue_idx on public.support_tickets (queue, status);

-- -----------------------------------------------------------------------------
-- notifications, announcements, policies
-- -----------------------------------------------------------------------------
alter table public.notifications
  add column if not exists push_dispatched_at timestamptz;
create index if not exists notifications_push_pending_idx on public.notifications (created_at)
  where push_dispatched_at is null;

alter table public.announcements
  add column if not exists recipient_count integer check (recipient_count is null or recipient_count >= 0),
  add column if not exists created_by uuid references public.profiles(id) on delete restrict;

alter table public.policies
  add column if not exists published_at timestamptz;

-- New columns default to Supabase's broad grants; keep client roles narrow (see 002).
revoke all on table public.orders, public.returns, public.support_tickets, public.payment_configs from anon;
revoke insert, update, delete on table public.orders, public.returns, public.support_tickets from authenticated;
revoke all on table public.payment_configs from authenticated;
grant update (category, banner_url, shipping_settings, notification_preferences) on public.stores to authenticated;
