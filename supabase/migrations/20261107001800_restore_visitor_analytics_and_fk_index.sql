-- =============================================================================
-- Migration 018 — restore visitor analytics while excluding academic test orders,
-- and add the missing index for the test_marked_by foreign key.
--
-- This is a corrective migration after 017. Do not edit an already-applied
-- migration; apply this as a new migration instead.
-- =============================================================================

-- Cover the referencing side of orders.test_marked_by -> profiles.id.
create index if not exists orders_test_marked_by_fk_idx
  on public.orders (test_marked_by);

-- Preserve the visitor metrics introduced in migration 011 while filtering
-- academic test orders out of order/revenue metrics.
create or replace function private.dashboard_payload(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select *
    from public.orders
    where is_test = false
      and (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from
      and created_at < p_to
  ),
  prev as (
    select *
    from public.orders
    where is_test = false
      and (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from - (p_to - p_from)
      and created_at < p_from
  ),
  v as (
    select *
    from public.storefront_visits
    where (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from
      and created_at < p_to
  ),
  vprev as (
    select *
    from public.storefront_visits
    where (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from - (p_to - p_from)
      and created_at < p_from
  ),
  order_days as (
    select
      (created_at at time zone 'Asia/Dhaka')::date as d,
      count(*) filter (where status <> 'cancelled') as n,
      coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0) as r,
      count(*) filter (where status = 'cancelled') as c
    from o
    group by 1
  ),
  visit_days as (
    select
      (created_at at time zone 'Asia/Dhaka')::date as d,
      count(distinct (store_id, session_hash)) as u
    from v
    group by 1
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'revenue', coalesce((select sum(total_amount) from o where status <> 'cancelled'), 0),
    'orders', (select count(*) from o where status <> 'cancelled'),
    'previous_revenue', coalesce((select sum(total_amount) from prev where status <> 'cancelled'), 0),
    'previous_orders', (select count(*) from prev where status <> 'cancelled'),
    'cancelled', jsonb_build_object(
      'orders', (select count(*) from o where status = 'cancelled'),
      'value', coalesce((select sum(total_amount) from o where status = 'cancelled'), 0)
    ),
    'customers', (
      select count(distinct coalesce(customer_id::text, 'guest:' || order_phone))
      from o
    ),
    'orders_by_status', coalesce((
      select jsonb_object_agg(status, n)
      from (select status, count(*) as n from o group by status) s
    ), '{}'::jsonb),
    'payment_methods', coalesce((
      select jsonb_agg(jsonb_build_object('method', payment_method, 'orders', n, 'revenue', r))
      from (
        select payment_method, count(*) as n, sum(total_amount) as r
        from o
        where status <> 'cancelled'
        group by payment_method
      ) pm
    ), '[]'::jsonb),
    'series', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'date', coalesce(od.d, vd.d),
          'orders', coalesce(od.n, 0),
          'revenue', coalesce(od.r, 0),
          'cancelled', coalesce(od.c, 0),
          'visitors', coalesce(vd.u, 0)
        )
        order by coalesce(od.d, vd.d)
      )
      from order_days od
      full join visit_days vd on vd.d = od.d
    ), '[]'::jsonb),
    'top_products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'product_id', product_id,
          'name', name,
          'units_sold', u,
          'revenue', r
        )
        order by r desc
      )
      from (
        select
          i.product_id,
          max(i.product_name) as name,
          sum(i.quantity) as u,
          sum(i.subtotal) as r
        from public.order_items i
        join o on o.id = i.order_id
        where o.status <> 'cancelled'
        group by i.product_id
        order by 4 desc
        limit 5
      ) t
    ), '[]'::jsonb),
    'visitors', (select count(distinct (store_id, session_hash)) from v),
    'previous_visitors', (select count(distinct (store_id, session_hash)) from vprev),
    'popular_pages', coalesce((
      select jsonb_agg(jsonb_build_object('path', path, 'views', n) order by n desc, path)
      from (
        select path, count(*) as n
        from v
        group by path
        order by 2 desc, 1
        limit 10
      ) pp
    ), '[]'::jsonb),
    'visitors_available', true
  );
$$;

comment on function private.dashboard_payload(uuid, timestamptz, timestamptz) is
  'Shared merchant/admin dashboard payload. Excludes academic test orders from business metrics while retaining privacy-preserving storefront visitor analytics.';
