-- =============================================================================
-- Migration 007 — trusted commerce workflows.
--
-- Two kinds of entry points:
--   * Merchant self-service catalogue/store operations: SECURITY DEFINER functions
--     callable by `authenticated`; the actor is always auth.uid(), never a parameter.
--   * Money/stock/order-state operations (orders, payments, COD, inventory):
--     callable by `service_role` only, invoked by Edge Functions after JWT, role,
--     ownership and input validation. They take p_actor_id from the verified JWT
--     and re-check role/ownership themselves (defence in depth).
--
-- Error contract (mapped to HTTP by supabase/functions/_shared/errors.ts):
--   42501 forbidden · P0002 not found · 22023 invalid input · 23505 conflict/duplicate
--   23514 business rule violated · BQ001 insufficient stock · BQ002 price changed
--   BQ003 store/product unavailable · BQ004 rate limited · BQ005 payment method unavailable
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internal helpers
-- -----------------------------------------------------------------------------

create or replace function private.audit(
  p_actor_id uuid, p_action text, p_resource_type text, p_resource_id uuid,
  p_metadata jsonb default '{}'::jsonb, p_ip inet default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata, ip_address)
  values (p_actor_id, p_action, p_resource_type, p_resource_id, jsonb_strip_nulls(coalesce(p_metadata, '{}'::jsonb)),
          coalesce(p_ip, private.request_ip()));
$$;

