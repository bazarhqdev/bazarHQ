-- =============================================================================
-- BazarHQ SRS V2.1 Stage 1 — core application schema (migration 001)
--
-- RECONSTRUCTION NOTICE
-- The original 20261021000100_core_schema.sql was not supplied with the
-- backend brief (only 003, 004 and the SQL tests were). This file rebuilds it
-- from the authoritative sources, in this order of precedence:
--   1. SRS V2.1 §18.1 (entities/columns), §18.2 (DB-01..DB-13), §13–§15 states
--   2. docs/database/DATABASE_SCHEMA.md and RLS_POLICY_MATRIX.md
--   3. Everything migrations 003/004 and the Stage 1 tests reference
--      (column names, constraint/trigger names, error codes).
-- If the original file is recovered, replace this one with it and re-run
-- `supabase db reset && supabase test db`; later migrations (005+) are written
-- defensively (IF [NOT] EXISTS / CREATE OR REPLACE) so they apply on either.
--
-- Historical note kept from the original: the payment-transactions decision was
-- once tracked in docs/BLOCKED_PAYMENT_TRANSACTIONS_DECISION.md; it is resolved
-- (Option B) in docs/database/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md and the
-- table itself is created by migration 003.
--
-- Scope: tables, constraints, indexes, timestamp triggers, append-only guards,
-- stock-model invariants, same-store relationship guards and safe default
-- profile provisioning. RLS, grants and Storage are in migration 002.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Generic trigger functions
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
comment on function public.set_updated_at() is 'Maintains updated_at on mutable business tables (SRS §18).';

-- Append-only guard for event/audit/history tables (DB-04, DB-10, DM-06, FR-REF-06).
create or replace function public.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; % is prohibited', tg_table_name, tg_op using errcode = '55000';
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles — canonical application profile (AUTHZ-01). auth.users stays Supabase-managed.
-- -----------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '' check (length(full_name) <= 150),
  phone text check (phone is null or phone ~ '^01[3-9][0-9]{8}$'),
  avatar_url text check (avatar_url is null or length(avatar_url) <= 1024),
  role text not null default 'customer' check (role in ('customer','merchant','super_admin')),
  status text not null default 'active' check (status in ('active','suspended','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Canonical application profile. role/status are changed only by trusted server operations (AUTHZ-01/02).';

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

-- Client roles may never change role/status, whatever column grants say (AUTHZ-02).
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon','authenticated')
     and (new.role is distinct from old.role or new.status is distinct from old.status or new.id is distinct from old.id) then
    raise exception 'Profile role and status can only be changed by an authorized server operation' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_privileged_fields before update on public.profiles
for each row execute function public.guard_profile_privileged_fields();

-- Safe default provisioning: every new auth user gets a customer profile.
-- Role elevation happens only through trusted, audited server logic.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, status)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''), 150),
    'customer',
    'active'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- themes (FR-SA-14) and stores (one store per Merchant, FR-M-10)
-- -----------------------------------------------------------------------------

create table public.themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 1000),
  preview_url text check (preview_url is null or length(preview_url) <= 1024),
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger themes_set_updated_at before update on public.themes
for each row execute function public.set_updated_at();

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 80),
  subdomain text not null unique
    check (length(subdomain) between 3 and 63 and subdomain ~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$'),
  status text not null default 'draft' check (status in ('draft','published','suspended')),
  theme_id uuid references public.themes(id) on delete restrict,
  brand_colour text not null default '#059669' check (brand_colour ~ '^#[0-9A-Fa-f]{6}$'),
  tagline text check (tagline is null or length(tagline) <= 160),
  logo_url text check (logo_url is null or length(logo_url) <= 1024),
  return_window_days integer not null default 7 check (return_window_days between 1 and 90),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on column public.stores.owner_id is 'UNIQUE: exactly one store per Merchant in V2.1 (FR-M-10).';
comment on column public.stores.return_window_days is 'Calendar days from delivery; default 7 (FR-M-45, FR-RET-01).';
create trigger stores_set_updated_at before update on public.stores
for each row execute function public.set_updated_at();

-- Store owner must be a Merchant; theme must be selectable (active) when chosen.
create or replace function public.validate_store_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = new.owner_id and p.role = 'merchant') then
    raise exception 'Store owner must be a Merchant profile' using errcode = '23514';
  end if;
  if new.theme_id is not null
     and (tg_op = 'INSERT' or new.theme_id is distinct from old.theme_id)
     and not exists (select 1 from public.themes t where t.id = new.theme_id and t.is_active) then
    raise exception 'Selected theme is not active' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger stores_validate_row before insert or update on public.stores
