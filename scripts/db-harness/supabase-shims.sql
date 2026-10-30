-- Supabase platform shims for the Docker-free test harness.
--
-- The vendored init scripts (vendor/supabase-postgres) create the real Supabase
-- roles, auth schema and storage schema. Some objects are normally created by
-- other Supabase services (GoTrue, storage-api, supabase_vault). This file adds
-- the minimum of those that BazarHQ's migrations and tests use, matching the
-- upstream shapes. It is NOT used by `supabase start` / `supabase db reset`.
-- Run as the bootstrap superuser (supabase_admin), before the role demotion.

-- Role referenced by vendored grant migrations.
do $$ begin
  if not exists (select from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin;
  end if;
end $$;

-- ---------------------------------------------------------------- auth (GoTrue)
alter table auth.users
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists phone text,
  add column if not exists phone_confirmed_at timestamptz,
  add column if not exists banned_until timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists is_sso_user boolean not null default false,
  add column if not exists is_anonymous boolean not null default false;

-- Current GoTrue helpers read the full claims object (request.jwt.claims).
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;
alter function auth.jwt() owner to supabase_auth_admin;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;
grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role, postgres;

create table if not exists auth.sessions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  aal text,
  not_after timestamptz
);
-- Remaining GoTrue session columns (upstream shape, auth v2.17x).
alter table auth.sessions
  add column if not exists factor_id uuid,
  add column if not exists refreshed_at timestamp without time zone,
  add column if not exists user_agent text,
  add column if not exists ip inet,
  add column if not exists tag text;
create table if not exists auth.mfa_factors (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  friendly_name text,
  factor_type text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table auth.sessions owner to supabase_auth_admin;
alter table auth.mfa_factors owner to supabase_auth_admin;

-- ------------------------------------------------------- storage (storage-api)
create table if not exists storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  user_metadata jsonb
);
create unique index if not exists bucketid_objname on storage.objects (bucket_id, name);

create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
create or replace function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end $$;
create or replace function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end $$;

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter function storage.foldername(text) owner to supabase_storage_admin;
alter function storage.filename(text) owner to supabase_storage_admin;
alter function storage.extension(text) owner to supabase_storage_admin;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role, postgres;
grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role, postgres;

-- ------------------------------------------------------------ vault (supabase_vault)
-- Real Vault encrypts secrets with pgsodium-managed keys; this shim only
-- reproduces the interface (vault.create_secret / vault.decrypted_secrets).
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
revoke all on schema vault from public;
grant usage on schema vault to postgres, service_role;
grant select on vault.decrypted_secrets to postgres;
grant all on vault.secrets to postgres;
grant execute on function vault.create_secret(text, text, text) to postgres;
