-- =============================================================================
-- Migration 006 — authorization helpers, Super Admin gate, Supabase Auth hooks,
-- server-side role assignment.
--
-- Helpers read the canonical profiles table (not only the JWT) so suspensions
-- and role changes take effect immediately. JWT claims (app_role) are added by
-- the custom access token hook for client routing; RLS never trusts them alone.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Request context
-- -----------------------------------------------------------------------------

-- Client IP from the trusted proxy header that PostgREST exposes in request.headers.
-- Which header/position the platform proxy sets is configured in private.app_settings.
create or replace function private.request_ip()
returns inet
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_header text;
  v_position text;
  v_raw text;
  v_parts text[];
  v_candidate text;
begin
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return null;
  end;
  if v_headers is null then
    return null;
  end if;
  select value into v_header from private.app_settings where key = 'admin_ip_header';
  select value into v_position from private.app_settings where key = 'admin_ip_header_position';
  v_raw := v_headers ->> lower(coalesce(v_header, 'x-forwarded-for'));
  if v_raw is null or length(v_raw) > 2000 then
    return null;
  end if;
  v_parts := string_to_array(replace(v_raw, ' ', ''), ',');
  v_candidate := case when coalesce(v_position, 'last') = 'first' then v_parts[1] else v_parts[array_length(v_parts, 1)] end;
  begin
    return v_candidate::inet;
  exception when others then
    return null;
  end;
end;
$$;

-- AUTH-08 / SEC-08 / SEC-11: fail closed when the allowlist is empty or the IP is unknown.
create or replace function private.admin_network_allowed(p_ip inet default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_ip, private.request_ip()) is not null
     and exists (select 1 from private.admin_ip_allowlist a where coalesce(p_ip, private.request_ip()) <<= a.cidr);
$$;

-- -----------------------------------------------------------------------------
-- Authorization helpers (names requested by the backend brief)
-- -----------------------------------------------------------------------------

create or replace function public.current_user_id()
returns uuid
language sql
stable
set search_path = ''
as $$ select auth.uid(); $$;

create or replace function public.current_active_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.status = 'active';
$$;

create or replace function public.current_store_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.stores s
  join public.profiles p on p.id = s.owner_id
  where s.owner_id = (select auth.uid()) and p.role = 'merchant' and p.status = 'active';
$$;

create or replace function public.is_merchant()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.current_active_app_role() = 'merchant', false); $$;

create or replace function public.is_customer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.current_active_app_role() = 'customer', false); $$;

-- Super Admin: active super_admin profile AND a TOTP-verified session (aal2, AUTH-09)
-- AND a request from the allowlisted network (AUTH-08). Service-role workflows
-- check the actor separately; Edge Functions enforce the same network/MFA rules.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.profiles p
           where p.id = (select auth.uid()) and p.role = 'super_admin' and p.status = 'active'
         )
     and coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
     and private.admin_network_allowed();
$$;

-- Ticket participants (FR-SUP-09): submitting customer; the assigned Merchant while the
-- ticket is in that store's queue; or a Super Admin.
create or replace function public.can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket_id
      and (
        t.customer_id = (select auth.uid())
        or (t.queue = 'store' and t.assigned_to = (select auth.uid())
            and t.store_id is not null and public.owns_store(t.store_id))
        or public.is_super_admin()
      )
  );
$$;

-- Service-role helper for Edge Functions: the verified caller's profile context.
create or replace function public.get_actor_context(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', p.id,
    'role', p.role,
    'status', p.status,
    'store_id', (select s.id from public.stores s where s.owner_id = p.id),
    'full_name', p.full_name
  )
  from public.profiles p where p.id = p_user_id;
$$;

-- Edge Functions call this for privileged admin operations (same allowlist as RLS).
create or replace function public.admin_network_check(p_ip text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.admin_network_allowed(p_ip::inet);
exception when others then
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Signup provisioning and role assignment (AUTHZ-01/02)
-- -----------------------------------------------------------------------------

-- The server decides the role. Self-service signup may only produce `customer`
-- or `merchant` (both are public sign-up paths in the SRS); `super_admin` is
-- never assignable from client-supplied metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := case when new.raw_user_meta_data ->> 'account_type' = 'merchant' then 'merchant' else 'customer' end;
begin
  insert into public.profiles (id, full_name, role, status)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
                  nullif(trim(new.raw_user_meta_data ->> 'name'), ''), ''), 150),
    v_role,
    'active'
  )
  on conflict (id) do nothing;
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  values (new.id, 'profile.created', 'profile', new.id, jsonb_build_object('role', v_role));
  return new;
end;
$$;