for each row execute function public.validate_store_row();

create index stores_status_idx on public.stores(status);
create index stores_theme_idx on public.stores(theme_id) where theme_id is not null;
-- DB-07: root-site store discovery by name (stores only, never products).
create index stores_name_search_idx on public.stores using gin (to_tsvector('simple', name));

-- -----------------------------------------------------------------------------
-- categories — hierarchical, parent must be in the same store
-- -----------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) <= 90),
  parent_id uuid,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_store_slug_uq unique (store_id, slug),
  constraint categories_id_store_uq unique (id, store_id),
  constraint categories_parent_same_store_fk foreign key (parent_id, store_id)
    references public.categories(id, store_id) on delete restrict,
  constraint categories_not_own_parent_check check (parent_id is null or parent_id <> id)
);
create index categories_parent_idx on public.categories(parent_id) where parent_id is not null;
create trigger categories_set_updated_at before update on public.categories
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- products / product_variants / product_images — mutually exclusive stock model (DB-08)
-- -----------------------------------------------------------------------------

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 150),
  description text not null default '' check (length(description) <= 5000),
  category_id uuid,
  base_price numeric(12,2) not null check (base_price > 0),
  product_type text not null check (product_type in ('simple','variant')),
  stock_quantity integer,
  low_stock_threshold integer not null default 5 check (low_stock_threshold >= 0),
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_id_store_uq unique (id, store_id),
  constraint products_category_same_store_fk foreign key (category_id, store_id)
    references public.categories(id, store_id) on delete restrict,
  constraint products_stock_model_check check (
    (product_type = 'simple' and stock_quantity is not null)
    or (product_type = 'variant' and stock_quantity is null)
  ),
  constraint products_stock_nonnegative_check check (stock_quantity is null or stock_quantity >= 0)
);
comment on column public.products.stock_quantity is 'Simple products only; NULL for variant products (DB-08). Changed only by trusted inventory/order operations.';
create index products_store_status_idx on public.products(store_id, status);
create index products_category_idx on public.products(category_id) where category_id is not null;
-- DB-07: in-store product search.
create index products_search_idx on public.products
  using gin (to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, '')));
create trigger products_set_updated_at before update on public.products
for each row execute function public.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  variant_label text not null check (length(trim(variant_label)) between 1 and 80),
  price_adjustment numeric(12,2) not null default 0,
  stock_quantity integer not null check (stock_quantity >= 0),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_variants_id_product_uq unique (id, product_id),
  constraint product_variants_label_uq unique (product_id, variant_label)
);
create trigger product_variants_set_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();

-- Deferred cross-row invariant: a simple product has no variants; a variant product
-- has at least one. Create a variant product and its first variant in one transaction.
create or replace function public.assert_product_stock_model(p_product_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
  v_variant_count integer;
begin
  select product_type into v_type from public.products where id = p_product_id;
  if not found then
    return; -- parent removed in the same transaction
  end if;
  select count(*) into v_variant_count from public.product_variants where product_id = p_product_id;
  if v_type = 'simple' and v_variant_count > 0 then
    raise exception 'Simple product % cannot have product_variants rows', p_product_id using errcode = '23514';
  end if;
  if v_type = 'variant' and v_variant_count = 0 then
    raise exception 'Variant product % requires at least one product_variants row', p_product_id using errcode = '23514';
  end if;
end;
$$;

create or replace function public.check_product_stock_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.assert_product_stock_model(new.id);
  return null;
end;
$$;

create or replace function public.check_variant_stock_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform public.assert_product_stock_model(old.product_id);
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform public.assert_product_stock_model(new.product_id);
  end if;
  return null;
end;
$$;

create constraint trigger products_stock_model_ct
after insert or update of product_type on public.products
deferrable initially deferred
for each row execute function public.check_product_stock_model();

create constraint trigger product_variants_stock_model_ct
after insert or update of product_id or delete on public.product_variants
deferrable initially deferred
for each row execute function public.check_variant_stock_model();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^stores/[0-9a-f-]{36}/products/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}$'),
  is_primary boolean not null default false,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index product_images_one_primary_uq on public.product_images(product_id) where is_primary;
create index product_images_product_idx on public.product_images(product_id, display_order);
create trigger product_images_set_updated_at before update on public.product_images
for each row execute function public.set_updated_at();