-- Trusted notification dispatcher (DB-13): validates the polymorphic reference.
create or replace function private.notify(
  p_user_id uuid, p_type text, p_title text, p_body text,
  p_reference_type text default null, p_reference_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_exists boolean;
begin
  if p_user_id is null then
    return null;
  end if;
  if p_reference_type is not null then
    v_exists := case p_reference_type
      when 'order' then exists (select 1 from public.orders where id = p_reference_id)
      when 'product' then exists (select 1 from public.products where id = p_reference_id)
      when 'support_ticket' then exists (select 1 from public.support_tickets where id = p_reference_id)
      when 'return' then exists (select 1 from public.returns where id = p_reference_id)
      when 'refund' then exists (select 1 from public.refunds where id = p_reference_id)
      when 'announcement' then exists (select 1 from public.announcements where id = p_reference_id)
      when 'store' then exists (select 1 from public.stores where id = p_reference_id)
      when 'policy' then exists (select 1 from public.policies where id = p_reference_id)
      else false end;
    if not v_exists then
      raise exception 'Notification reference % % does not exist', p_reference_type, p_reference_id using errcode = '23503';
    end if;
  end if;
  insert into public.notifications (user_id, type, title, body, reference_type, reference_id)
  values (p_user_id, p_type, left(p_title, 150), left(coalesce(p_body, ''), 1000), p_reference_type, p_reference_id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.notify_super_admins(
  p_type text, p_title text, p_body text, p_reference_type text default null, p_reference_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  for v_admin in select id from public.profiles where role = 'super_admin' and status = 'active' loop
    perform private.notify(v_admin, p_type, p_title, p_body, p_reference_type, p_reference_id);
  end loop;
end;
$$;

-- Active merchant actor that owns a store; returns that store.
create or replace function private.require_merchant_store(p_actor_id uuid)
returns public.stores
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  select s.* into v_store
  from public.stores s join public.profiles p on p.id = s.owner_id
  where s.owner_id = p_actor_id and p.role = 'merchant' and p.status = 'active';
  if not found then
    raise exception 'Only an active merchant with a store can do this' using errcode = '42501';
  end if;
  return v_store;
end;
$$;

create or replace function private.require_super_admin(p_actor_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and role = 'super_admin' and status = 'active') then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
end;
$$;

create or replace function private.normalize_bd_phone(p_phone text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v ~ '^\+?8801[3-9][0-9]{8}$' then '0' || right(v, 10)
    else v end
  from (select regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g') as v) x;
$$;

-- The single path for every stock change: locks the stock row, refuses to go below
-- zero, writes the matching inventory_movements row and raises low-stock alerts.
create or replace function private.apply_stock_delta(
  p_product_id uuid, p_variant_id uuid, p_delta integer, p_reason text, p_actor_id uuid,
  p_reference_type text default null, p_reference_id uuid default null,
  p_note text default null, p_idempotency_key text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_old integer;
  v_new integer;
  v_label text;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  if v_product.product_type = 'simple' then
    if p_variant_id is not null then
      raise exception 'Simple products have no variants' using errcode = '23514';
    end if;
    v_old := v_product.stock_quantity;
    v_new := v_old + p_delta;
    if v_new < 0 then
      raise exception 'Only % of % left in stock', v_old, v_product.name using errcode = 'BQ001';
    end if;
    update public.products set stock_quantity = v_new where id = p_product_id;
  else
    if p_variant_id is null then
      raise exception 'Variant products need the exact variant' using errcode = '23514';
    end if;
    select stock_quantity, variant_label into v_old, v_label
    from public.product_variants where id = p_variant_id and product_id = p_product_id for update;
    if not found then
      raise exception 'Variant not found' using errcode = 'P0002';
    end if;
    v_new := v_old + p_delta;
    if v_new < 0 then
      raise exception 'Only % of % (%) left in stock', v_old, v_product.name, v_label using errcode = 'BQ001';
    end if;
    update public.product_variants set stock_quantity = v_new where id = p_variant_id;
  end if;

  insert into public.inventory_movements
    (store_id, product_id, variant_id, quantity_delta, reason, actor_id, reference_type, reference_id, note, idempotency_key)
  values
    (v_product.store_id, p_product_id, p_variant_id, p_delta, p_reason, p_actor_id, p_reference_type, p_reference_id,
     p_note, p_idempotency_key);

  -- FR-M-21: alert when stock crosses the threshold downwards.
  if p_delta < 0 and v_old > v_product.low_stock_threshold and v_new <= v_product.low_stock_threshold then
    perform private.notify(
      (select owner_id from public.stores where id = v_product.store_id),
      'low_stock',
      case when v_new = 0 then 'Out of stock' else 'Low stock' end,
      v_product.name || coalesce(' (' || v_label || ')', '') || ': ' || v_new || ' left',
      'product', p_product_id);
  end if;
  return v_new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Store onboarding and settings (merchant self-service; actor = auth.uid())
-- -----------------------------------------------------------------------------

create or replace function public.check_subdomain(p_subdomain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub text := lower(trim(coalesce(p_subdomain, '')));
  v_reserved text[] := array['admin','api','www','app','mail','help','support','static'];
  v_owner uuid;
  v_suggestions text[] := '{}'::text[];
  v_base text;
  i integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to check a subdomain' using errcode = '42501';
  end if;
  if length(v_sub) not between 3 and 63 or v_sub !~ '^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$' then
    return jsonb_build_object('subdomain', v_sub, 'available', false, 'reason', 'invalid', 'suggestions', '[]'::jsonb,
      'message', 'Use 3–63 lowercase letters, numbers or hyphens; start and end with a letter or number.');
  end if;
  if v_sub = any(v_reserved) then
    return jsonb_build_object('subdomain', v_sub, 'available', false, 'reason', 'reserved', 'suggestions', '[]'::jsonb,
      'message', v_sub || ' is reserved by BazarHQ. Choose another name.');
  end if;
  select owner_id into v_owner from public.stores where subdomain = v_sub;
  if v_owner = (select auth.uid()) then
    return jsonb_build_object('subdomain', v_sub, 'available', true, 'reason', 'own', 'suggestions', '[]'::jsonb,
      'message', 'This is your store''s subdomain.');
  end if;
  if v_owner is null then
    return jsonb_build_object('subdomain', v_sub, 'available', true, 'reason', 'ok', 'suggestions', '[]'::jsonb,
      'message', v_sub || '.bazarhq.com is available.');
  end if;
  v_base := left(regexp_replace(v_sub, '-?[0-9]+$', ''), 58);
  i := 1;
  while array_length(v_suggestions, 1) is distinct from 3 and i < 50 loop
    if not exists (select 1 from public.stores where subdomain = v_base || i) then
      v_suggestions := v_suggestions || (v_base || i);
    end if;
    i := i + 1;
  end loop;
  return jsonb_build_object('subdomain', v_sub, 'available', false, 'reason', 'taken', 'suggestions', to_jsonb(v_suggestions),
    'message', v_sub || '.bazarhq.com is already taken.');
end;
$$;

create or replace function public.create_store(p_name text, p_subdomain text, p_category text default null, p_tagline text default null)
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_check jsonb;
  v_store public.stores%rowtype;
begin
  if not exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'merchant' and status = 'active') then
    raise exception 'Only an active merchant can create a store' using errcode = '42501';
  end if;
  if exists (select 1 from public.stores where owner_id = (select auth.uid())) then
    raise exception 'Each merchant account can have one store in this version' using errcode = '23505';
  end if;
  v_check := public.check_subdomain(p_subdomain);
  if not (v_check ->> 'available')::boolean then
    raise exception '%', v_check ->> 'message' using errcode = case when v_check ->> 'reason' = 'taken' then '23505' else '23514' end;
  end if;
  insert into public.stores (owner_id, name, subdomain, status, category, tagline)
  values ((select auth.uid()), trim(p_name), v_check ->> 'subdomain', 'draft', p_category, nullif(trim(p_tagline), ''))
  returning * into v_store;
  perform private.audit((select auth.uid()), 'store.created', 'store', v_store.id, jsonb_build_object('subdomain', v_store.subdomain));
  return v_store;
end;
$$;

-- FR-M-11 checklist: subdomain, logo, payment method, first product.
create or replace function public.get_onboarding_progress()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_steps jsonb;
  v_done integer;
begin
  select * into v_store from public.stores where owner_id = (select auth.uid());
  v_steps := jsonb_build_array(
    jsonb_build_object('key', 'subdomain', 'done', v_store.id is not null),
    jsonb_build_object('key', 'logo', 'done', v_store.logo_url is not null),
    jsonb_build_object('key', 'payment_method', 'done',
      exists (select 1 from public.payment_configs where store_id = v_store.id and is_enabled)),
    jsonb_build_object('key', 'first_product', 'done',
      exists (select 1 from public.products where store_id = v_store.id and deleted_at is null and status = 'active'))
  );
  select count(*) into v_done from jsonb_array_elements(v_steps) e where (e ->> 'done')::boolean;
  return jsonb_build_object('steps', v_steps, 'percent', v_done * 25, 'publishable', v_done = 4 and v_store.status = 'draft');
end;
$$;

create or replace function public.publish_store()
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
  v_progress jsonb := public.get_onboarding_progress();
begin
  if v_store.status = 'published' then
    return v_store;
  end if;
  if v_store.status = 'suspended' then
    raise exception 'A suspended store cannot be published' using errcode = '42501';
  end if;
  if not exists (select 1 from public.payment_configs where store_id = v_store.id and is_enabled) then
    raise exception 'Enable at least one payment method before publishing' using errcode = '23514'; -- FR-M-35
  end if;
  if (v_progress ->> 'percent')::int < 100 then
    raise exception 'Finish the setup checklist before publishing' using errcode = '23514'; -- FR-M-11
  end if;
  update public.stores set status = 'published', published_at = coalesce(published_at, now())
  where id = v_store.id returning * into v_store;
  perform private.audit((select auth.uid()), 'store.published', 'store', v_store.id);
  return v_store;
end;
$$;

create or replace function public.unpublish_store()
returns public.stores
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  if v_store.status = 'published' then
    update public.stores set status = 'draft' where id = v_store.id returning * into v_store;
    perform private.audit((select auth.uid()), 'store.unpublished', 'store', v_store.id);
  end if;
  return v_store;
end;
$$;

-- -----------------------------------------------------------------------------
-- Payment configuration (FR-M-32..35, DB-05)
-- -----------------------------------------------------------------------------

-- Safe projection: never returns credentials_encrypted.
create or replace function public.get_payment_configs()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  return (
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'store_id', v_store.id, 'method', m.method,
      'is_enabled', coalesce(c.is_enabled, false),
      'has_credentials', c.credentials_encrypted is not null,
      'credential_hint', c.credential_hint,
      'environment', coalesce(c.environment, 'sandbox'),
      'validation', case when m.method = 'cod' then 'not_required' else coalesce(c.validation_status, 'unverified') end,
      'updated_at', c.updated_at) order by m.ord)
    from (values ('cod', 1), ('bkash', 2), ('nagad', 3), ('rocket', 4), ('sslcommerz', 5)) m(method, ord)
    left join public.payment_configs c on c.store_id = v_store.id and c.method = m.method
  );
end;
$$;

create or replace function public.set_payment_method_enabled(p_method text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
  v_config public.payment_configs%rowtype;
begin
  if p_method is null or p_method not in ('bkash','nagad','rocket','sslcommerz','cod') then
    raise exception 'Unknown payment method' using errcode = '22023';
  end if;
  select * into v_config from public.payment_configs where store_id = v_store.id and method = p_method for update;
  if p_enabled and p_method <> 'cod'
     and (v_config.credentials_encrypted is null or v_config.validation_status = 'invalid') then
    raise exception 'Add and verify your % credentials before enabling it', p_method using errcode = '23514';
  end if;
  if not p_enabled and v_store.status = 'published' and coalesce(v_config.is_enabled, false)
     and not exists (select 1 from public.payment_configs where store_id = v_store.id and is_enabled and method <> p_method) then
    raise exception 'A published store needs at least one payment method' using errcode = '23514';
  end if;
  insert into public.payment_configs (store_id, method, is_enabled, validation_status)
  values (v_store.id, p_method, p_enabled, case when p_method = 'cod' then 'not_required' else 'unverified' end)
  on conflict (store_id, method) do update set is_enabled = excluded.is_enabled;
  perform private.audit((select auth.uid()), case when p_enabled then 'payment_config.enabled' else 'payment_config.disabled' end,
                        'store', v_store.id, jsonb_build_object('method', p_method));
  return (select e from jsonb_array_elements(public.get_payment_configs()) e where e ->> 'method' = p_method);
end;
$$;

-- Vault-held key for credential encryption (DB-05). Never returned to clients.
create or replace function private.payment_credentials_key()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'payment_credentials_key';
  if v_key is null or length(v_key) < 32 then
    raise exception 'Payment credential encryption key is not configured in Vault' using errcode = '55000';
  end if;
  return v_key;
end;
$$;

-- Edge Function payment-config: validated, formatted credentials in; ciphertext stored.
create or replace function public.store_payment_credentials(
  p_actor_id uuid, p_method text, p_credentials jsonb, p_hint text, p_environment text, p_validation_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store(p_actor_id);
begin
  if p_method not in ('bkash','nagad','rocket','sslcommerz') then
    raise exception 'Credentials are not used for this method' using errcode = '22023';
  end if;
  if p_credentials is null or jsonb_typeof(p_credentials) <> 'object' then
    raise exception 'Credentials must be an object' using errcode = '22023';
  end if;
  if p_validation_status not in ('valid','invalid','unverified') or p_environment not in ('sandbox','live') then
    raise exception 'Invalid credential metadata' using errcode = '22023';
  end if;
  insert into public.payment_configs (store_id, method, is_enabled, credentials_encrypted, credential_hint, environment, validation_status)
  values (v_store.id, p_method, false,
          extensions.pgp_sym_encrypt(p_credentials::text, private.payment_credentials_key(), 'cipher-algo=aes256'),
          right(coalesce(p_hint, ''), 4), p_environment, p_validation_status)
  on conflict (store_id, method) do update
    set credentials_encrypted = excluded.credentials_encrypted,
        credential_hint = excluded.credential_hint,
        environment = excluded.environment,
        validation_status = excluded.validation_status,
        -- FR-M-34: invalid credentials disable the method.
        is_enabled = case when excluded.validation_status = 'invalid' then false else public.payment_configs.is_enabled end;
  perform private.audit(p_actor_id, 'payment_config.credentials_updated', 'store', v_store.id,
    jsonb_build_object('method', p_method, 'validation', p_validation_status, 'environment', p_environment));
  return (select jsonb_build_object('method', c.method, 'is_enabled', c.is_enabled, 'has_credentials', true,
            'credential_hint', c.credential_hint, 'environment', c.environment, 'validation', c.validation_status,
            'updated_at', c.updated_at)
          from public.payment_configs c where c.store_id = v_store.id and c.method = p_method);
end;
$$;

-- For provider verification / gateway sessions inside Edge Functions only.
create or replace function public.get_payment_credentials(p_store_id uuid, p_method text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cipher bytea;
  v_env text;
begin
  select credentials_encrypted, environment into v_cipher, v_env
  from public.payment_configs where store_id = p_store_id and method = p_method;
  if v_cipher is null then
    return null;
  end if;
  return jsonb_build_object(
    'environment', v_env,
    'values', extensions.pgp_sym_decrypt(v_cipher, private.payment_credentials_key())::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Product catalogue (API-12/13/14, FR-M-15..21) — merchant self-service
-- -----------------------------------------------------------------------------

create or replace function private.validate_product_fields(p_store_id uuid, p_input jsonb)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_input ->> 'name', ''))) not between 2 and 150 then
    raise exception 'Product name must be 2–150 characters' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_input ->> 'description', ''))) not between 1 and 5000 then
    raise exception 'Description is required (up to 5000 characters)' using errcode = '22023';
  end if;
  if (p_input ->> 'category_id') is null
     or not exists (select 1 from public.categories where id = (p_input ->> 'category_id')::uuid and store_id = p_store_id) then
    raise exception 'Choose a category from your store' using errcode = '22023';
  end if;
  if coalesce((p_input ->> 'base_price')::numeric, 0) <= 0 then
    raise exception 'Base price must be greater than zero' using errcode = '22023';
  end if;
  if coalesce(p_input ->> 'status', 'draft') not in ('draft','active','inactive') then
    raise exception 'Unknown product status' using errcode = '22023';
  end if;
  if (p_input ->> 'compare_at_price') is not null
     and (p_input ->> 'compare_at_price')::numeric <= (p_input ->> 'base_price')::numeric then
    raise exception 'Original price must be higher than the base price' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_product(p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_store public.stores%rowtype := private.require_merchant_store(v_actor);
  v_type text := p_input ->> 'product_type';
  v_product_id uuid;
  v_variant jsonb;
  v_variant_id uuid;
  v_qty integer;
begin
  perform private.validate_product_fields(v_store.id, p_input);
  if v_type not in ('simple','variant') then
    raise exception 'Choose simple or variant product' using errcode = '22023';
  end if;
  if v_type = 'simple' then
    v_qty := (p_input ->> 'stock_quantity')::int;
    if v_qty is null or v_qty < 0 then
      raise exception 'Opening stock is required for a simple product' using errcode = '22023';
    end if;
    if coalesce(jsonb_array_length(p_input -> 'variants'), 0) > 0 then
      raise exception 'Simple products cannot have variants' using errcode = '22023';
    end if;
  else
    if jsonb_typeof(p_input -> 'variants') <> 'array' or jsonb_array_length(p_input -> 'variants') not between 1 and 50 then
      raise exception 'Add 1–50 variants' using errcode = '22023';
    end if;
  end if;

  insert into public.products (store_id, name, description, category_id, base_price, product_type, stock_quantity,
                               low_stock_threshold, status, sku, compare_at_price)
  values (v_store.id, trim(p_input ->> 'name'), trim(p_input ->> 'description'), (p_input ->> 'category_id')::uuid,
          (p_input ->> 'base_price')::numeric, v_type, case when v_type = 'simple' then 0 end,
          coalesce((p_input ->> 'low_stock_threshold')::int, 5), coalesce(p_input ->> 'status', 'draft'),
          nullif(trim(p_input ->> 'sku'), ''), (p_input ->> 'compare_at_price')::numeric)
  returning id into v_product_id;

  if v_type = 'simple' then
    if v_qty > 0 then
      perform private.apply_stock_delta(v_product_id, null, v_qty, 'manual_adjustment', v_actor, null, null, 'Opening stock');
    end if;
  else
    for v_variant in select * from jsonb_array_elements(p_input -> 'variants') loop
      v_qty := coalesce((v_variant ->> 'stock_quantity')::int, -1);
      if v_qty < 0 then
        raise exception 'Every variant needs opening stock (0 or more)' using errcode = '22023';
      end if;
      insert into public.product_variants (product_id, variant_label, price_adjustment, stock_quantity, status)
      values (v_product_id, trim(v_variant ->> 'variant_label'), coalesce((v_variant ->> 'price_adjustment')::numeric, 0), 0,
              coalesce(v_variant ->> 'status', 'active'))
      returning id into v_variant_id;
      if v_qty > 0 then
        perform private.apply_stock_delta(v_product_id, v_variant_id, v_qty, 'manual_adjustment', v_actor, null, null, 'Opening stock');
      end if;
    end loop;
  end if;
  return v_product_id;
exception
  when unique_violation then
    raise exception 'A product with this SKU or variant name already exists' using errcode = '23505';
end;
$$;

-- Updates non-stock fields. Stock changes go through inventory adjustments; the
-- simple/variant model cannot be switched here (duplicate the product instead).
create or replace function public.update_product(p_product_id uuid, p_input jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_store public.stores%rowtype := private.require_merchant_store(v_actor);
  v_product public.products%rowtype;
  v_variant jsonb;
  v_variant_id uuid;
  v_keep uuid[] := '{}'::uuid[];
  v_qty integer;
begin
  select * into v_product from public.products where id = p_product_id and store_id = v_store.id and deleted_at is null for update;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  perform private.validate_product_fields(v_store.id, p_input);
  if coalesce(p_input ->> 'product_type', v_product.product_type) <> v_product.product_type then
    raise exception 'A product cannot switch between simple and variant. Duplicate it and set up the new type.' using errcode = '23514';
  end if;

  update public.products set
    name = trim(p_input ->> 'name'),
    description = trim(p_input ->> 'description'),
    category_id = (p_input ->> 'category_id')::uuid,
    base_price = (p_input ->> 'base_price')::numeric,
    low_stock_threshold = coalesce((p_input ->> 'low_stock_threshold')::int, low_stock_threshold),
    status = coalesce(p_input ->> 'status', status),
    sku = nullif(trim(p_input ->> 'sku'), ''),
    compare_at_price = (p_input ->> 'compare_at_price')::numeric
  where id = p_product_id;

  if v_product.product_type = 'variant' and jsonb_typeof(p_input -> 'variants') = 'array' then
    if jsonb_array_length(p_input -> 'variants') not between 1 and 50 then
      raise exception 'Keep 1–50 variants' using errcode = '22023';
    end if;
    for v_variant in select * from jsonb_array_elements(p_input -> 'variants') loop
      if (v_variant ->> 'id') is not null then
        update public.product_variants
        set variant_label = trim(v_variant ->> 'variant_label'),
            price_adjustment = coalesce((v_variant ->> 'price_adjustment')::numeric, 0),
            status = coalesce(v_variant ->> 'status', 'active')
        where id = (v_variant ->> 'id')::uuid and product_id = p_product_id
        returning id into v_variant_id;
        if v_variant_id is null then
          raise exception 'Variant not found on this product' using errcode = 'P0002';
        end if;
      else
        v_qty := coalesce((v_variant ->> 'stock_quantity')::int, 0);
        if v_qty < 0 then
          raise exception 'Opening stock cannot be negative' using errcode = '22023';
        end if;
        insert into public.product_variants (product_id, variant_label, price_adjustment, stock_quantity, status)
        values (p_product_id, trim(v_variant ->> 'variant_label'), coalesce((v_variant ->> 'price_adjustment')::numeric, 0), 0,
                coalesce(v_variant ->> 'status', 'active'))
        returning id into v_variant_id;
        if v_qty > 0 then
          perform private.apply_stock_delta(p_product_id, v_variant_id, v_qty, 'manual_adjustment', v_actor, null, null, 'Opening stock');
        end if;
      end if;
      v_keep := v_keep || v_variant_id;
      v_variant_id := null;
    end loop;
    -- Variants left out are deactivated, never deleted (order history may reference them).
    update public.product_variants set status = 'inactive'
    where product_id = p_product_id and not (id = any(v_keep)) and status <> 'inactive';
  end if;

  if exists (select 1 from public.product_variants v join public.products p on p.id = v.product_id
             where v.product_id = p_product_id and p.base_price + v.price_adjustment <= 0) then
    raise exception 'Every variant price (base price + adjustment) must stay above zero' using errcode = '23514';
  end if;
  return p_product_id;
exception
  when unique_violation then
    raise exception 'A product with this SKU or variant name already exists' using errcode = '23505';
end;
$$;

create or replace function public.set_product_status(p_product_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  if p_status not in ('draft','active','inactive') then
    raise exception 'Unknown product status' using errcode = '22023';
  end if;
  update public.products set status = p_status
  where id = p_product_id and store_id = v_store.id and deleted_at is null;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  return p_product_id;
end;
$$;

-- API-14 soft delete: hidden everywhere, history preserved, SKU freed.
create or replace function public.delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  update public.products set deleted_at = now(), status = 'inactive'
  where id = p_product_id and store_id = v_store.id and deleted_at is null;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  perform private.audit((select auth.uid()), 'product.deleted', 'product', p_product_id);
end;
$$;

-- FR-M-19: copy as a Draft with stock 0; SKU kept unique as <SKU>-COPY[-n].
-- Image binaries are copied by the client/Storage API (path contract needs the new product id).
create or replace function public.duplicate_product(p_product_id uuid, p_options jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
  v_src public.products%rowtype;
  v_name text;
  v_sku text;
  v_candidate text;
  n integer := 1;
  v_new_id uuid;
begin
  select * into v_src from public.products where id = p_product_id and store_id = v_store.id and deleted_at is null;
  if not found then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  v_name := coalesce(nullif(trim(p_options ->> 'name'), ''), left(v_src.name, 143) || ' (Copy)');
  if length(v_name) not between 2 and 150 then
    raise exception 'Name must be 2–150 characters' using errcode = '22023';
  end if;
  if coalesce((p_options ->> 'copy_sku')::boolean, true) and v_src.sku is not null then
    v_candidate := left(v_src.sku, 55) || '-COPY';
    while exists (select 1 from public.products where store_id = v_store.id and lower(sku) = lower(v_candidate) and deleted_at is null) loop
      n := n + 1;
      v_candidate := left(v_src.sku, 55) || '-COPY-' || n;
    end loop;
    v_sku := v_candidate;
  end if;

  insert into public.products (store_id, name, description, category_id, base_price, product_type, stock_quantity,
                               low_stock_threshold, status, sku, compare_at_price)
  values (v_store.id, v_name, v_src.description, v_src.category_id, v_src.base_price, v_src.product_type,
          case when v_src.product_type = 'simple' then 0 end, v_src.low_stock_threshold, 'draft', v_sku,
          case when coalesce((p_options ->> 'include_pricing')::boolean, true) then v_src.compare_at_price end)
  returning id into v_new_id;

  insert into public.product_variants (product_id, variant_label, price_adjustment, stock_quantity, status)
  select v_new_id, variant_label, price_adjustment, 0, status
  from public.product_variants where product_id = p_product_id;
  return v_new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Inventory (FR-M-22-INV) — Edge Function adjust-inventory
-- -----------------------------------------------------------------------------

create or replace function public.adjust_inventory(
  p_actor_id uuid, p_product_id uuid, p_variant_id uuid, p_delta integer, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store(p_actor_id);
  v_existing public.inventory_movements%rowtype;
  v_new integer;
begin
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'Adjustment must be a non-zero whole number up to 100000' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_note, ''))) not between 3 and 500 then
    raise exception 'Add a note (3–500 characters) explaining the adjustment' using errcode = '22023';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;
  select * into v_existing from public.inventory_movements where store_id = v_store.id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.product_id <> p_product_id or v_existing.variant_id is distinct from p_variant_id or v_existing.quantity_delta <> p_delta then
      raise exception 'Idempotency key was already used for a different adjustment' using errcode = '23505';
    end if;
    return jsonb_build_object('movement_id', v_existing.id, 'replayed', true,
      'stock_quantity', coalesce((select stock_quantity from public.product_variants where id = p_variant_id),
                                 (select stock_quantity from public.products where id = p_product_id)));
  end if;
  if not exists (select 1 from public.products where id = p_product_id and store_id = v_store.id and deleted_at is null) then
    raise exception 'Product not found' using errcode = 'P0002';
  end if;
  v_new := private.apply_stock_delta(p_product_id, p_variant_id, p_delta, 'manual_adjustment', p_actor_id,
                                      null, null, trim(p_note), p_idempotency_key);
  return jsonb_build_object('stock_quantity', v_new, 'replayed', false,
    'movement_id', (select id from public.inventory_movements where store_id = v_store.id and idempotency_key = p_idempotency_key));
end;
$$;

-- -----------------------------------------------------------------------------
-- Storefront (public): store resolution, discovery, cart validation
-- -----------------------------------------------------------------------------

-- FR-C-02: one "unavailable" answer for nonexistent, unpublished and suspended stores.
create or replace function public.resolve_store(p_subdomain text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
begin
  select s.* into v_store from public.stores s join public.profiles p on p.id = s.owner_id
  where s.subdomain = lower(trim(p_subdomain)) and s.status = 'published' and p.status = 'active';
  if not found then
    raise exception 'Store unavailable' using errcode = 'BQ003';
  end if;
  return jsonb_build_object(
    'id', v_store.id, 'name', v_store.name, 'subdomain', v_store.subdomain, 'tagline', v_store.tagline,
    'logo_url', v_store.logo_url, 'banner_url', v_store.banner_url, 'brand_colour', v_store.brand_colour,
    'theme_id', v_store.theme_id, 'theme_name', (select name from public.themes where id = v_store.theme_id),
    'category', v_store.category, 'return_window_days', v_store.return_window_days,
    'shipping', v_store.shipping_settings,
    'enabled_payment_methods', coalesce((select jsonb_agg(method order by method) from public.payment_configs
                                         where store_id = v_store.id and is_enabled), '[]'::jsonb));
end;
$$;

-- API-25: stores only, never an aggregated product catalogue.
create or replace function public.search_stores(p_query text default null, p_limit integer default 20)
returns table (id uuid, name text, subdomain text, tagline text, logo_url text, brand_colour text, category text, product_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with q as (
    select lower(trim(regexp_replace(coalesce(p_query, ''), '^(https?://)?([a-z0-9-]+)\.bazarhq\.com.*$', '\2', 'i'))) as term
  )
  select s.id, s.name, s.subdomain, s.tagline, s.logo_url, s.brand_colour, s.category,
         (select count(*) from public.products p where p.store_id = s.id and p.status = 'active' and p.deleted_at is null)
  from public.stores s
  join public.profiles o on o.id = s.owner_id and o.status = 'active'
  cross join q
  where s.status = 'published'
    and (q.term = ''
         or s.subdomain = q.term
         or s.subdomain like q.term || '%'
         or to_tsvector('simple', s.name) @@ plainto_tsquery('simple', q.term)
         or s.name ilike '%' || replace(replace(q.term, '%', ''), '_', '') || '%')
  order by (s.subdomain = q.term) desc, s.name
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- FR-C-09/12: current price and stock per cart line (never trusts client prices).
create or replace function public.validate_cart(p_store_id uuid, p_items jsonb, p_district text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_price numeric(12,2);
  v_stock integer;
  v_available boolean;
  v_qty integer;
  v_subtotal numeric(12,2) := 0;
  v_charge numeric(12,2);
  v_changes boolean := false;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
begin
  select * into v_store from public.stores where id = p_store_id and status = 'published';
  if not found then
    raise exception 'Store unavailable' using errcode = 'BQ003';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'Invalid cart' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_items) loop
    v_variant := null;
    select * into v_product from public.products
    where id = (v_line ->> 'product_id')::uuid and store_id = p_store_id and status = 'active' and deleted_at is null;
    v_available := found;
    if v_available and v_product.product_type = 'variant' then
      select * into v_variant from public.product_variants
      where id = nullif(v_line ->> 'variant_id', '')::uuid and product_id = v_product.id and status = 'active';
      v_available := found;
    end if;
    v_price := case when v_available then v_product.base_price + coalesce(v_variant.price_adjustment, 0) else 0 end;
    v_stock := case when not v_available then 0
                    when v_product.product_type = 'simple' then v_product.stock_quantity
                    else v_variant.stock_quantity end;
    v_qty := least(greatest(coalesce((v_line ->> 'quantity')::int, 1), 1), greatest(v_stock, 0));
    v_available := v_available and v_stock > 0;
    if v_available then
      v_subtotal := v_subtotal + v_price * v_qty;
    end if;
    v_changes := v_changes or not v_available
      or v_qty <> coalesce((v_line ->> 'quantity')::int, 1)
      or ((v_line ->> 'unit_price') is not null and (v_line ->> 'unit_price')::numeric <> v_price);
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_line ->> 'product_id', 'variant_id', v_line ->> 'variant_id',
      'available', v_available, 'available_stock', greatest(v_stock, 0), 'current_unit_price', v_price,
      'price_changed', (v_line ->> 'unit_price') is not null and (v_line ->> 'unit_price')::numeric <> v_price,
      'quantity_capped', v_qty < coalesce((v_line ->> 'quantity')::int, 1), 'quantity', v_qty);
  end loop;
  v_charge := case when p_district is null then 0
                   when lower(trim(p_district)) = 'dhaka' then (v_store.shipping_settings ->> 'inside_dhaka_charge')::numeric
                   else (v_store.shipping_settings ->> 'outside_dhaka_charge')::numeric end;
  return jsonb_build_object('lines', v_lines, 'subtotal', v_subtotal, 'delivery_charge', v_charge,
                            'total', v_subtotal + v_charge, 'has_changes', v_changes);
end;
$$;

-- -----------------------------------------------------------------------------
-- Orders (API-07..10, DB-02/03, FR-C-21) — Edge Functions only
-- -----------------------------------------------------------------------------

create or replace function private.order_result(p_order_id uuid, p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'replayed', p_replayed,
    'order', to_jsonb(o) - 'idempotency_key' - 'request_fingerprint',
    'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at, i.id) from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'payment', (select jsonb_build_object('id', t.id, 'order_id', t.order_id, 'method', t.method, 'provider', t.provider,
                        'status', t.status, 'amount', t.amount, 'currency', t.currency,
                        'provider_reference_masked', case when t.provider_transaction_reference is null then null
                          else '••••' || right(t.provider_transaction_reference, 4) end,
                        'created_at', t.created_at, 'verified_at', t.verified_at)
                from public.payment_transactions t where t.order_id = o.id order by t.created_at desc limit 1),
    'next_action', case
      when o.payment_method = 'cod' then 'none'
      when o.payment_status in ('paid','pending_verification') then 'none'
      when o.payment_method = 'sslcommerz' then 'redirect_sslcommerz'
      else 'submit_wallet_reference' end)
  from public.orders o where o.id = p_order_id;
$$;

create or replace function public.create_order(
  p_actor_id uuid,
  p_store_id uuid,
  p_items jsonb,
  p_delivery jsonb,
  p_payment_method text,
  p_idempotency_key text,
  p_save_address boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype;
  v_config public.payment_configs%rowtype;
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_item record;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_unit numeric(12,2);
  v_stock integer;
  v_subtotal numeric(12,2) := 0;
  v_charge numeric(12,2);
  v_name text := trim(coalesce(p_delivery ->> 'recipient_name', ''));
  v_phone text := private.normalize_bd_phone(p_delivery ->> 'phone');
  v_email text := nullif(lower(trim(coalesce(p_delivery ->> 'email', ''))), '');
  v_address text := trim(coalesce(p_delivery ->> 'address', ''));
  v_district text := trim(coalesce(p_delivery ->> 'district', ''));
  v_postal text := nullif(trim(coalesce(p_delivery ->> 'postal_code', '')), '');
  v_fingerprint text;
  v_address_count integer;
begin
  -- 1. Input
  if p_idempotency_key is null or length(trim(p_idempotency_key)) not between 8 and 200 then
    raise exception 'A valid idempotency key is required' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'An order needs 1–50 cart lines' using errcode = '22023';
  end if;
  if p_payment_method is null or p_payment_method not in ('bkash','nagad','rocket','sslcommerz','cod') then
    raise exception 'Unknown payment method' using errcode = '22023';
  end if;
  if length(v_name) not between 2 and 100 then
    raise exception 'Enter the recipient''s full name' using errcode = '22023';
  end if;
  if v_phone !~ '^01[3-9][0-9]{8}$' then
    raise exception 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX)' using errcode = '22023';
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid email address' using errcode = '22023';
  end if;
  if length(v_address) not between 5 and 300 or length(v_district) not between 2 and 60 then
    raise exception 'Enter the delivery address and district' using errcode = '22023';
  end if;
  if v_postal is not null and v_postal !~ '^[0-9]{4}$' then
    raise exception 'Postal code must be 4 digits' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e
             where coalesce((e ->> 'quantity')::int, 0) not between 1 and 1000 or (e ->> 'product_id') is null) then
    raise exception 'Each line needs a product and a quantity of 1–1000' using errcode = '22023';
  end if;

  v_fingerprint := md5(concat_ws('|', p_store_id, p_payment_method, v_phone, v_address, v_district,
    (select string_agg(concat_ws(':', e ->> 'product_id', coalesce(e ->> 'variant_id', ''), e ->> 'quantity'), ','
                       order by e ->> 'product_id', coalesce(e ->> 'variant_id', ''))
     from jsonb_array_elements(p_items) e)));

  -- 2. Idempotent replay (no duplicate orders, no duplicate attempts)
  select * into v_existing from public.orders where store_id = p_store_id and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint or v_existing.customer_id is distinct from p_actor_id then
      raise exception 'Idempotency key was already used for a different order' using errcode = '23505';
    end if;
    return private.order_result(v_existing.id, true);
  end if;

  -- 3. Customer (guest when p_actor_id is null)
  if p_actor_id is not null and not exists (
    select 1 from public.profiles where id = p_actor_id and role = 'customer' and status = 'active') then
    raise exception 'Only customer accounts can place orders' using errcode = '42501';
  end if;

  -- 4. Store and payment method
  select s.* into v_store from public.stores s join public.profiles o on o.id = s.owner_id
  where s.id = p_store_id and s.status = 'published' and o.status = 'active'
  for share of s;
  if not found then
    raise exception 'This store is not available' using errcode = 'BQ003';
  end if;
  select * into v_config from public.payment_configs where store_id = p_store_id and method = p_payment_method and is_enabled;
  if not found then
    raise exception 'This payment method is not available for this store' using errcode = 'BQ005';
  end if;

  -- 5–7. Validate visibility/availability/price and lock stock rows in a fixed order (no deadlocks, no oversell)
  for v_item in
    select (e ->> 'product_id')::uuid as product_id,
           nullif(e ->> 'variant_id', '')::uuid as variant_id,
           sum((e ->> 'quantity')::int)::int as quantity,
           max((e ->> 'expected_unit_price')::numeric) as expected_unit_price
    from jsonb_array_elements(p_items) e
    group by 1, 2
    order by 1, 2 nulls first
  loop
    select * into v_product from public.products where id = v_item.product_id for update;
    if not found or v_product.store_id <> p_store_id or v_product.status <> 'active' or v_product.deleted_at is not null then
      raise exception 'A product in your cart is no longer available' using errcode = 'BQ003';
    end if;
    if v_item.quantity > 1000 then
      raise exception 'Quantity for % is too large', v_product.name using errcode = '22023';
    end if;
    if v_product.product_type = 'variant' then
      select * into v_variant from public.product_variants
      where id = v_item.variant_id and product_id = v_product.id for update;
      if not found or v_variant.status <> 'active' then
        raise exception 'The selected option of % is no longer available', v_product.name using errcode = 'BQ003';
      end if;
      v_unit := v_product.base_price + v_variant.price_adjustment;
      v_stock := v_variant.stock_quantity;
    else
      if v_item.variant_id is not null then
        raise exception '% has no options to choose from', v_product.name using errcode = '22023';
      end if;
      v_variant := null;
      v_unit := v_product.base_price;
      v_stock := v_product.stock_quantity;
    end if;
    if v_item.expected_unit_price is not null and v_item.expected_unit_price <> v_unit then
      raise exception 'The price of % changed to %. Please review your cart.', v_product.name, v_unit using errcode = 'BQ002';
    end if;
    if v_stock < v_item.quantity then
      raise exception 'Only % of % left in stock', v_stock, v_product.name using errcode = 'BQ001';
    end if;
    v_subtotal := v_subtotal + v_unit * v_item.quantity;
    v_lines := v_lines || jsonb_build_object(
      'product_id', v_product.id, 'variant_id', v_item.variant_id, 'quantity', v_item.quantity, 'unit_price', v_unit,
      'product_name', v_product.name, 'variant_label', v_variant.variant_label);
  end loop;

  v_charge := case when lower(v_district) = 'dhaka' then (v_store.shipping_settings ->> 'inside_dhaka_charge')::numeric
                   else (v_store.shipping_settings ->> 'outside_dhaka_charge')::numeric end;

  -- 8. Order
  insert into public.orders (store_id, customer_id, order_phone, order_email, status, total_amount, subtotal, delivery_charge,
                             payment_method, payment_status, delivery_address, idempotency_key, request_fingerprint)
  values (p_store_id, p_actor_id, v_phone, v_email, 'pending', v_subtotal + v_charge, v_subtotal, v_charge,
          p_payment_method, case when p_payment_method = 'cod' then 'cod_pending' else 'pending' end,
          jsonb_build_object('recipient_name', v_name, 'phone', v_phone, 'address', v_address,
                             'district', v_district, 'postal_code', v_postal),
          p_idempotency_key, v_fingerprint)
  returning * into v_order;

  -- 9 + 7 + 12. Items, stock decrement and ledger rows
  for v_line in select * from jsonb_array_elements(v_lines) loop
    insert into public.order_items (order_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, subtotal)
    values (v_order.id, (v_line ->> 'product_id')::uuid, (v_line ->> 'variant_id')::uuid, v_line ->> 'product_name',
            v_line ->> 'variant_label', (v_line ->> 'quantity')::int, (v_line ->> 'unit_price')::numeric,
            (v_line ->> 'unit_price')::numeric * (v_line ->> 'quantity')::int);
    perform private.apply_stock_delta((v_line ->> 'product_id')::uuid, (v_line ->> 'variant_id')::uuid,
                                      -((v_line ->> 'quantity')::int), 'sale', p_actor_id, 'order', v_order.id);
  end loop;

  insert into public.delivery_events (order_id, actor_id, event_type, previous_status, notes)
  values (v_order.id, p_actor_id, 'pending', null, 'Order placed');

  -- 10–11. Initial payment attempt (Option B functions; idempotent per order)
  perform public.create_payment_attempt(
    v_order.id, v_config.id, p_payment_method, p_payment_method, v_order.total_amount,
    'checkout:' || p_idempotency_key, jsonb_build_object('source', 'checkout'), p_actor_id);

  -- Optional saved address (FR-C-33: max 3; silently skipped when full)
  if p_save_address and p_actor_id is not null then
    select count(*) into v_address_count from public.customer_addresses where customer_id = p_actor_id;
    if v_address_count < 3 and not exists (
      select 1 from public.customer_addresses where customer_id = p_actor_id
        and lower(address) = lower(v_address) and lower(district) = lower(v_district)) then
      insert into public.customer_addresses (customer_id, label, recipient_name, phone, address, district, postal_code, is_default)
      values (p_actor_id, case when v_address_count = 0 then 'Home' else 'Address ' || (v_address_count + 1) end,
              v_name, v_phone, v_address, v_district, v_postal, v_address_count = 0);
    end if;
  end if;

  -- Notifications (FR-M-24)
  perform private.notify(v_store.owner_id, 'new_order', 'New order ' || v_order.order_number,
    v_name || ' · ' || v_order.total_amount || ' BDT · ' || upper(p_payment_method), 'order', v_order.id);
  perform private.notify(p_actor_id, 'order_status', 'Order placed',
    v_order.order_number || ' was sent to ' || v_store.name || '.', 'order', v_order.id);

  -- 13. Safe result
  return private.order_result(v_order.id, false);
end;
$$;

-- §13.1 canonical transitions by the owning Merchant (DM-01, DM-06, FR-M-26..31).
create or replace function public.transition_order_status(
  p_actor_id uuid, p_order_id uuid, p_to_status text,
  p_note text default null, p_reason text default null, p_proof_path text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_allowed text[];
  v_release_reason text;
begin
  if p_to_status is null or p_to_status not in ('confirmed','processing','shipped','out_for_delivery','delivered','cancelled') then
    raise exception 'Unsupported order status' using errcode = '22023';
  end if;
  if exists (select 1 from public.profiles where id = p_actor_id and role = 'super_admin') then
    raise exception 'Super Admin cannot change ordinary merchant order or delivery status' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores s join public.profiles p on p.id = s.owner_id
                 where s.id = v_order.store_id and s.owner_id = p_actor_id and p.role = 'merchant' and p.status = 'active') then
    raise exception 'Only the merchant who owns this order can change its status' using errcode = '42501';
  end if;

  -- Same-state request: idempotent, no new event.
  if v_order.status = p_to_status then
    return private.order_result(v_order.id, true);
  end if;

  v_allowed := case v_order.status
    when 'pending' then array['confirmed','cancelled']
    when 'confirmed' then array['processing','cancelled']
    when 'processing' then array['shipped','cancelled']
    when 'shipped' then array['out_for_delivery','cancelled']
    when 'out_for_delivery' then array['delivered']
    else array[]::text[] end;
  if not (p_to_status = any(v_allowed)) then
    if p_to_status = 'cancelled' then
      raise exception 'Orders that are out for delivery or delivered cannot be cancelled' using errcode = '23514';
    end if;
    raise exception 'An order cannot move from % to %', v_order.status, p_to_status using errcode = '23514';
  end if;

  if p_to_status = 'confirmed' and v_order.payment_status not in ('paid','cod_pending') then
    raise exception '%', case v_order.payment_status
      when 'pending_verification' then 'Payment is still awaiting server-side verification'
      when 'failed' then 'The payment for this order failed'
      else 'Payment has not been completed yet' end using errcode = '23514';
  end if;
  if p_to_status = 'cancelled' and length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'Give the customer a reason for cancelling (3–500 characters)' using errcode = '22023';
  end if;
  if p_proof_path is not null and p_proof_path not like 'orders/' || v_order.id || '/delivery/%' then
    raise exception 'Delivery proof must be stored under orders/{order_id}/delivery/' using errcode = '22023';
  end if;

  update public.orders
  set status = p_to_status,
      cancellation_reason = case when p_to_status = 'cancelled' then trim(p_reason) else cancellation_reason end,
      delivered_at = case when p_to_status = 'delivered' then now() else delivered_at end
  where id = v_order.id;

  -- Stock release happens exactly once per order (FR-M-31, §13.1).
  if p_to_status = 'cancelled' and v_order.stock_released_at is null then
    v_release_reason := case when v_order.payment_status = 'failed' then 'payment_failure_release' else 'cancellation_release' end;
    for v_item in select * from public.order_items where order_id = v_order.id order by product_id, variant_id nulls first loop
      perform private.apply_stock_delta(v_item.product_id, v_item.variant_id, v_item.quantity, v_release_reason,
                                        p_actor_id, 'order', v_order.id);
    end loop;
    update public.orders set stock_released_at = now() where id = v_order.id;
  end if;

  insert into public.delivery_events (order_id, actor_id, event_type, previous_status, notes, proof_image_path)
  values (v_order.id, p_actor_id, p_to_status, v_order.status,
          left(nullif(trim(coalesce(case when p_to_status = 'cancelled' then p_reason else p_note end, '')), ''), 1000),
          p_proof_path);

  perform private.notify(v_order.customer_id, 'order_status',
    case p_to_status
      when 'confirmed' then 'Order confirmed' when 'processing' then 'Order is being prepared'
      when 'shipped' then 'Order shipped' when 'out_for_delivery' then 'Out for delivery'
      when 'delivered' then 'Order delivered' else 'Order cancelled' end,
    v_order.order_number || case when p_to_status = 'cancelled' then ': ' || trim(p_reason) else '' end,
    'order', v_order.id);

  return private.order_result(v_order.id, false);
end;
$$;

-- DM-05: COD collection only after cash is actually collected.
create or replace function public.record_cod_collection(p_actor_id uuid, p_order_id uuid, p_amount numeric, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_attempt_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.stores s join public.profiles p on p.id = s.owner_id
                 where s.id = v_order.store_id and s.owner_id = p_actor_id and p.role = 'merchant' and p.status = 'active') then
    raise exception 'Only the merchant who owns this order can record COD collection' using errcode = '42501';
  end if;
  if v_order.payment_method <> 'cod' then
    raise exception 'This is not a Cash on Delivery order' using errcode = '23514';
  end if;
  if v_order.payment_status = 'cod_collected' then
    return private.order_result(v_order.id, true);
  end if;
  if v_order.payment_status <> 'cod_pending' or v_order.status not in ('out_for_delivery','delivered') then
    raise exception 'Record COD collection once the order is out for delivery or delivered' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <> v_order.total_amount then
    raise exception 'Collected amount must equal the order total (%)', v_order.total_amount using errcode = '23514';
  end if;

  insert into public.delivery_events (order_id, actor_id, event_type, previous_status, notes, cod_amount)
  values (v_order.id, p_actor_id, 'cod_collected', v_order.status, left(nullif(trim(coalesce(p_note, '')), ''), 1000), p_amount);
  update public.orders set payment_status = 'cod_collected' where id = v_order.id;

  select id into v_attempt_id from public.payment_transactions
  where order_id = v_order.id and status in ('pending','pending_verification') order by created_at desc limit 1;
  if v_attempt_id is not null then
    perform public.record_payment_transaction_state(v_attempt_id, 'paid', null, 'manual_review', p_actor_id,
                                                    'Cash collected on delivery');
  end if;
  perform private.audit(p_actor_id, 'order.payment_status_changed', 'order', v_order.id,
    jsonb_build_object('previous_status', 'cod_pending', 'new_status', 'cod_collected', 'source', 'cod_collection',
                       'amount', p_amount));
  return private.order_result(v_order.id, false);
end;
$$;

-- FR-C-16: customer submits a bKash/Nagad/Rocket transaction ID. This never marks
-- the order paid; it records pending_verification for provider/manual verification.
create or replace function public.submit_wallet_reference(
  p_order_id uuid, p_reference text, p_actor_id uuid default null, p_phone text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_transactions%rowtype;
  v_ref text := upper(trim(coalesce(p_reference, '')));
  v_config_id uuid;
begin
  if v_ref !~ '^[A-Z0-9]{6,40}$' then
    raise exception 'Enter the transaction ID exactly as shown in your wallet app' using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  -- Same answer for "no such order" and "not your order" (no enumeration).
  if not found
     or (v_order.customer_id is not null and v_order.customer_id is distinct from p_actor_id)
     or (v_order.customer_id is null and (p_actor_id is not null or private.normalize_bd_phone(p_phone) <> v_order.order_phone)) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.payment_method not in ('bkash','nagad','rocket') then
    raise exception 'This order is not paid by mobile wallet' using errcode = '23514';
  end if;
  if v_order.status <> 'pending' then
    raise exception 'This order can no longer take a payment' using errcode = '23514';
  end if;
  if v_order.payment_status = 'paid' then
    return private.order_result(v_order.id, true);
  end if;
  if v_order.payment_status = 'pending_verification' then
    if exists (select 1 from public.payment_transactions where order_id = v_order.id
               and status = 'pending_verification' and provider_transaction_reference = v_ref) then
      return private.order_result(v_order.id, true);
    end if;
    raise exception 'A transaction ID for this order is already awaiting verification' using errcode = '23514';
  end if;

  select * into v_attempt from public.payment_transactions
  where order_id = v_order.id and status = 'pending' order by created_at desc limit 1;
  if not found then
    -- Retry after a definitive failure: a new attempt (Option B allows it while payment_status = failed).
    select id into v_config_id from public.payment_configs where store_id = v_order.store_id and method = v_order.payment_method;
    v_attempt := public.create_payment_attempt(v_order.id, v_config_id, v_order.payment_method, v_order.payment_method,
      v_order.total_amount, 'wallet:' || v_ref, jsonb_build_object('source', 'wallet_reference_retry'), p_actor_id);
  end if;

  begin
    v_attempt := public.record_payment_transaction_state(v_attempt.id, 'pending_verification', v_ref, 'provider_verification', null, null);
  exception when unique_violation then
    raise exception 'This transaction ID has already been used' using errcode = '23505';
  end;
  update public.orders set payment_status = 'pending_verification' where id = v_order.id;
  perform private.audit(p_actor_id, 'order.payment_status_changed', 'order', v_order.id,
    jsonb_build_object('previous_status', v_order.payment_status, 'new_status', 'pending_verification',
                       'source', 'wallet_reference_submitted', 'payment_transaction_id', v_attempt.id));
  perform private.notify((select owner_id from public.stores where id = v_order.store_id), 'payment',
    'Payment awaiting verification', v_order.order_number || ': ' || upper(v_order.payment_method) || ' reference submitted.',
    'order', v_order.id);
  return private.order_result(v_order.id, false);
end;
$$;

-- API-20/21/43: apply a verified result to the attempt AND the order in one transaction.
-- Sources: provider_verification (provider API), sslcommerz_webhook (signed IPN), manual_review (owner/Super Admin).
create or replace function public.apply_payment_result(
  p_transaction_id uuid, p_result text, p_source text,
  p_provider_reference text default null, p_actor_id uuid default null, p_reason text default null,
  p_verified_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.payment_transactions%rowtype;
  v_order public.orders%rowtype;
  v_new_status text;
begin
  if p_result not in ('paid','failed') then
    raise exception 'Result must be paid or failed' using errcode = '22023';
  end if;
  select * into v_attempt from public.payment_transactions where id = p_transaction_id;
  if not found then
    raise exception 'Payment transaction not found' using errcode = 'P0002';
  end if;
  select * into v_order from public.orders where id = v_attempt.order_id for update;
  if v_order.payment_method = 'cod' then
    raise exception 'COD payments are settled by recording COD collection' using errcode = '23514';
  end if;
  if p_source = 'manual_review' and v_order.payment_status <> 'pending_verification' and v_attempt.status <> p_result then
    raise exception 'Manual review is only for payments awaiting verification' using errcode = '23514';
  end if;
  if p_verified_amount is not null and p_verified_amount <> v_attempt.amount then
    raise exception 'Verified amount does not match the order total' using errcode = '23514';
  end if;

  v_attempt := public.record_payment_transaction_state(p_transaction_id, p_result, p_provider_reference, p_source, p_actor_id, p_reason);

  v_new_status := case
    when p_result = 'paid' and v_order.payment_status in ('pending','pending_verification','failed') then 'paid'
    when p_result = 'failed' and v_order.payment_status in ('pending','pending_verification')
         and not exists (select 1 from public.payment_transactions where order_id = v_order.id and status = 'paid') then 'failed'
    else v_order.payment_status end;

  if v_new_status <> v_order.payment_status then
    update public.orders set payment_status = v_new_status where id = v_order.id;
    perform private.audit(p_actor_id, 'order.payment_status_changed', 'order', v_order.id,
      jsonb_build_object('previous_status', v_order.payment_status, 'new_status', v_new_status, 'source', p_source,
                         'payment_transaction_id', p_transaction_id,
                         'reason', case when p_source = 'manual_review' then left(trim(p_reason), 500) end));
    perform private.notify(v_order.customer_id, 'payment',
      case when v_new_status = 'paid' then 'Payment confirmed' else 'Payment failed' end,
      v_order.order_number || case when v_new_status = 'paid' then ' is paid.' else ': the payment could not be verified. You can try again.' end,
      'order', v_order.id);
    perform private.notify((select owner_id from public.stores where id = v_order.store_id), 'payment',
      case when v_new_status = 'paid' then 'Payment verified' else 'Payment failed' end,
      v_order.order_number || ' · ' || upper(v_order.payment_method), 'order', v_order.id);
  end if;
  return private.order_result(v_order.id, v_new_status = v_order.payment_status);
end;
$$;

-- FR-C-17: reuse or create the SSLCommerz attempt; the Edge Function opens the gateway session.
create or replace function public.prepare_sslcommerz_payment(
  p_order_id uuid, p_actor_id uuid, p_phone text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_transactions%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found
     or (v_order.customer_id is not null and v_order.customer_id is distinct from p_actor_id)
     or (v_order.customer_id is null and (p_actor_id is not null or private.normalize_bd_phone(p_phone) <> v_order.order_phone)) then
    raise exception 'Order not found' using errcode = 'P0002';
  end if;
  if v_order.payment_method <> 'sslcommerz' or v_order.status <> 'pending' or v_order.payment_status not in ('pending','failed') then
    raise exception 'This order cannot start a card payment' using errcode = '23514';
  end if;
  select * into v_attempt from public.payment_transactions
  where order_id = v_order.id and status = 'pending' order by created_at desc limit 1;
  if not found then
    v_attempt := public.create_payment_attempt(v_order.id,
      (select id from public.payment_configs where store_id = v_order.store_id and method = 'sslcommerz'),
      'sslcommerz', 'sslcommerz', v_order.total_amount, 'ssl:' || p_idempotency_key,
      jsonb_build_object('source', 'sslcommerz_session'), p_actor_id);
  end if;
  return jsonb_build_object(
    'transaction_id', v_attempt.id, 'amount', v_attempt.amount, 'currency', v_attempt.currency,
    'order_id', v_order.id, 'order_number', v_order.order_number, 'store_id', v_order.store_id,
    'customer', jsonb_build_object('name', v_order.delivery_address ->> 'recipient_name', 'phone', v_order.order_phone,
                                   'email', v_order.order_email, 'address', v_order.delivery_address ->> 'address',
                                   'district', v_order.delivery_address ->> 'district'));
end;
$$;

-- API-32 public tracking: Order ID + phone; same null answer for any mismatch (FR-C-23/27/29).
create or replace function public.track_order(p_order_number text, p_phone text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_store public.stores%rowtype;
begin
  select * into v_order from public.orders
  where order_number = upper(trim(coalesce(p_order_number, ''))) and order_phone = private.normalize_bd_phone(p_phone);
  if not found then
    return null;
  end if;
  select * into v_store from public.stores where id = v_order.store_id;
  if v_order.status = 'delivered' and v_order.delivered_at < now() - interval '90 days' then
    return jsonb_build_object('archived', true, 'order_number', v_order.order_number, 'store_name', v_store.name);
  end if;
  return jsonb_build_object(
    'archived', false,
    'order_number', v_order.order_number,
    'store_name', v_store.name, 'store_subdomain', v_store.subdomain,
    'status', v_order.status, 'payment_status', v_order.payment_status, 'payment_method', v_order.payment_method,
    'items', coalesce((select jsonb_agg(jsonb_build_object('product_name', i.product_name, 'variant_label', i.variant_label,
                         'quantity', i.quantity, 'unit_price', i.unit_price, 'subtotal', i.subtotal) order by i.created_at)
                       from public.order_items i where i.order_id = v_order.id), '[]'::jsonb),
    'subtotal', v_order.subtotal, 'delivery_charge', v_order.delivery_charge, 'total_amount', v_order.total_amount,
    'delivery_address', v_order.delivery_address,
    'cancellation_reason', v_order.cancellation_reason,
    'events', coalesce((select jsonb_agg(jsonb_build_object('event_type', e.event_type, 'created_at', e.created_at) order by e.created_at)
                        from public.delivery_events e where e.order_id = v_order.id), '[]'::jsonb),
    'merchant_contact', jsonb_build_object(
      'phone', (select phone from public.profiles where id = v_store.owner_id),
      'email', (select email from auth.users where id = v_store.owner_id)),
    'created_at', v_order.created_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Re-grant the RLS helpers (policies run as the caller).
grant execute on function
  public.is_super_admin(), public.owns_store(uuid), public.owns_product(uuid), public.owns_order(uuid),
  public.can_read_order(uuid), public.can_read_return(uuid), public.can_access_ticket(uuid),
  public.current_user_id(), public.current_active_app_role(), public.current_store_id(),
  public.is_merchant(), public.is_customer()
to anon, authenticated, service_role;
grant execute on function public.become_merchant() to authenticated;

-- Public storefront
grant execute on function public.resolve_store(text), public.search_stores(text, integer),
  public.validate_cart(uuid, jsonb, text) to anon, authenticated;

-- Merchant self-service (actor = auth.uid())
grant execute on function
  public.check_subdomain(text), public.create_store(text, text, text, text), public.get_onboarding_progress(),
  public.publish_store(), public.unpublish_store(), public.get_payment_configs(), public.set_payment_method_enabled(text, boolean),
  public.create_product(jsonb), public.update_product(uuid, jsonb), public.set_product_status(uuid, text),
  public.delete_product(uuid), public.duplicate_product(uuid, jsonb)
to authenticated;

-- Trusted server operations (Edge Functions with the service-role key)
grant execute on function
  public.store_payment_credentials(uuid, text, jsonb, text, text, text), public.get_payment_credentials(uuid, text),
  public.adjust_inventory(uuid, uuid, uuid, integer, text, text),
  public.create_order(uuid, uuid, jsonb, jsonb, text, text, boolean),
  public.transition_order_status(uuid, uuid, text, text, text, text),
  public.record_cod_collection(uuid, uuid, numeric, text),
  public.submit_wallet_reference(uuid, text, uuid, text),
  public.apply_payment_result(uuid, text, text, text, uuid, text, numeric),
  public.prepare_sslcommerz_payment(uuid, uuid, text, text),
  public.track_order(text, text),
  public.get_actor_context(uuid), public.admin_network_check(text)
to service_role;
