-- =============================================================================
-- Migration 009 — Super Admin operations, notifications/device tokens, rate limits,
-- analytics views, Realtime publication, Storage additions and RLS refinements.
--
-- Privileged Super Admin writes are service-role functions behind Edge Functions
-- that verify the JWT (aal2), the allowlisted network and the actor. Each function
-- re-checks the actor is an active Super Admin and writes audit_logs with the
-- client IP the Edge Function supplies.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Rate limiting (shared by Edge Functions)
-- -----------------------------------------------------------------------------
create or replace function public.consume_rate_limit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hits integer;
begin
  if p_bucket is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Invalid rate-limit arguments' using errcode = '22023';
  end if;
  insert into private.rate_limits as r (bucket, window_started_at, hits)
  values (left(p_bucket, 300), now(), 1)
  on conflict (bucket) do update set
    hits = case when r.window_started_at < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_started_at = case when r.window_started_at < now() - make_interval(secs => p_window_seconds) then now() else r.window_started_at end
  returning hits into v_hits;
  return v_hits <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Merchant governance (FR-SA-09..13, API-23/24)
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_merchant_status(
  p_actor_id uuid, p_merchant_id uuid, p_action text, p_reason text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_store_id uuid;
begin
  perform private.require_super_admin(p_actor_id);
  select * into v_profile from public.profiles where id = p_merchant_id for update;
  if not found or v_profile.role <> 'merchant' then
    raise exception 'Merchant not found' using errcode = 'P0002';
  end if;
  select id into v_store_id from public.stores where owner_id = p_merchant_id;
  if p_action = 'suspend' then
    if length(trim(coalesce(p_reason, ''))) not between 5 and 500 then
      raise exception 'A suspension reason (5–500 characters) is required' using errcode = '22023';
    end if;
    if v_profile.status = 'suspended' then
      return jsonb_build_object('merchant_id', p_merchant_id, 'status', 'suspended', 'store_id', v_store_id, 'replayed', true);
    end if;
    if v_profile.status <> 'active' then
      raise exception 'Only an active merchant can be suspended' using errcode = '23514';
    end if;
    update public.profiles set status = 'suspended', suspension_reason = trim(p_reason) where id = p_merchant_id;
    -- FR-SA-11: unpublish the storefront; orders stay trackable.
    update public.stores set status = 'suspended' where owner_id = p_merchant_id;
    perform private.audit(p_actor_id, 'merchant.suspended', 'profile', p_merchant_id,
      jsonb_build_object('reason', trim(p_reason), 'store_id', v_store_id), p_ip::inet);
    perform private.notify(p_merchant_id, 'account', 'Your account has been suspended', trim(p_reason), 'store', v_store_id);
    return jsonb_build_object('merchant_id', p_merchant_id, 'status', 'suspended', 'store_id', v_store_id, 'replayed', false);
  elsif p_action = 'reinstate' then
    if v_profile.status = 'active' then
      return jsonb_build_object('merchant_id', p_merchant_id, 'status', 'active', 'store_id', v_store_id, 'replayed', true);
    end if;
    if v_profile.status <> 'suspended' then
      raise exception 'Only a suspended merchant can be reinstated' using errcode = '23514';
    end if;
    update public.profiles set status = 'active', suspension_reason = null where id = p_merchant_id;
    -- FR-SA-12: the store stays unpublished until the merchant republishes it.
    update public.stores set status = 'draft' where owner_id = p_merchant_id and status = 'suspended';
    perform private.audit(p_actor_id, 'merchant.reinstated', 'profile', p_merchant_id,
      jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), ''), 'store_id', v_store_id), p_ip::inet);
    perform private.notify(p_merchant_id, 'account', 'Your account has been reinstated',
      'Republish your store when you are ready.', 'store', v_store_id);
    return jsonb_build_object('merchant_id', p_merchant_id, 'status', 'active', 'store_id', v_store_id, 'replayed', false);
  end if;
  raise exception 'Action must be suspend or reinstate' using errcode = '22023';
end;
$$;