-- Storage path must name the product's own store and product (tenant path contract).
create or replace function public.validate_product_image_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_store_id uuid;
begin
  select store_id into v_store_id from public.products where id = new.product_id;
  if new.storage_path not like 'stores/' || v_store_id::text || '/products/' || new.product_id::text || '/%' then
    raise exception 'Image path must be stores/{store_uuid}/products/{product_uuid}/{file}' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger product_images_validate_path before insert or update of storage_path, product_id on public.product_images
for each row execute function public.validate_product_image_path();

-- -----------------------------------------------------------------------------
-- orders / order_items — canonical states (§13.1); state changes via trusted operations only
-- -----------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  customer_id uuid references public.profiles(id) on delete set null,
  order_phone text not null check (order_phone ~ '^01[3-9][0-9]{8}$'),
  order_email text check (order_email is null or (length(order_email) <= 254 and order_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  status text not null default 'pending'
    check (status in ('pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled')),
  total_amount numeric(12,2) not null check (total_amount > 0),
  payment_method text not null check (payment_method in ('bkash','nagad','rocket','sslcommerz','cod')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending','pending_verification','paid','failed','cod_pending','cod_collected','refunded')),
  delivery_address jsonb not null
    check (jsonb_typeof(delivery_address) = 'object' and delivery_address ? 'address' and delivery_address ? 'district'),
  cancellation_reason text check (cancellation_reason is null or length(cancellation_reason) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_id_store_uq unique (id, store_id),
  constraint orders_cancellation_requires_reason_check
    check (status <> 'cancelled' or nullif(trim(cancellation_reason), '') is not null),
  constraint orders_cod_payment_status_check check (
    (payment_method = 'cod' and payment_status in ('pending','cod_pending','cod_collected','refunded','failed'))
    or (payment_method <> 'cod' and payment_status not in ('cod_pending','cod_collected'))
  )
);
comment on table public.orders is 'customer_id NULL = guest checkout. status/payment_status change only through trusted server operations (DB-02).';
comment on column public.orders.delivery_address is 'Immutable delivery address snapshot taken at checkout.';
create index orders_store_created_idx on public.orders(store_id, created_at desc);
create index orders_store_status_idx on public.orders(store_id, status);
create index orders_customer_created_idx on public.orders(customer_id, created_at desc) where customer_id is not null;
create trigger orders_set_updated_at before update on public.orders
for each row execute function public.set_updated_at();

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  variant_id uuid,
  product_name text not null check (length(product_name) between 1 and 150),
  variant_label text check (variant_label is null or length(variant_label) <= 80),
  quantity integer not null check (quantity between 1 and 1000),
  unit_price numeric(12,2) not null check (unit_price > 0),
  subtotal numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint order_items_variant_product_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint order_items_subtotal_check check (subtotal = unit_price * quantity)
);
comment on table public.order_items is 'Immutable product/variant/price snapshots (append-only after order creation).';
create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);

create or replace function public.validate_order_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order_store uuid;
  v_product public.products%rowtype;
begin
  select store_id into v_order_store from public.orders where id = new.order_id;
  select * into v_product from public.products where id = new.product_id;
  if v_product.store_id is distinct from v_order_store then
    raise exception 'Order item product must belong to the order store' using errcode = '23514';
  end if;
  if v_product.product_type = 'variant' and new.variant_id is null then
    raise exception 'Variant products require variant_id on order items' using errcode = '23514';
  end if;
  if v_product.product_type = 'simple' and new.variant_id is not null then
    raise exception 'Simple products must not reference a variant' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger order_items_validate before insert on public.order_items
for each row execute function public.validate_order_item();
create trigger order_items_append_only before update or delete on public.order_items
for each row execute function public.prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- payment_configs — one row per method per store; ciphertext only (DB-05)
-- -----------------------------------------------------------------------------

create table public.payment_configs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  method text not null check (method in ('bkash','nagad','rocket','sslcommerz','cod')),
  is_enabled boolean not null default false,
  credentials_encrypted bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_configs_store_method_uq unique (store_id, method)
);
comment on column public.payment_configs.credentials_encrypted is 'Ciphertext only. Never selected by client roles; key material lives in Supabase Vault (DB-05).';
create trigger payment_configs_set_updated_at before update on public.payment_configs
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- delivery_events — append-only merchant-managed delivery/COD history (DM-05, DM-06)
-- -----------------------------------------------------------------------------

