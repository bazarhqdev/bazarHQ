-- =============================================================================
-- Migration 011 — storefront visit analytics, own-session management and
-- privilege hardening.
--
-- Why (SRS V2.1 references):
--   * FR-M-36/37: the merchant dashboard must show visitor counts ("unique
--     sessions"), conversion rate and popular pages. Until now no table held
--     visit data (dashboard_payload returned visitors_available = false).
--   * AUTH-06 / FR-M-43: a user can list and terminate their own active
--     sessions. auth.sessions is not exposed through the Data API, so two
--     narrow SECURITY DEFINER functions are added.
--   * FR-SA-11 / AUTH-13: suspending or deleting an account must end its
--     sessions. A trigger on profiles now deletes the user's auth sessions
--     (refresh tokens cascade), so every path (admin suspension, merchant
--     deletion, self-deletion) is covered atomically.
--   * Media columns (stores.logo_url/banner_url, profiles.avatar_url) only
--     accept Storage paths inside the owner's own folder, so a client cannot
--     point a storefront image at an arbitrary external URL.
--   * Least privilege: the two analytics views kept Supabase's default
--     INSERT/UPDATE/DELETE grants for `authenticated`. They are not updatable
--     and run as security_invoker, but the grants are revoked anyway.
--
-- Additive only: no earlier migration is edited. Functions that already
-- exist are replaced with CREATE OR REPLACE (dashboard_payload).
-- New table: storefront_visits (see docs/database/SCHEMA_CHANGES.md); it is
-- not in SRS §18.1 and needs Project Owner sign-off like the other gaps.
-- Rollback: see the "down" block at the end of this file (commented).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Analytics view privileges: SELECT only.
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.store_daily_sales, public.store_product_sales from authenticated;

-- -----------------------------------------------------------------------------
-- 2. Storefront visits (FR-M-37: "Visitor counts use unique sessions").
--    Privacy: the browser sends a random per-tab session id; only a salted
--    SHA-256 of (store_id, session id) is stored, so a visitor cannot be
--    followed across stores. No IP address, user id or user agent is kept.
-- -----------------------------------------------------------------------------
create table if not exists public.storefront_visits (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  path text not null check (path ~ '^/' and char_length(path) between 1 and 300),
  visit_date date not null default ((now() at time zone 'Asia/Dhaka')::date),
  created_at timestamptz not null default now()
);
comment on table public.storefront_visits is
  'Append-only storefront page views for merchant analytics (FR-M-36/37). Written only by record_storefront_visit(); no client table grants.';

create index if not exists storefront_visits_store_date_idx on public.storefront_visits (store_id, visit_date);
create index if not exists storefront_visits_store_created_idx on public.storefront_visits (store_id, created_at);

alter table public.storefront_visits enable row level security;
-- Deny-all for clients: no policies. Reads go through the dashboard functions.
revoke all on public.storefront_visits from anon, authenticated, public;

drop trigger if exists storefront_visits_append_only on public.storefront_visits;
create trigger storefront_visits_append_only
  before update on public.storefront_visits
  for each row execute function public.prevent_append_only_mutation();

-- Per-installation salt for session hashes (kept in private.app_settings).
insert into private.app_settings (key, value)
values ('visit_hash_salt', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

create or replace function public.record_storefront_visit(p_store_id uuid, p_path text, p_session_id text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_path text;
  v_salt text;
  v_hash text;
begin
  if p_store_id is null or p_session_id is null or p_session_id !~ '^[A-Za-z0-9-]{16,64}$' then
    raise exception 'Invalid visit' using errcode = '22023';
  end if;
  -- Only published stores are counted; the answer does not reveal whether a store exists.
  if not exists (select 1 from public.stores s where s.id = p_store_id and s.status = 'published') then
    return false;
  end if;
  -- The owner browsing their own store and Super Admins are not visitors.
  if (select auth.uid()) is not null
     and (public.owns_store(p_store_id)
          or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'super_admin')) then
    return false;
  end if;
  -- Normalise: drop query string and fragment, collapse to at most 300 characters.
  v_path := split_part(split_part(coalesce(nullif(trim(p_path), ''), '/'), '?', 1), '#', 1);
  if left(v_path, 1) <> '/' then
    v_path := '/' || v_path;
  end if;
  v_path := left(v_path, 300);

  select value into v_salt from private.app_settings where key = 'visit_hash_salt';
  v_hash := encode(extensions.digest(coalesce(v_salt, '') || ':' || p_store_id::text || ':' || p_session_id, 'sha256'), 'hex');

  -- Abuse guard: at most 300 page views per session per hour; extra views are dropped silently.
  if not public.consume_rate_limit('visit:' || v_hash, 300, 3600) then
    return false;
  end if;

  insert into public.storefront_visits (store_id, session_hash, path) values (p_store_id, v_hash, v_path);
  return true;
end;
$$;
comment on function public.record_storefront_visit(uuid, text, text) is
  'Records one storefront page view for a published store (anon allowed, rate limited, privacy-preserving hash).';
revoke all on function public.record_storefront_visit(uuid, text, text) from public;
grant execute on function public.record_storefront_visit(uuid, text, text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Dashboard payload with visitors, conversion inputs and popular pages.
--    Same keys as migration 009 plus: visitors, previous_visitors,
--    popular_pages, series[].visitors, visitors_available = true.
-- -----------------------------------------------------------------------------
create or replace function private.dashboard_payload(p_store_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select * from public.orders
    where (p_store_id is null or store_id = p_store_id) and created_at >= p_from and created_at < p_to
  ),
  prev as (
    select * from public.orders
    where (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from - (p_to - p_from) and created_at < p_from
  ),
  v as (
    select * from public.storefront_visits
    where (p_store_id is null or store_id = p_store_id) and created_at >= p_from and created_at < p_to
  ),
  vprev as (
    select * from public.storefront_visits
    where (p_store_id is null or store_id = p_store_id)
      and created_at >= p_from - (p_to - p_from) and created_at < p_from
  ),
  order_days as (
    select (created_at at time zone 'Asia/Dhaka')::date d,
           count(*) filter (where status <> 'cancelled') n,
           coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0) r,
           count(*) filter (where status = 'cancelled') c
    from o group by 1
  ),
  visit_days as (
    select (created_at at time zone 'Asia/Dhaka')::date d, count(distinct (store_id, session_hash)) u
    from v group by 1
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'revenue', coalesce((select sum(total_amount) from o where status <> 'cancelled'), 0),
    'orders', (select count(*) from o where status <> 'cancelled'),
    'previous_revenue', coalesce((select sum(total_amount) from prev where status <> 'cancelled'), 0),
    'previous_orders', (select count(*) from prev where status <> 'cancelled'),
    'cancelled', jsonb_build_object('orders', (select count(*) from o where status = 'cancelled'),
                                    'value', coalesce((select sum(total_amount) from o where status = 'cancelled'), 0)),
    'customers', (select count(distinct coalesce(customer_id::text, 'guest:' || order_phone)) from o),
    'orders_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from o group by status) s), '{}'::jsonb),
    'payment_methods', coalesce((select jsonb_agg(jsonb_build_object('method', payment_method, 'orders', n, 'revenue', r))
                                 from (select payment_method, count(*) n, sum(total_amount) r from o where status <> 'cancelled'
                                       group by payment_method) pm), '[]'::jsonb),
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'orders', coalesce(od.n, 0), 'revenue', coalesce(od.r, 0),
                                                            'cancelled', coalesce(od.c, 0), 'visitors', coalesce(vd.u, 0)) order by d)
                        from order_days od full join visit_days vd using (d)), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'units_sold', u, 'revenue', r) order by r desc)
                              from (select i.product_id, max(i.product_name) name, sum(i.quantity) u, sum(i.subtotal) r
                                    from public.order_items i join o on o.id = i.order_id where o.status <> 'cancelled'
                                    group by i.product_id order by 4 desc limit 5) t), '[]'::jsonb),
    'visitors', (select count(distinct (store_id, session_hash)) from v),
    'previous_visitors', (select count(distinct (store_id, session_hash)) from vprev),
    'popular_pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', n) order by n desc, path)
                               from (select path, count(*) n from v group by path order by 2 desc, 1 limit 10) pp), '[]'::jsonb),
    'visitors_available', true);