-- FR-SA-13: confirmation phrase "DELETE <merchant_email>". Account data is anonymised and
-- the store retired; transactional history is retained (§20.6). The Edge Function bans the auth user.
create or replace function public.admin_delete_merchant(p_actor_id uuid, p_merchant_id uuid, p_confirmation text, p_ip text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_store_id uuid;
begin
  perform private.require_super_admin(p_actor_id);
  if not exists (select 1 from public.profiles where id = p_merchant_id and role = 'merchant' and status <> 'deleted') then
    raise exception 'Merchant not found' using errcode = 'P0002';
  end if;
  select email into v_email from auth.users where id = p_merchant_id;
  if p_confirmation is distinct from 'DELETE ' || v_email then
    raise exception 'Type DELETE followed by the merchant''s email to confirm' using errcode = '22023';
  end if;
  select id into v_store_id from public.stores where owner_id = p_merchant_id;
  update public.stores set status = 'suspended' where owner_id = p_merchant_id;
  update public.profiles set status = 'deleted', deleted_at = now(), full_name = 'Deleted merchant', phone = null,
                             avatar_url = null, suspension_reason = null
  where id = p_merchant_id;
  delete from public.device_tokens where user_id = p_merchant_id;
  perform private.audit(p_actor_id, 'merchant.deleted', 'profile', p_merchant_id,
    jsonb_build_object('store_id', v_store_id), p_ip::inet);
end;
$$;

-- Customer self-deletion (FR-C-36): anonymise profile and saved data; orders are retained.
create or replace function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text;
begin
  select role into v_role from public.profiles where id = v_actor and status = 'active';
  if v_role is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_confirmation is distinct from 'DELETE' then
    raise exception 'Type DELETE to confirm' using errcode = '22023';
  end if;
  if v_role = 'super_admin' then
    raise exception 'Super Admin accounts are removed by the project owner' using errcode = '42501';
  end if;
  if v_role = 'merchant' then
    -- FR-M-44: the store is unpublished immediately.
    update public.stores set status = 'suspended' where owner_id = v_actor;
  end if;
  delete from public.customer_addresses where customer_id = v_actor;
  delete from public.device_tokens where user_id = v_actor;
  update public.profiles set status = 'deleted', deleted_at = now(), full_name = 'Deleted user', phone = null, avatar_url = null
  where id = v_actor;
  perform private.audit(v_actor, 'account.deleted', 'profile', v_actor, jsonb_build_object('role', v_role));
end;
$$;

-- -----------------------------------------------------------------------------
-- Themes (FR-SA-14/15)
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_theme(p_actor_id uuid, p_theme_id uuid, p_input jsonb, p_ip text default null)
returns public.themes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_theme public.themes%rowtype;
  v_store record;
  v_breaking boolean := coalesce((p_input ->> 'breaking')::boolean, false);
begin
  perform private.require_super_admin(p_actor_id);
  if length(trim(coalesce(p_input ->> 'name', ''))) not between 2 and 80 then
    raise exception 'Theme name must be 2–80 characters' using errcode = '22023';
  end if;
  if p_theme_id is null then
    insert into public.themes (name, description, preview_url, is_active, created_by, accent)
    values (trim(p_input ->> 'name'), coalesce(p_input ->> 'description', ''), p_input ->> 'preview_url',
            coalesce((p_input ->> 'is_active')::boolean, true), p_actor_id, coalesce(p_input ->> 'accent', '#059669'))
    returning * into v_theme;
    perform private.audit(p_actor_id, 'theme.created', 'theme', v_theme.id, jsonb_build_object('name', v_theme.name), p_ip::inet);
    return v_theme;
  end if;
  update public.themes set
    name = trim(p_input ->> 'name'),
    description = coalesce(p_input ->> 'description', description),
    preview_url = coalesce(p_input ->> 'preview_url', preview_url),
    is_active = coalesce((p_input ->> 'is_active')::boolean, is_active),
    accent = coalesce(p_input ->> 'accent', accent),
    -- FR-SA-15: breaking layout changes take effect no sooner than 7 days after notice.
    breaking_change_effective_at = case when v_breaking then now() + interval '7 days' else breaking_change_effective_at end
  where id = p_theme_id returning * into v_theme;
  if not found then
    raise exception 'Theme not found' using errcode = 'P0002';
  end if;
  if v_breaking then
    for v_store in select id, owner_id from public.stores where theme_id = p_theme_id loop
      perform private.notify(v_store.owner_id, 'announcement', 'Theme update in 7 days',
        v_theme.name || ' will change its layout on ' || to_char(v_theme.breaking_change_effective_at at time zone 'Asia/Dhaka', 'DD Mon YYYY') || '.',
        'store', v_store.id);
    end loop;
  end if;
  perform private.audit(p_actor_id, 'theme.updated', 'theme', p_theme_id,
    jsonb_build_object('breaking', v_breaking, 'is_active', v_theme.is_active), p_ip::inet);
  return v_theme;
end;
$$;

create or replace function public.admin_delete_theme(p_actor_id uuid, p_theme_id uuid, p_ip text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_in_use text;
begin
  perform private.require_super_admin(p_actor_id);
  select string_agg(name, ', ' order by name) into v_in_use from public.stores where theme_id = p_theme_id;
  if v_in_use is not null then
    raise exception 'This theme is in use by: %', v_in_use using errcode = '23503';
  end if;
  delete from public.themes where id = p_theme_id;
  if not found then
    raise exception 'Theme not found' using errcode = 'P0002';
  end if;
  perform private.audit(p_actor_id, 'theme.deleted', 'theme', p_theme_id, '{}'::jsonb, p_ip::inet);
end;
$$;

-- -----------------------------------------------------------------------------
-- Announcements (FR-SA-16/17)
-- -----------------------------------------------------------------------------
create or replace function private.announcement_recipients(p_audience text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.profiles
  where status = 'active'
    and ((p_audience = 'all' and role in ('merchant','customer'))
         or (p_audience = 'merchants' and role = 'merchant')
         or (p_audience = 'customers' and role = 'customer'));
$$;

create or replace function public.admin_announcement_recipient_count(p_audience text)
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
  return (select count(*) from private.announcement_recipients(p_audience));
end;
$$;

create or replace function private.send_announcement(p_announcement_id uuid, p_actor_id uuid)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements%rowtype;
  v_count integer;
begin
  select * into v_a from public.announcements where id = p_announcement_id for update;
  if v_a.status = 'sent' then
    return v_a;
  end if;
  insert into public.notifications (user_id, type, title, body, reference_type, reference_id)
  select r, 'announcement', v_a.title, left(v_a.body, 1000), 'announcement', v_a.id
  from private.announcement_recipients(v_a.audience) r;
  get diagnostics v_count = row_count;
  update public.announcements
  set status = 'sent', sent_at = now(), sent_by = coalesce(p_actor_id, v_a.created_by), recipient_count = v_count
  where id = p_announcement_id returning * into v_a;
  return v_a;
end;
$$;

create or replace function public.admin_save_announcement(p_actor_id uuid, p_announcement_id uuid, p_input jsonb, p_ip text default null)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements%rowtype;
  v_action text := coalesce(p_input ->> 'action', 'draft');
  v_scheduled timestamptz := (p_input ->> 'scheduled_at')::timestamptz;
begin
  perform private.require_super_admin(p_actor_id);
  if v_action not in ('draft','schedule','send') then
    raise exception 'Action must be draft, schedule or send' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_input ->> 'title', ''))) not between 3 and 150
     or length(trim(coalesce(p_input ->> 'body', ''))) not between 10 and 5000 then
    raise exception 'Title (3–150) and message (10–5000 characters) are required' using errcode = '22023';
  end if;
  if coalesce(p_input ->> 'audience', '') not in ('all','merchants','customers') then
    raise exception 'Choose an audience' using errcode = '22023';
  end if;
  if v_action = 'schedule' and (v_scheduled is null or v_scheduled <= now()) then
    raise exception 'Schedule a time in the future' using errcode = '22023';
  end if;
  if p_announcement_id is null then
    insert into public.announcements (title, body, audience, status, scheduled_at, created_by)
    values (trim(p_input ->> 'title'), trim(p_input ->> 'body'), p_input ->> 'audience',
            case when v_action = 'schedule' then 'scheduled' else 'draft' end,
            case when v_action = 'schedule' then v_scheduled end, p_actor_id)
    returning * into v_a;
  else
    update public.announcements set
      title = trim(p_input ->> 'title'), body = trim(p_input ->> 'body'), audience = p_input ->> 'audience',
      status = case when v_action = 'schedule' then 'scheduled' else 'draft' end,
      scheduled_at = case when v_action = 'schedule' then v_scheduled end
    where id = p_announcement_id returning * into v_a;   -- the guard trigger blocks sent rows
    if not found then
      raise exception 'Announcement not found' using errcode = 'P0002';
    end if;
  end if;
  if v_action = 'send' then
    v_a := private.send_announcement(v_a.id, p_actor_id);
  end if;
  perform private.audit(p_actor_id, 'announcement.' || case v_action when 'send' then 'sent' when 'schedule' then 'scheduled' else 'saved' end,
    'announcement', v_a.id, jsonb_build_object('audience', v_a.audience, 'recipients', v_a.recipient_count), p_ip::inet);
  return v_a;