create table public.delivery_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in
    ('pending','confirmed','processing','shipped','out_for_delivery','delivered','cancelled','cod_collected')),
  notes text check (notes is null or length(notes) <= 1000),
  proof_image_path text check (proof_image_path is null or proof_image_path ~ '^orders/[0-9a-f-]{36}/delivery/[A-Za-z0-9._-]{1,200}$'),
  cod_amount numeric(12,2),
  created_at timestamptz not null default now(),
  constraint delivery_events_cod_amount_check check (
    (event_type = 'cod_collected' and cod_amount is not null and cod_amount > 0)
    or (event_type <> 'cod_collected' and cod_amount is null)
  )
);
create index delivery_events_order_created_idx on public.delivery_events(order_id, created_at);
create trigger delivery_events_append_only before update or delete on public.delivery_events
for each row execute function public.prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- returns / refunds (§14)
-- -----------------------------------------------------------------------------

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  reason text not null check (reason in ('wrong_item','damaged','not_as_described','change_of_mind','other')),
  condition_description text not null check (length(trim(condition_description)) between 1 and 2000),
  evidence_storage_path text check (evidence_storage_path is null or evidence_storage_path ~ '^returns/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}$'),
  status text not null default 'requested' check (status in ('requested','approved','rejected','received','closed')),
  merchant_response text check (merchant_response is null or length(merchant_response) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  received_at timestamptz,
  constraint returns_rejection_reason_check check (status <> 'rejected' or nullif(trim(merchant_response), '') is not null),
  constraint returns_received_at_check check (status not in ('received') or received_at is not null)
);
comment on column public.returns.order_id is 'UNIQUE: one return request per order (FR-RET-01).';
create index returns_customer_idx on public.returns(customer_id, created_at desc);
create trigger returns_set_updated_at before update on public.returns
for each row execute function public.set_updated_at();

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null unique references public.returns(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('original_method','bkash','nagad','rocket','bank_transfer')),
  status text not null default 'initiated' check (status in ('initiated','processing','completed','failed')),
  gateway_reference text check (gateway_reference is null or length(trim(gateway_reference)) between 1 and 200),
  initiator_id uuid references public.profiles(id) on delete restrict,
  processed_at timestamptz,
  confirmation_reference text check (confirmation_reference is null or length(trim(confirmation_reference)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refunds_completion_evidence_check check (
    status <> 'completed' or (processed_at is not null and (gateway_reference is not null or confirmation_reference is not null))
  )
);
comment on table public.refunds is 'One refund per return. Completed only with provider confirmation or manual settlement evidence (FR-REF-06/07).';
create trigger refunds_set_updated_at before update on public.refunds
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- support_tickets / ticket_messages / ticket_audit_log (§15, DB-10, DB-11)
-- -----------------------------------------------------------------------------

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete restrict,
  store_id uuid references public.stores(id) on delete restrict,
  order_id uuid references public.orders(id) on delete restrict,
  -- FR-SUP-01 categories: order issue, payment issue, delivery issue, return/refund, account issue, other.
  category text not null check (category in ('order','payment','delivery','return_refund','account','other')),
  subject text not null check (length(trim(subject)) between 1 and 150),
  description text not null check (length(trim(description)) between 1 and 5000),
  priority text not null default 'normal' check (priority in ('normal','urgent')),
  status text not null default 'open' check (status in ('open','in_progress','waiting_for_customer','resolved','closed')),
  assigned_to uuid references public.profiles(id) on delete restrict,
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  first_merchant_response_at timestamptz,
  escalation_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint support_tickets_resolution_required_check
    check (status not in ('resolved','closed') or nullif(trim(resolution_note), '') is not null),
  constraint support_tickets_closed_at_check check ((status = 'closed') = (closed_at is not null))
);
create index support_tickets_customer_idx on public.support_tickets(customer_id, created_at desc);
create index support_tickets_store_idx on public.support_tickets(store_id, status) where store_id is not null;
create index support_tickets_assigned_idx on public.support_tickets(assigned_to, status) where assigned_to is not null;
create trigger support_tickets_set_updated_at before update on public.support_tickets
for each row execute function public.set_updated_at();

-- An order reference must be the customer's own order, and the store must match it.
create or replace function public.validate_support_ticket_refs()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if new.order_id is not null then
    select * into v_order from public.orders where id = new.order_id;
    if v_order.customer_id is distinct from new.customer_id then
      raise exception 'Ticket order reference must belong to the ticket customer' using errcode = '23514';
    end if;
    if new.store_id is not null and new.store_id <> v_order.store_id then
      raise exception 'Ticket store must match the referenced order store' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger support_tickets_validate_refs before insert or update of order_id, store_id, customer_id on public.support_tickets
