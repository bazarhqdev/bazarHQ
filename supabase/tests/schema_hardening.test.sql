-- Schema hardening checks for migration 010 and the Supabase advisor findings.
-- Read-only catalog checks; nothing is written.
begin;
select plan(4);

-- Every foreign key in public has an index whose leading columns are exactly the
-- key columns, in key order (the rule Supabase's advisor applies).
select is(
  (select count(*)::int
     from pg_constraint c
     join pg_class cl on cl.oid = c.conrelid
     join pg_namespace n on n.oid = cl.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_index i
         where i.indrelid = c.conrelid
           and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey)),
  0,
  'every public foreign key has a covering index');

-- Deny-all by design: payment credentials are only reachable through server functions.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_configs'::regclass)
  and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'payment_configs'),
  'payment_configs keeps RLS on with no client policy (deny-all)');

-- Policies call auth helpers through a sub-select so they are evaluated once per
-- statement, not once per row (advisor lint 0003 auth_rls_initplan).
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ '(^|[^.])auth\.(uid|jwt|role)\(\)' or coalesce(with_check, '') ~ '(^|[^.])auth\.(uid|jwt|role)\(\)')
      and not (coalesce(qual, '') || coalesce(with_check, '')) ~* 'select auth\.(uid|jwt|role)\(\)'),
  0,
  'no RLS policy calls auth.uid()/auth.jwt() per row');

-- Every table in public has a primary key (advisor lint 0004).
select is(
  (select count(*)::int from pg_class cl join pg_namespace n on n.oid = cl.relnamespace
    where n.nspname = 'public' and cl.relkind = 'r'
      and not exists (select 1 from pg_constraint c where c.conrelid = cl.oid and c.contype = 'p')),
  0,
  'every public table has a primary key');

select * from finish();
rollback;