end;
$$;

create or replace function public.admin_unschedule_announcement(p_actor_id uuid, p_announcement_id uuid, p_ip text default null)
returns public.announcements
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.announcements%rowtype;
begin
  perform private.require_super_admin(p_actor_id);
  update public.announcements set status = 'draft', scheduled_at = null
  where id = p_announcement_id and status = 'scheduled' returning * into v_a;
  if not found then
    raise exception 'Only a scheduled announcement can be moved back to draft' using errcode = '23514';
  end if;
  perform private.audit(p_actor_id, 'announcement.unscheduled', 'announcement', p_announcement_id, '{}'::jsonb, p_ip::inet);
  return v_a;
end;
$$;

create or replace function public.admin_delete_announcement(p_actor_id uuid, p_announcement_id uuid, p_ip text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_super_admin(p_actor_id);
  delete from public.announcements where id = p_announcement_id;   -- the guard trigger blocks sent rows
  if not found then
    raise exception 'Announcement not found' using errcode = 'P0002';
  end if;
  perform private.audit(p_actor_id, 'announcement.deleted', 'announcement', p_announcement_id, '{}'::jsonb, p_ip::inet);
end;
$$;

-- Run every minute (pg_cron, see docs/database/BACKEND_SETUP.md) to send scheduled announcements.
create or replace function public.dispatch_due_announcements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  n integer := 0;
begin
  for v_id in select id from public.announcements where status = 'scheduled' and scheduled_at <= now() order by scheduled_at
              for update skip locked loop
    perform private.send_announcement(v_id, null);
    perform private.audit(null, 'announcement.sent', 'announcement', v_id, jsonb_build_object('source', 'schedule'));
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- Policies with dual approval (FR-SA-18/19, DB-12)
-- -----------------------------------------------------------------------------
create or replace function public.admin_submit_policy(
  p_actor_id uuid, p_type text, p_version text, p_effective_date date, p_content text, p_ip text default null)
returns public.policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.policies%rowtype;
begin
  perform private.require_super_admin(p_actor_id);
  if p_type not in ('tos','privacy') then
    raise exception 'Policy type must be tos or privacy' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_version, ''))) not between 1 and 40 or length(trim(coalesce(p_content, ''))) < 50 then
    raise exception 'Version and policy text (at least 50 characters) are required' using errcode = '22023';
  end if;
  if p_effective_date is null or p_effective_date < current_date then
    raise exception 'The effective date cannot be in the past' using errcode = '22023';
  end if;
  insert into public.policies (type, version, content, effective_date, submitted_by, status)
  values (p_type, trim(p_version), p_content, p_effective_date, p_actor_id, 'pending_approval')
  returning * into v_policy;
  perform private.audit(p_actor_id, 'policy.submitted', 'policy', v_policy.id,
    jsonb_build_object('type', p_type, 'version', v_policy.version), p_ip::inet);
  return v_policy;