for each row execute function public.validate_support_ticket_refs();

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  sender_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (length(trim(body)) between 1 and 5000),
  attachment_storage_path text check (attachment_storage_path is null or attachment_storage_path ~ '^tickets/[0-9a-f-]{36}/[A-Za-z0-9._-]{1,200}$'),
  created_at timestamptz not null default now()
);
create index ticket_messages_ticket_idx on public.ticket_messages(ticket_id, created_at);
create trigger ticket_messages_append_only before update or delete on public.ticket_messages
for each row execute function public.prevent_append_only_mutation();

create table public.ticket_audit_log (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  event_type text not null check (event_type in
    ('created','status_changed','reply','assigned','escalated','closed','reopened','priority_changed','dispute_action')),
  previous_value text check (previous_value is null or length(previous_value) <= 200),
  new_value text check (new_value is null or length(new_value) <= 200),
  message_id uuid references public.ticket_messages(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
comment on table public.ticket_audit_log is 'Append-only workflow audit; message bodies stay in ticket_messages (FR-SUP-11).';
create index ticket_audit_log_ticket_idx on public.ticket_audit_log(ticket_id, created_at);
create trigger ticket_audit_log_append_only before update or delete on public.ticket_audit_log
for each row execute function public.prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- inventory_movements — immutable stock ledger (FR-M-22-INV)
-- -----------------------------------------------------------------------------

create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete restrict,
  product_id uuid not null,
  variant_id uuid,
  quantity_delta integer not null check (quantity_delta <> 0),
  reason text not null check (reason in ('sale','return','manual_adjustment','cancellation_release','payment_failure_release')),
  actor_id uuid references public.profiles(id) on delete restrict,
  reference_type text check (reference_type is null or reference_type in ('order','return','manual')),
  reference_id uuid,
  created_at timestamptz not null default now(),
  constraint inventory_movements_product_store_fk foreign key (product_id, store_id)
    references public.products(id, store_id) on delete restrict,
  constraint inventory_movements_variant_product_fk foreign key (variant_id, product_id)
    references public.product_variants(id, product_id) on delete restrict,
  constraint inventory_movements_reference_pair_check check ((reference_type is null) = (reference_id is null))
);
create index inventory_movements_store_created_idx on public.inventory_movements(store_id, created_at desc);
create index inventory_movements_product_idx on public.inventory_movements(product_id, variant_id, created_at desc);

-- variant_id is NULL for simple products and required for variant products (DB-08).
create or replace function public.validate_inventory_movement_stock_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  select product_type into v_type from public.products where id = new.product_id;
  if v_type = 'simple' and new.variant_id is not null then
    raise exception 'Simple-product movements must not reference a variant' using errcode = '23514';
  end if;
  if v_type = 'variant' and new.variant_id is null then
    raise exception 'Variant-product movements must reference the exact variant' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger inventory_movements_validate_stock_owner before insert on public.inventory_movements
for each row execute function public.validate_inventory_movement_stock_owner();
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
for each row execute function public.prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- notifications / device_tokens
-- -----------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('new_order','order_status','payment','low_stock','return','support_ticket',
                                     'announcement','refund','dispute','account','system')),
  title text not null check (length(trim(title)) between 1 and 150),
  body text not null default '' check (length(body) <= 1000),
  is_read boolean not null default false,
  reference_id uuid,
  reference_type text check (reference_type is null or reference_type in
    ('order','product','support_ticket','return','refund','announcement','store','policy')),
  created_at timestamptz not null default now(),
  constraint notifications_reference_pair_check check ((reference_type is null) = (reference_id is null))
);
comment on column public.notifications.reference_type is 'Allowlisted polymorphic type; reference_id is validated by the trusted dispatcher (DB-13).';
create index notifications_user_created_idx on public.notifications(user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications(user_id) where not is_read;

create table public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique check (length(token) between 1 and 4096),
  platform text not null check (platform in ('android','web')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index device_tokens_user_idx on public.device_tokens(user_id);

-- -----------------------------------------------------------------------------
-- audit_logs — immutable system/admin audit (DB-04, FR-SA-04)
-- -----------------------------------------------------------------------------

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null check (length(trim(action)) between 1 and 120),
  resource_type text not null check (length(trim(resource_type)) between 1 and 60),
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  ip_address inet,
  created_at timestamptz not null default now()
);
create index audit_logs_resource_idx on public.audit_logs(resource_type, resource_id, created_at);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc) where actor_id is not null;
create index audit_logs_created_idx on public.audit_logs(created_at desc);
create trigger audit_logs_append_only before update or delete on public.audit_logs
for each row execute function public.prevent_append_only_mutation();

