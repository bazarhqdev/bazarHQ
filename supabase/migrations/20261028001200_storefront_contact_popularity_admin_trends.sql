-- =============================================================================
-- Migration 012 — storefront contact, popularity ranking and admin trends.
--
-- Why (SRS V2.1 references), found while wiring the frontend's Supabase adapter:
--   * FR-C-25: the storefront and tracking pages show the merchant's contact,
--     limited to phone and email. resolve_store() did not return it, and
--     anonymous visitors cannot read profiles or auth.users. resolve_store()
--     now adds { contact: { phone, email } } for published stores only.
--   * FR-C-05 / storefront sort "Most popular": ranking needs units sold, but
--     anonymous visitors must not read orders. storefront_product_popularity()
--     returns only (product_id, units) for active products of a published
--     store, summed over non-cancelled orders of the last 90 days. No order,
--     customer or revenue data leaves the function.
--   * FR-SA-05/06: the Super Admin dashboard shows merchant and customer counts
--     with a change against the previous period. admin_dashboard() now also
--     returns merchants_previous and customers_previous (accounts that existed
--     before the period started). Everything else in its payload is unchanged.
--
-- Additive only: no earlier migration is edited; two existing functions are
-- replaced with CREATE OR REPLACE using the same signatures and grants.
-- Rollback: re-run the function bodies from migrations 007/009 (resolve_store,
-- admin_dashboard) and drop storefront_product_popularity (see end of file).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. resolve_store(): add the merchant's contact (phone/email only, FR-C-25).
-- -----------------------------------------------------------------------------
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
                                         where store_id = v_store.id and is_enabled), '[]'::jsonb),
    'contact', jsonb_build_object(
      'phone', (select phone from public.profiles where id = v_store.owner_id),
      'email', (select email from auth.users where id = v_store.owner_id)));
end;
$$;

comment on function public.resolve_store(text) is
  'Public store lookup by subdomain (FR-C-01/02). Unknown, unpublished and suspended stores raise the same BQ003. Merchant contact is phone/email only (FR-C-25).';

revoke all on function public.resolve_store(text) from public;
grant execute on function public.resolve_store(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 2. storefront_product_popularity(): units sold per product, nothing else.
-- -----------------------------------------------------------------------------
create or replace function public.storefront_product_popularity(p_store_id uuid)
returns table (product_id uuid, units bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select i.product_id, sum(i.quantity)::bigint as units
  from public.order_items i
  join public.orders o on o.id = i.order_id
  join public.products p on p.id = i.product_id
  join public.stores s on s.id = o.store_id
  where o.store_id = p_store_id
    and s.status = 'published'
    and o.status <> 'cancelled'
    and o.created_at >= now() - interval '90 days'
    and p.status = 'active'
    and p.deleted_at is null
  group by i.product_id
  order by units desc
  limit 500;
$$;

comment on function public.storefront_product_popularity(uuid) is
  'Storefront "Most popular" sort: units sold per active product of a published store over 90 days. Exposes no order, customer or revenue data.';

revoke all on function public.storefront_product_popularity(uuid) from public;
grant execute on function public.storefront_product_popularity(uuid) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. admin_dashboard(): previous-period merchant and customer counts.
-- -----------------------------------------------------------------------------
create or replace function public.admin_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Choose a date range of up to 400 days' using errcode = '22023';
  end if;
  return private.dashboard_payload(null, p_from, p_to) || jsonb_build_object(
    'merchants', (select count(*) from public.profiles where role = 'merchant' and status <> 'deleted'),
    'merchants_previous', (select count(*) from public.profiles where role = 'merchant' and status <> 'deleted' and created_at < p_from),
    'active_stores', (select count(*) from public.stores where status = 'published'),
    'customers_total', (select count(*) from public.profiles where role = 'customer' and status = 'active'),
    'customers_previous', (select count(*) from public.profiles where role = 'customer' and status = 'active' and created_at < p_from),
    'top_merchants', coalesce((select jsonb_agg(jsonb_build_object('store_id', s.id, 'store_name', s.name, 'orders', t.n, 'revenue', t.r) order by t.r desc)
                               from (select store_id, count(*) n, sum(total_amount) r from public.orders
                                     where created_at >= p_from and created_at < p_to and status <> 'cancelled'
                                     group by store_id order by 3 desc limit 5) t join public.stores s on s.id = t.store_id), '[]'::jsonb),
    'open_disputes', (select count(*) from public.support_tickets where dispute_status in ('open','info_requested'))
                     + (select count(*) from public.returns where dispute_status in ('open','info_requested')),
    'stalled_refunds', (select count(*) from public.refunds where status in ('initiated','processing') and updated_at < now() - interval '3 days'));
end;
$$;

revoke all on function public.admin_dashboard(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_dashboard(timestamptz, timestamptz) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Down (manual):
--   drop function if exists public.storefront_product_popularity(uuid);
--   then re-apply resolve_store from 20261023000700_commerce_workflows.sql and
--   admin_dashboard from 20261023000900_admin_notifications_realtime_analytics.sql.
-- -----------------------------------------------------------------------------