exception when unique_violation then
  raise exception 'Version % already exists for this policy', trim(p_version) using errcode = '23505';
end;
$$;

create or replace function public.admin_approve_policy(p_actor_id uuid, p_policy_id uuid, p_ip text default null)
returns public.policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.policies%rowtype;
begin
  perform private.require_super_admin(p_actor_id);
  select * into v_policy from public.policies where id = p_policy_id for update;
  if not found then
    raise exception 'Policy not found' using errcode = 'P0002';
  end if;
  if v_policy.submitted_by = p_actor_id then
    raise exception 'A second Super Admin must approve this version' using errcode = '42501';
  end if;
  if v_policy.status <> 'pending_approval' then
    raise exception 'Only a version awaiting approval can be approved' using errcode = '23514';
  end if;
  update public.policies set status = 'approved', approved_by = p_actor_id, approved_at = now()
  where id = p_policy_id returning * into v_policy;
  perform private.audit(p_actor_id, 'policy.approved', 'policy', p_policy_id,
    jsonb_build_object('type', v_policy.type, 'version', v_policy.version, 'submitted_by', v_policy.submitted_by), p_ip::inet);
  return v_policy;
end;
$$;

create or replace function public.admin_publish_policy(p_actor_id uuid, p_policy_id uuid, p_ip text default null)
returns public.policies
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.policies%rowtype;
begin
  perform private.require_super_admin(p_actor_id);
  select * into v_policy from public.policies where id = p_policy_id for update;
  if not found then
    raise exception 'Policy not found' using errcode = 'P0002';
  end if;
  if v_policy.status <> 'approved' or v_policy.approved_by is null or v_policy.approved_by = v_policy.submitted_by then
    raise exception 'Only a dual-approved version can be published' using errcode = '23514';
  end if;
  update public.policies set status = 'archived' where type = v_policy.type and status = 'published';
  update public.policies set status = 'published', published_at = now() where id = p_policy_id returning * into v_policy;
  perform private.audit(p_actor_id, 'policy.published', 'policy', p_policy_id,
    jsonb_build_object('type', v_policy.type, 'version', v_policy.version, 'effective_date', v_policy.effective_date), p_ip::inet);
  return v_policy;