-- Google sign-up from the merchant page (FR-M-05): a brand-new customer profile with
-- no activity may switch itself to merchant once. Audited.
create or replace function public.become_merchant()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles where id = (select auth.uid()) for update;
  if not found then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if v_profile.role = 'merchant' then
    return v_profile;
  end if;
  if v_profile.role <> 'customer' or v_profile.status <> 'active' then
    raise exception 'This account cannot become a merchant' using errcode = '42501';
  end if;
  if v_profile.created_at < now() - interval '24 hours'
     or exists (select 1 from public.orders where customer_id = v_profile.id)
     or exists (select 1 from public.customer_addresses where customer_id = v_profile.id)
     or exists (select 1 from public.support_tickets where customer_id = v_profile.id) then
    raise exception 'Only a new account with no customer activity can become a merchant. Register a separate merchant account.' using errcode = '23514';
  end if;
  update public.profiles set role = 'merchant' where id = v_profile.id returning * into v_profile;
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  values (v_profile.id, 'profile.role_changed', 'profile', v_profile.id,
          jsonb_build_object('previous_role', 'customer', 'new_role', 'merchant', 'source', 'self_service_merchant_signup'));
  return v_profile;
end;
$$;

-- Project-owner procedure for creating a Super Admin (no default admin exists).
-- Run from the SQL editor as postgres:  select private.grant_super_admin('<user uuid>', '<reason>');
-- The user must then enrol TOTP before any admin access works (aal2 is required).
create or replace function private.grant_super_admin(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  select role into v_previous from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.stores where owner_id = p_user_id) then
    raise exception 'A store owner cannot become a Super Admin' using errcode = '23514';
  end if;
  update public.profiles set role = 'super_admin' where id = p_user_id;
  insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
  values (null, 'profile.role_changed', 'profile', p_user_id,
          jsonb_build_object('previous_role', v_previous, 'new_role', 'super_admin',
                             'source', 'project_owner_sql', 'reason', left(trim(p_reason), 500)));
end;
$$;
revoke all on function private.grant_super_admin(uuid, text) from public;

-- -----------------------------------------------------------------------------
-- Supabase Auth hooks (configured in supabase/config.toml)
-- -----------------------------------------------------------------------------

-- AUTH-04 role claim + AUTH-14 suspended/deleted accounts cannot obtain tokens.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_claims jsonb := coalesce(event -> 'claims', '{}'::jsonb);
begin
  select * into v_profile from public.profiles where id = (event ->> 'user_id')::uuid;
  if found and v_profile.status = 'suspended' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Your account has been suspended' || coalesce(': ' || v_profile.suspension_reason, '.')
    ));
  end if;
  if found and v_profile.status = 'deleted' then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This account has been deleted.'));
  end if;
  v_claims := jsonb_set(v_claims, '{app_role}', to_jsonb(coalesce(v_profile.role, 'customer')));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;

-- AUTH-07 / FR-SA-02: lock after 5 consecutive failures for 15 minutes.
create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (event ->> 'user_id')::uuid;
  v_valid boolean := coalesce((event ->> 'valid')::boolean, false);
  v_row private.auth_login_attempts%rowtype;
  v_reject jsonb := jsonb_build_object(
    'decision', 'reject',
    'message', 'Too many failed sign-in attempts. Try again in 15 minutes or reset your password.',
    'should_logout_user', false);
begin
  select * into v_row from private.auth_login_attempts where user_id = v_user for update;
  if found and v_row.locked_until is not null and v_row.locked_until > now() then
    return v_reject;
  end if;
  if v_valid then
    delete from private.auth_login_attempts where user_id = v_user;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into private.auth_login_attempts as a (user_id, failed_count, locked_until, updated_at)
  values (v_user, 1, null, now())
  on conflict (user_id) do update
    set failed_count = case when a.locked_until is not null and a.locked_until <= now() then 1 else a.failed_count + 1 end,
        locked_until = null,
        updated_at = now()
  returning * into v_row;

  if v_row.failed_count >= 5 then
    update private.auth_login_attempts set locked_until = now() + interval '15 minutes', failed_count = 0
    where user_id = v_user;
    insert into public.audit_logs (actor_id, action, resource_type, resource_id, metadata)
    values (null, 'auth.account_locked', 'profile', v_user, jsonb_build_object('minutes', 15));
    return v_reject;
  end if;
  return jsonb_build_object('decision', 'continue');
end;
$$;

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

grant execute on function public.become_merchant() to authenticated;
grant execute on function public.get_actor_context(uuid), public.admin_network_check(text) to service_role;
revoke execute on function public.get_actor_context(uuid), public.admin_network_check(text) from anon, authenticated;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb), public.hook_password_verification_attempt(jsonb)
  to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb), public.hook_password_verification_attempt(jsonb)
  from anon, authenticated, service_role;
