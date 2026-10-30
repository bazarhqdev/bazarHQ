-- =============================================================================
-- Migration 015 — policy effective dates use the Bangladesh business day.
--
-- Found when the end-to-end run crossed midnight in Dhaka: every business
-- date in the schema (order/return/ticket numbers, dashboards, visit days)
-- uses Asia/Dhaka explicitly, but admin_submit_policy() compared the effective
-- date with `current_date`, which follows the server's timezone. Hosted
-- Supabase databases run in UTC, so between 00:00 and 06:00 Dhaka time an
-- admin could submit a policy effective "yesterday" (Dhaka), and a server in
-- another timezone would behave differently again.
--
-- Fix: compare with (now() at time zone 'Asia/Dhaka')::date. The signature,
-- grants (service_role only, via admin-governance) and every other rule are
-- unchanged.
--
-- Additive only. Rollback: re-apply admin_submit_policy from
-- 20261023000900_admin_notifications_realtime_analytics.sql.
-- =============================================================================

create or replace function public.admin_submit_policy(p_actor_id uuid, p_type text, p_version text, p_effective_date date, p_content text, p_ip text default null)
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
  if p_effective_date is null or p_effective_date < (now() at time zone 'Asia/Dhaka')::date then
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

revoke all on function public.admin_submit_policy(uuid, text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.admin_submit_policy(uuid, text, text, date, text, text) to service_role;