end;
$$;

-- -----------------------------------------------------------------------------
-- Super Admin read models (read-only; is_super_admin() enforces aal2 + network)
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_merchants(p_search text default null, p_status text default 'all')
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
  return coalesce((
    select jsonb_agg(row_data order by (row_data ->> 'created_at') desc)
    from (
      select jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'phone', p.phone, 'status', p.status,
        'suspension_reason', p.suspension_reason, 'created_at', p.created_at,
        'email_verified', u.email_confirmed_at is not null,
        'store', case when s.id is null then null else jsonb_build_object('id', s.id, 'name', s.name, 'subdomain', s.subdomain,
                   'status', s.status, 'category', s.category, 'created_at', s.created_at) end,
        'product_count', (select count(*) from public.products pr where pr.store_id = s.id and pr.deleted_at is null),
        'order_count', (select count(*) from public.orders o where o.store_id = s.id),
        'revenue', coalesce((select sum(o.total_amount) from public.orders o where o.store_id = s.id and o.status <> 'cancelled'), 0)
      ) as row_data
      from public.profiles p
      join auth.users u on u.id = p.id
      left join public.stores s on s.owner_id = p.id
      where p.role = 'merchant' and p.status <> 'deleted'
        and (coalesce(p_status, 'all') = 'all'
             or (p_status = 'active' and p.status = 'active' and s.status = 'published')
             or (p_status = 'suspended' and p.status = 'suspended')
             or (p_status = 'onboarding' and p.status = 'active' and coalesce(s.status, 'draft') = 'draft'))
        and (nullif(trim(coalesce(p_search, '')), '') is null
             or p.full_name ilike '%' || trim(p_search) || '%' or u.email ilike '%' || trim(p_search) || '%'
             or s.name ilike '%' || trim(p_search) || '%' or s.subdomain ilike '%' || trim(p_search) || '%')
      limit 500
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.admin_list_customers(p_search text default null)
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
  return coalesce((
    select jsonb_agg(row_data order by (row_data ->> 'created_at') desc)
    from (
      select jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'email', u.email, 'phone', p.phone, 'status', p.status,
        'created_at', p.created_at,
        'order_count', (select count(*) from public.orders o where o.customer_id = p.id),
        'total_spent', coalesce((select sum(o.total_amount) from public.orders o where o.customer_id = p.id and o.status <> 'cancelled'), 0),
        'last_order_at', (select max(o.created_at) from public.orders o where o.customer_id = p.id),
        'addresses', (select count(*) from public.customer_addresses a where a.customer_id = p.id)
      ) as row_data
      from public.profiles p join auth.users u on u.id = p.id
      where p.role = 'customer' and p.status <> 'deleted'
        and (nullif(trim(coalesce(p_search, '')), '') is null
             or p.full_name ilike '%' || trim(p_search) || '%' or u.email ilike '%' || trim(p_search) || '%'
             or p.phone like '%' || trim(p_search) || '%')
      limit 500
    ) x), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Analytics (API-11, FR-M-36..39, FR-SA-05/06) — views run with the caller's RLS
-- -----------------------------------------------------------------------------
create or replace view public.store_daily_sales
with (security_invoker = true) as
select
  o.store_id,
  (o.created_at at time zone 'Asia/Dhaka')::date as day,
  count(*) filter (where o.status <> 'cancelled') as orders,
  coalesce(sum(o.total_amount) filter (where o.status <> 'cancelled'), 0)::numeric(14,2) as revenue,
  count(*) filter (where o.status = 'cancelled') as cancelled_orders,
  coalesce(sum(o.total_amount) filter (where o.status = 'cancelled'), 0)::numeric(14,2) as cancelled_value
from public.orders o
group by o.store_id, (o.created_at at time zone 'Asia/Dhaka')::date;
comment on view public.store_daily_sales is 'Per-store daily revenue; cancelled orders excluded from revenue (FR-M-39). security_invoker: RLS of the caller applies.';

create or replace view public.store_product_sales
with (security_invoker = true) as
select o.store_id, i.product_id, max(i.product_name) as product_name,
       sum(i.quantity)::bigint as units_sold, sum(i.subtotal)::numeric(14,2) as revenue
from public.order_items i join public.orders o on o.id = i.order_id
where o.status <> 'cancelled'
group by o.store_id, i.product_id;

revoke all on public.store_daily_sales, public.store_product_sales from anon, public;
grant select on public.store_daily_sales, public.store_product_sales to authenticated;

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
    'series', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'orders', n, 'revenue', r, 'cancelled', c) order by d)
                        from (select (created_at at time zone 'Asia/Dhaka')::date d,
                                     count(*) filter (where status <> 'cancelled') n,
                                     coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0) r,
                                     count(*) filter (where status = 'cancelled') c
                              from o group by 1) s), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(jsonb_build_object('product_id', product_id, 'name', name, 'units_sold', u, 'revenue', r) order by r desc)
                              from (select i.product_id, max(i.product_name) name, sum(i.quantity) u, sum(i.subtotal) r
                                    from public.order_items i join o on o.id = i.order_id where o.status <> 'cancelled'
                                    group by i.product_id order by 4 desc limit 5) t), '[]'::jsonb),
    'visitors_available', false);