$$;

-- -----------------------------------------------------------------------------
-- 4. Own-session management (AUTH-06, FR-M-43) and admin session counts.
--    auth.sessions is managed by Supabase Auth; these functions only read
--    the caller's own rows or delete one of them.
-- -----------------------------------------------------------------------------
create or replace function public.list_my_sessions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_current text := (select auth.jwt()) ->> 'session_id';
begin
  if v_uid is null then
    raise exception 'Sign in to continue' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id,
             'user_agent', left(s.user_agent, 300),
             'ip', host(s.ip),
             'created_at', s.created_at,
             'last_active_at', coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at),
             'aal', s.aal,
             'current', s.id::text = v_current)
           order by coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc)
    from auth.sessions s
    where s.user_id = v_uid and (s.not_after is null or s.not_after > now())), '[]'::jsonb);
end;
$$;
comment on function public.list_my_sessions() is 'Lists the caller''s own active Supabase Auth sessions (AUTH-06, FR-M-43).';

create or replace function public.revoke_my_session(p_session_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'Sign in to continue' using errcode = '42501';
  end if;
  if p_session_id::text = (select auth.jwt()) ->> 'session_id' then
    raise exception 'Use sign out to end the current session' using errcode = '23514';
  end if;
  delete from auth.sessions where id = p_session_id and user_id = v_uid;
  if not found then
    raise exception 'Session not found' using errcode = 'P0002';
  end if;
end;
$$;
comment on function public.revoke_my_session(uuid) is
  'Ends one of the caller''s other sessions; its refresh tokens are removed with it. Issued access tokens expire on their own (JWT expiry).';

create or replace function public.admin_user_session_count(p_user_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin access is required' using errcode = '42501';
  end if;
  return (select count(*)::int from auth.sessions s
          where s.user_id = p_user_id and (s.not_after is null or s.not_after > now()));
end;
$$;

revoke all on function public.list_my_sessions(), public.revoke_my_session(uuid), public.admin_user_session_count(uuid) from public, anon;
grant execute on function public.list_my_sessions(), public.revoke_my_session(uuid), public.admin_user_session_count(uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. End sessions when an account is suspended or deleted (FR-SA-11, AUTH-13).
--    The access-token hook already refuses new tokens for these accounts;
--    deleting the sessions also kills their refresh tokens immediately.
-- -----------------------------------------------------------------------------
create or replace function private.end_sessions_on_lockout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('suspended', 'deleted') and new.status is distinct from old.status then
    delete from auth.sessions where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function private.end_sessions_on_lockout() from public, anon, authenticated;

drop trigger if exists profiles_end_sessions_on_lockout on public.profiles;
create trigger profiles_end_sessions_on_lockout
  after update of status on public.profiles
  for each row execute function private.end_sessions_on_lockout();

-- -----------------------------------------------------------------------------
-- 6. Media columns hold Storage paths of the owner's own folder, never
--    arbitrary URLs (brief: "Store only safe public or signed URLs"). The apps
--    turn paths into short-lived signed URLs. NOT VALID: enforced for every
--    new write without failing on legacy rows; validate after cleaning them.
-- -----------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stores_logo_url_storage_path_check') then
    alter table public.stores add constraint stores_logo_url_storage_path_check
      check (logo_url is null or logo_url ~ ('^stores/' || id::text || '/logos/[A-Za-z0-9._-]{1,120}$')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stores_banner_url_storage_path_check') then
    alter table public.stores add constraint stores_banner_url_storage_path_check
      check (banner_url is null or banner_url ~ ('^stores/' || id::text || '/banners/[A-Za-z0-9._-]{1,120}$')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_avatar_url_storage_path_check') then
    alter table public.profiles add constraint profiles_avatar_url_storage_path_check
      check (avatar_url is null or avatar_url ~ ('^users/' || id::text || '/[A-Za-z0-9._-]{1,120}$')) not valid;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Customer display names for tickets the caller can already access
--    (FR-SUP-05/09). Merchants cannot read profiles, but the assigned merchant
--    talks to the ticket's customer and needs their name in the inbox.
--    Returns names only, only for tickets passing can_access_ticket().
-- -----------------------------------------------------------------------------
create or replace function public.ticket_customer_names(p_ticket_ids uuid[])
returns table (ticket_id uuid, customer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, p.full_name
  from public.support_tickets t
  join public.profiles p on p.id = t.customer_id
  where t.id = any(coalesce(p_ticket_ids, '{}'::uuid[]))
    and cardinality(p_ticket_ids) <= 500
    and public.can_access_ticket(t.id);
$$;
revoke all on function public.ticket_customer_names(uuid[]) from public, anon;
grant execute on function public.ticket_customer_names(uuid[]) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Down (manual rollback, in this order):
--   alter table public.stores drop constraint stores_logo_url_storage_path_check,
--     drop constraint stores_banner_url_storage_path_check;
--   alter table public.profiles drop constraint profiles_avatar_url_storage_path_check;
--   drop function public.ticket_customer_names(uuid[]);
--   drop trigger profiles_end_sessions_on_lockout on public.profiles;
--   drop function private.end_sessions_on_lockout();
--   drop function public.admin_user_session_count(uuid), public.revoke_my_session(uuid), public.list_my_sessions();
--   -- restore private.dashboard_payload from migration 20261023000900
--   drop function public.record_storefront_visit(uuid, text, text);
--   drop table public.storefront_visits;
--   delete from private.app_settings where key = 'visit_hash_salt';
-- =============================================================================