-- -----------------------------------------------------------------------------
-- announcements (FR-SA-16/17) and policies (FR-SA-18/19, DB-12)
-- -----------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 150),
  body text not null check (length(trim(body)) between 1 and 5000),
  audience text not null check (audience in ('all','merchants','customers')),
  status text not null default 'draft' check (status in ('draft','scheduled','sent')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  sent_by uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_scheduled_check check (status <> 'scheduled' or scheduled_at is not null),
  constraint announcements_sent_check check (status <> 'sent' or (sent_at is not null and sent_by is not null))
);
create trigger announcements_set_updated_at before update on public.announcements
for each row execute function public.set_updated_at();

-- Sent announcements are immutable and cannot be deleted (FR-SA-16).
create or replace function public.guard_sent_announcement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'sent' then
    raise exception 'Sent announcements cannot be changed or deleted' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger announcements_guard_sent before update or delete on public.announcements
for each row execute function public.guard_sent_announcement();

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('tos','privacy')),
  version text not null check (length(trim(version)) between 1 and 40),
  content text not null check (length(trim(content)) between 1 and 200000),
  effective_date date not null,
  submitted_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  status text not null default 'pending_approval'
    check (status in ('draft','pending_approval','approved','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policies_type_version_uq unique (type, version),
  constraint policies_distinct_approver_check check (approved_by is null or approved_by <> submitted_by),
  constraint policies_approval_required_check
    check (status not in ('approved','published') or (approved_by is not null and approved_at is not null))
);
create unique index policies_one_published_per_type_uq on public.policies(type) where status = 'published';
create trigger policies_set_updated_at before update on public.policies
for each row execute function public.set_updated_at();

-- Submitter and approver must be Super Admins; versions are preserved (no delete);
-- content of an approved/published version cannot change.
create or replace function public.guard_policy_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Policy versions are preserved; DELETE is prohibited' using errcode = '55000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = new.submitted_by and p.role = 'super_admin') then
    raise exception 'Policy submitter must be a Super Admin' using errcode = '23514';
  end if;
  if new.approved_by is not null and not exists (
    select 1 from public.profiles p where p.id = new.approved_by and p.role = 'super_admin') then
    raise exception 'Policy approver must be a Super Admin' using errcode = '23514';
  end if;
  if new.approved_by is not null and new.approved_by = new.submitted_by then
    raise exception 'Policy submitter cannot approve their own version' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved','published','archived')
     and (new.content is distinct from old.content or new.version is distinct from old.version
          or new.type is distinct from old.type or new.effective_date is distinct from old.effective_date
          or new.submitted_by is distinct from old.submitted_by) then
    raise exception 'Approved policy versions are immutable' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger policies_guard_row before insert or update or delete on public.policies
for each row execute function public.guard_policy_row();

-- -----------------------------------------------------------------------------
-- customer_addresses — up to three, at most one default (FR-C-33)
-- -----------------------------------------------------------------------------

create table public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 40),
  recipient_name text not null check (length(trim(recipient_name)) between 1 and 100),
  phone text not null check (phone ~ '^01[3-9][0-9]{8}$'),
  address text not null check (length(trim(address)) between 1 and 300),
  district text not null check (length(trim(district)) between 1 and 60),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customer_addresses_one_default_uq on public.customer_addresses(customer_id) where is_default;
create index customer_addresses_customer_idx on public.customer_addresses(customer_id);
create trigger customer_addresses_set_updated_at before update on public.customer_addresses
for each row execute function public.set_updated_at();

create or replace function public.enforce_customer_address_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Serialize concurrent inserts for the same customer before counting.
  perform pg_advisory_xact_lock(hashtextextended('customer_addresses:' || new.customer_id::text, 0));
  if (select count(*) from public.customer_addresses where customer_id = new.customer_id) >= 3 then
    raise exception 'A customer can save at most three addresses' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger customer_addresses_limit before insert on public.customer_addresses
for each row execute function public.enforce_customer_address_limit();