$$;

create or replace function public.merchant_dashboard(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '400 days' then
    raise exception 'Choose a date range of up to 400 days' using errcode = '22023';
  end if;
  return private.dashboard_payload(v_store.id, p_from, p_to) || jsonb_build_object(
    'store_id', v_store.id,
    'low_stock', coalesce((
      select jsonb_agg(x order by (x ->> 'stock_quantity')::int) from (
        select jsonb_build_object('product_id', p.id, 'variant_id', null, 'name', p.name, 'stock_quantity', p.stock_quantity,
                                  'threshold', p.low_stock_threshold) x
        from public.products p
        where p.store_id = v_store.id and p.deleted_at is null and p.product_type = 'simple' and p.stock_quantity <= p.low_stock_threshold
        union all
        select jsonb_build_object('product_id', p.id, 'variant_id', v.id, 'name', p.name || ' (' || v.variant_label || ')',
                                  'stock_quantity', v.stock_quantity, 'threshold', p.low_stock_threshold)
        from public.products p join public.product_variants v on v.product_id = p.id
        where p.store_id = v_store.id and p.deleted_at is null and v.status = 'active' and v.stock_quantity <= p.low_stock_threshold
        limit 50) s), '[]'::jsonb),
    'total_products', (select count(*) from public.products where store_id = v_store.id and deleted_at is null));
end;
$$;

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
    'active_stores', (select count(*) from public.stores where status = 'published'),
    'customers_total', (select count(*) from public.profiles where role = 'customer' and status = 'active'),
    'top_merchants', coalesce((select jsonb_agg(jsonb_build_object('store_id', s.id, 'store_name', s.name, 'orders', t.n, 'revenue', t.r) order by t.r desc)
                               from (select store_id, count(*) n, sum(total_amount) r from public.orders
                                     where created_at >= p_from and created_at < p_to and status <> 'cancelled'
                                     group by store_id order by 3 desc limit 5) t join public.stores s on s.id = t.store_id), '[]'::jsonb),
    'open_disputes', (select count(*) from public.support_tickets where dispute_status in ('open','info_requested'))
                     + (select count(*) from public.returns where dispute_status in ('open','info_requested')),
    'stalled_refunds', (select count(*) from public.refunds where status in ('initiated','processing') and updated_at < now() - interval '3 days'));
end;
$$;

-- Store-scoped customer list derived from own-store orders (no profile access).
create or replace function public.merchant_customers()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_store public.stores%rowtype := private.require_merchant_store((select auth.uid()));
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', k, 'name', name, 'phone', phone, 'email', email,
      'account_type', case when k like 'guest:%' then 'guest' else 'registered' end,
      'orders_count', n, 'total_spent', spent, 'first_order_at', first_at, 'last_order_at', last_at, 'district', district)
      order by last_at desc)
    from (
      select coalesce(o.customer_id::text, 'guest:' || o.order_phone) k,
             (array_agg(o.delivery_address ->> 'recipient_name' order by o.created_at desc))[1] name,
             (array_agg(o.order_phone order by o.created_at desc))[1] phone,
             (array_agg(o.order_email order by o.created_at desc) filter (where o.order_email is not null))[1] email,
             count(*) n,
             coalesce(sum(o.total_amount) filter (where o.status <> 'cancelled'), 0) spent,
             min(o.created_at) first_at, max(o.created_at) last_at,
             (array_agg(o.delivery_address ->> 'district' order by o.created_at desc))[1] district
      from public.orders o where o.store_id = v_store.id
      group by 1
    ) c), '[]'::jsonb);
