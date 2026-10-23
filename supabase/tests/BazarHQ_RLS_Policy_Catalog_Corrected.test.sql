-- BazarHQ Stage 1: RLS/Storage catalog and privilege regression tests.
-- These are pgTAP catalog/privilege checks, not a substitute for JWT-based
-- behavioral tests or real Storage API integration tests.
begin;
select plan(36);

-- All 23 core tables must have RLS enabled.
select ok((select count(*) = 23 and bool_and(c.relrowsecurity)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relname = any(array[
    'profiles','themes','stores','categories','products','product_variants',
    'product_images','orders','order_items','payment_configs','delivery_events',
    'returns','refunds','support_tickets','ticket_messages','ticket_audit_log',
    'inventory_movements','notifications','device_tokens','audit_logs',
    'announcements','policies','customer_addresses'
  ])), 'RLS is enabled on all 23 core application tables');

select ok(not has_table_privilege('anon','public.orders','INSERT'), 'anon has no direct order insert privilege');
select ok(not has_table_privilege('authenticated','public.orders','INSERT'), 'authenticated has no direct order insert privilege');
select ok(not has_table_privilege('authenticated','public.order_items','INSERT'), 'authenticated has no direct order-item insert privilege');
select ok(not has_table_privilege('authenticated','public.inventory_movements','INSERT'), 'authenticated has no direct inventory ledger insert privilege');
select ok(not has_table_privilege('authenticated','public.inventory_movements','UPDATE'), 'authenticated has no direct inventory ledger update privilege');
select ok(not has_table_privilege('authenticated','public.inventory_movements','DELETE'), 'authenticated has no direct inventory ledger delete privilege');
select ok(not has_table_privilege('authenticated','public.payment_configs','SELECT'), 'authenticated cannot directly select payment configuration ciphertext');
select ok(not has_table_privilege('anon','public.payment_configs','SELECT'), 'anon cannot directly select payment configuration ciphertext');
select ok(not has_table_privilege('authenticated','public.device_tokens','SELECT'), 'authenticated cannot directly select device tokens');
select ok(not has_table_privilege('authenticated','public.audit_logs','SELECT'), 'authenticated cannot directly read audit logs, including with a Super Admin role');
select ok(not has_table_privilege('authenticated','public.profiles','INSERT'), 'authenticated cannot directly create privileged profiles');
select ok(not has_column_privilege('authenticated','public.profiles','role','UPDATE'), 'authenticated cannot update profiles.role');
select ok(not has_column_privilege('authenticated','public.profiles','status','UPDATE'), 'authenticated cannot update profiles.status');
select ok(not has_column_privilege('authenticated','public.stores','status','UPDATE'), 'authenticated cannot directly publish or suspend a store');
select ok(not has_column_privilege('authenticated','public.stores','owner_id','UPDATE'), 'authenticated cannot change store ownership');
select ok(not has_table_privilege('authenticated','public.products','INSERT'), 'product creation uses the trusted product workflow');
select ok(not has_table_privilege('authenticated','public.products','UPDATE'), 'product updates use the trusted product workflow');
select ok(not has_table_privilege('authenticated','public.product_variants','UPDATE'), 'variant stock updates use the trusted inventory workflow');
select ok(not has_table_privilege('authenticated','public.orders','UPDATE'), 'authenticated cannot directly change order/payment states');
select ok(not has_table_privilege('authenticated','public.refunds','UPDATE'), 'authenticated cannot directly settle refunds');

-- Super Admin role checks must not be used as a direct-client bypass in RLS.
select ok(not exists (
  select 1 from pg_policies
  where schemaname='public' and tablename <> 'payment_transactions'
    and coalesce(qual,'') ~* 'is_super_admin|can_access_ticket'
), 'core-table RLS policies do not grant privileged access by Super Admin role helper');
select ok(not exists (
  select 1 from pg_policies
  where schemaname='storage' and tablename='objects'
    and coalesce(qual,'') ~* 'is_super_admin|can_access_ticket'
), 'Storage policies do not bypass network/MFA controls for Super Admin');
select ok(not has_function_privilege('authenticated','public.can_access_ticket(uuid)','EXECUTE'), 'ticket helper with Super Admin role branch is not client-callable');
select set_config('request.jwt.claim.role','authenticated',true);
select is(public.is_super_admin(), false, 'Super Admin role helper fails closed for direct authenticated JWTs');
select ok(position('p.role = ''merchant''' in pg_get_functiondef('public.owns_store(uuid)'::regprocedure)) > 0,
  'store ownership helper requires Merchant role, not ownership alone');
select ok(exists (
  select 1 from pg_policies where schemaname='public'
    and tablename='payment_transactions'
    and policyname='payment_transactions_read_authorized'
    and coalesce(qual,'') ilike '%is_super_admin%'
), 'legacy payment policy is present but its role helper fails closed for direct client JWTs');

-- Public catalogue and private data policy shape.
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='stores'
    and policyname='stores_select_published_or_own_merchant' and cmd='SELECT'
), 'store reads use published-or-own-Merchant policy');
select ok(exists (
  select 1 from pg_policies where schemaname='public' and tablename='product_variants'
    and policyname='variants_select_active_published_or_own_store'
    and coalesce(qual,'') ~* 'status\s*=\s*''active'''
), 'public/Customer variant reads require active status');
select ok(not exists (
  select 1 from pg_policies where schemaname='public' and tablename='audit_logs'
    and cmd='SELECT' and roles && array['anon','authenticated']::name[]
), 'no direct client audit-log read policy exists');
select ok(not exists (
  select 1 from pg_policies where schemaname='public' and tablename='payment_configs'
    and roles && array['anon','authenticated']::name[] and cmd in ('SELECT','ALL')
), 'no direct client payment-config read policy exists');

-- All five approved Storage buckets are private and have a matching policy family.
select is((select count(*)::integer from storage.buckets
  where id = any(array['product-images','store-logos','delivery-evidence','return-evidence','support-attachments'])
    and public = false), 5, 'all five approved Storage buckets exist and are private');
select ok(exists (select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='product_images_storage_delete_own_product'), 'product-image deletion is restricted to owned product paths');
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='product_images' and policyname='product_images_delete_own_product_after_object'), 'product-image metadata deletion requires the Storage object to be absent');
select ok(public.safe_uuid('not-a-valid-uuid') is null, 'malformed Storage UUID text safely parses to NULL');
select ok(public.safe_uuid('00000000-0000-0000-0000-000000000001') is not null, 'valid UUID text parses successfully');

select * from finish();
rollback;