end;
$$;

-- -----------------------------------------------------------------------------
-- Notifications and device tokens (API-22/36, MOB-08, AUTH-13)
-- -----------------------------------------------------------------------------
create or replace function public.mark_all_notifications_read()
returns integer
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.notifications set is_read = true where user_id = (select auth.uid()) and not is_read returning 1
  ) select count(*)::int from u;
$$;

create or replace function public.register_device_token(p_actor_id uuid, p_token text, p_platform text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.device_tokens%rowtype;
begin
  if not exists (select 1 from public.profiles where id = p_actor_id and status = 'active') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if length(coalesce(p_token, '')) not between 20 and 4096 or p_platform not in ('android','web') then
    raise exception 'Invalid device token' using errcode = '22023';
  end if;
  -- One valid token per device/user: a token that moved to another account is reassigned.
  insert into public.device_tokens (user_id, token, platform)
  values (p_actor_id, p_token, p_platform)
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, last_seen_at = now()
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'user_id', v_row.user_id, 'platform', v_row.platform,
    'token_hint', '…' || right(v_row.token, 6), 'created_at', v_row.created_at, 'last_seen_at', v_row.last_seen_at);
end;
$$;

create or replace function public.unregister_device_token(p_actor_id uuid, p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.device_tokens where user_id = p_actor_id and token = p_token;
$$;

-- Push dispatch queue for the send-notification Edge Function (tokens never leave the server side).
create or replace function public.claim_pending_push_notifications(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with c as (
    select n.id from public.notifications n
    where n.push_dispatched_at is null and n.created_at > now() - interval '1 day'
    order by n.created_at
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ), u as (
    update public.notifications n set push_dispatched_at = now() from c where n.id = c.id
    returning n.id, n.user_id, n.type, n.title, n.body, n.reference_type, n.reference_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'type', u.type, 'title', u.title, 'body', u.body,
    'reference_type', u.reference_type, 'reference_id', u.reference_id,
    'tokens', coalesce((select jsonb_agg(t.token) from public.device_tokens t where t.user_id = u.user_id), '[]'::jsonb))), '[]'::jsonb)
  into v_rows from u;
  return v_rows;
end;
$$;

-- -----------------------------------------------------------------------------
-- Storage additions: profile pictures (FR-M-40) and store banners
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-images', 'profile-images', false, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "profile_images_objects_select_owner_admin" on storage.objects;
create policy "profile_images_objects_select_owner_admin" on storage.objects
for select to authenticated
using (bucket_id = 'profile-images'
       and ((storage.foldername(objects.name))[2] = (select auth.uid())::text or public.is_super_admin()));
drop policy if exists "profile_images_objects_insert_owner" on storage.objects;
create policy "profile_images_objects_insert_owner" on storage.objects
for insert to authenticated
with check (bucket_id = 'profile-images'
            and (storage.foldername(objects.name))[1] = 'users'
            and (storage.foldername(objects.name))[2] = (select auth.uid())::text
            and array_length(storage.foldername(objects.name), 1) = 2);
drop policy if exists "profile_images_objects_update_owner" on storage.objects;
create policy "profile_images_objects_update_owner" on storage.objects
for update to authenticated
using (bucket_id = 'profile-images' and (storage.foldername(objects.name))[2] = (select auth.uid())::text)
with check (bucket_id = 'profile-images' and (storage.foldername(objects.name))[2] = (select auth.uid())::text);
drop policy if exists "profile_images_objects_delete_owner" on storage.objects;
create policy "profile_images_objects_delete_owner" on storage.objects
for delete to authenticated
using (bucket_id = 'profile-images' and (storage.foldername(objects.name))[2] = (select auth.uid())::text);

-- Store banners share the store-logos bucket: stores/{store_uuid}/banners/{file}.
drop policy if exists "store_banners_objects_insert_owner" on storage.objects;
create policy "store_banners_objects_insert_owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'store-logos'
  and (storage.foldername(objects.name))[1] = 'stores'
  and (storage.foldername(objects.name))[3] = 'banners'
  and array_length(storage.foldername(objects.name), 1) = 3
  and exists (select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id))
);

-- -----------------------------------------------------------------------------
-- RLS refinements: soft-deleted products are never public
-- -----------------------------------------------------------------------------
drop policy if exists products_select_published on public.products;
create policy products_select_published on public.products
for select to anon, authenticated
using (status = 'active' and deleted_at is null
       and exists (select 1 from public.stores s where s.id = store_id and s.status = 'published'));

drop policy if exists product_variants_select_published on public.product_variants;
create policy product_variants_select_published on public.product_variants
for select to anon, authenticated
using (exists (select 1 from public.products p join public.stores s on s.id = p.store_id
               where p.id = product_id and p.status = 'active' and p.deleted_at is null and s.status = 'published'));

drop policy if exists product_images_select_published on public.product_images;
create policy product_images_select_published on public.product_images
for select to anon, authenticated
using (exists (select 1 from public.products p join public.stores s on s.id = p.store_id
               where p.id = product_id and p.status = 'active' and p.deleted_at is null and s.status = 'published'));

drop policy if exists "product_images_objects_select_published" on storage.objects;
create policy "product_images_objects_select_published" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.products p join public.stores s on s.id = p.store_id
    where (storage.foldername(objects.name))[1] = 'stores'
      and s.id::text = (storage.foldername(objects.name))[2]
      and (storage.foldername(objects.name))[3] = 'products'
      and p.id::text = (storage.foldername(objects.name))[4]
      and p.status = 'active' and p.deleted_at is null and s.status = 'published'
  )
);

-- -----------------------------------------------------------------------------
-- Realtime (FR-C-26, MOB-09): postgres_changes respect RLS for each subscriber.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['orders','delivery_events','notifications','support_tickets','ticket_messages','returns','refunds'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  public.is_super_admin(), public.owns_store(uuid), public.owns_product(uuid), public.owns_order(uuid),
  public.can_read_order(uuid), public.can_read_return(uuid), public.can_access_ticket(uuid),
  public.current_user_id(), public.current_active_app_role(), public.current_store_id(),
  public.is_merchant(), public.is_customer()
to anon, authenticated, service_role;
grant execute on function public.resolve_store(text), public.search_stores(text, integer),
  public.validate_cart(uuid, jsonb, text) to anon, authenticated;
grant execute on function
  public.become_merchant(), public.check_subdomain(text), public.create_store(text, text, text, text), public.get_onboarding_progress(),
  public.publish_store(), public.unpublish_store(), public.get_payment_configs(), public.set_payment_method_enabled(text, boolean),
  public.create_product(jsonb), public.update_product(uuid, jsonb), public.set_product_status(uuid, text),
  public.delete_product(uuid), public.duplicate_product(uuid, jsonb),
  public.attach_return_evidence(uuid, text), public.refund_timeline(uuid),
  public.create_support_ticket(text, text, text, text, uuid), public.reply_to_ticket(uuid, text, text),
  public.update_ticket_status(uuid, text, text), public.set_ticket_priority(uuid, text), public.reopen_ticket(uuid),
  public.escalate_ticket(uuid), public.admin_assign_ticket(uuid, uuid), public.admin_resolve_ticket_dispute(uuid, text, text),
  public.get_ticket_thread(uuid),
  public.delete_my_account(text), public.mark_all_notifications_read(),
  public.merchant_dashboard(timestamptz, timestamptz), public.merchant_customers(),
  public.admin_dashboard(timestamptz, timestamptz), public.admin_list_merchants(text, text), public.admin_list_customers(text),
  public.admin_announcement_recipient_count(text)
to authenticated;
grant execute on function
  public.consume_rate_limit(text, integer, integer),
  public.admin_set_merchant_status(uuid, uuid, text, text, text), public.admin_delete_merchant(uuid, uuid, text, text),
  public.admin_save_theme(uuid, uuid, jsonb, text), public.admin_delete_theme(uuid, uuid, text),
  public.admin_save_announcement(uuid, uuid, jsonb, text), public.admin_unschedule_announcement(uuid, uuid, text),
  public.admin_delete_announcement(uuid, uuid, text), public.dispatch_due_announcements(),
  public.admin_submit_policy(uuid, text, text, date, text, text), public.admin_approve_policy(uuid, uuid, text),
  public.admin_publish_policy(uuid, uuid, text),
  public.register_device_token(uuid, text, text), public.unregister_device_token(uuid, text),
  public.claim_pending_push_notifications(integer)
to service_role;
