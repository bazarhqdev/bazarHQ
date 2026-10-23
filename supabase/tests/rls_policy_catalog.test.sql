-- BazarHQ Stage 1: RLS/Storage catalog, grants, and helper behavior tests.
-- Catalog tests are not a substitute for separate JWT/RLS and Storage API tests.
-- Run only after migrations 001-004 have been applied to a disposable local DB.
begin;
select plan(49);

-- Create a real Auth subject and canonical profile whose role is Super Admin.
-- The transaction is rolled back at the end; no persistent account is created.
create temporary table rls_test_super_admin_subject(id uuid primary key) on commit drop;
with new_auth_user as (
    insert into auth.users (
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    values (
        gen_random_uuid(), 'authenticated', 'authenticated',
        'rls-test-' || gen_random_uuid()::text || '@example.invalid',
        '', now(), '{}'::jsonb, '{"full_name":"RLS Catalog Test Admin"}'::jsonb,
        now(), now()
    )
    returning id
)
insert into pg_temp.rls_test_super_admin_subject(id)
select id from new_auth_user;

update public.profiles
set role = 'super_admin', status = 'active'
where id = (select id from pg_temp.rls_test_super_admin_subject);

select set_config(
    'request.jwt.claim.sub',
    (select id::text from pg_temp.rls_test_super_admin_subject),
    true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

-- 1: all 23 core application tables have RLS enabled.
select ok((
    select count(*) = 23 and bool_and(c.relrowsecurity)
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = any(array[
        'profiles','themes','stores','categories','products','product_variants',
        'product_images','orders','order_items','payment_configs','delivery_events',
        'returns','refunds','support_tickets','ticket_messages','ticket_audit_log',
        'inventory_movements','notifications','device_tokens','audit_logs',
        'announcements','policies','customer_addresses'
      ])
), 'RLS is enabled on all 23 core application tables');

-- 2-22: direct table/column grants remain least-privilege.
select ok(not has_table_privilege('anon','public.orders','INSERT'), 'anon cannot directly insert orders');
select ok(not has_table_privilege('authenticated','public.orders','INSERT'), 'authenticated cannot directly insert orders');
select ok(not has_table_privilege('authenticated','public.order_items','INSERT'), 'authenticated cannot directly insert order items');
select ok(not has_table_privilege('authenticated','public.inventory_movements','INSERT'), 'authenticated cannot directly insert inventory movements');
select ok(not has_table_privilege('authenticated','public.inventory_movements','UPDATE'), 'authenticated cannot update inventory movements');
select ok(not has_table_privilege('authenticated','public.inventory_movements','DELETE'), 'authenticated cannot delete inventory movements');
select ok(not has_table_privilege('authenticated','public.payment_configs','SELECT'), 'authenticated cannot select raw payment configuration');
select ok(not has_table_privilege('anon','public.payment_configs','SELECT'), 'anon cannot select raw payment configuration');
select ok(not has_table_privilege('authenticated','public.device_tokens','SELECT'), 'authenticated cannot select device tokens directly');
select ok(not has_table_privilege('authenticated','public.audit_logs','SELECT'), 'authenticated cannot select audit logs directly, including as a Super Admin subject');
select ok(not has_table_privilege('authenticated','public.profiles','INSERT'), 'authenticated cannot insert profiles directly');
select ok(not has_column_privilege('authenticated','public.profiles','role','UPDATE'), 'authenticated cannot update profiles.role');
select ok(not has_column_privilege('authenticated','public.profiles','status','UPDATE'), 'authenticated cannot update profiles.status');
select ok(not has_column_privilege('authenticated','public.stores','status','UPDATE'), 'authenticated cannot publish or suspend stores directly');
select ok(not has_column_privilege('authenticated','public.stores','owner_id','UPDATE'), 'authenticated cannot change store ownership');
select ok(not has_table_privilege('authenticated','public.products','INSERT'), 'product creation is not directly granted');
select ok(not has_table_privilege('authenticated','public.products','UPDATE'), 'product update is not directly granted');
select ok(not has_table_privilege('authenticated','public.product_variants','UPDATE'), 'variant update/stock write is not directly granted');
select ok(not has_table_privilege('authenticated','public.orders','UPDATE'), 'order/payment state updates are not directly granted');
select ok(not has_table_privilege('authenticated','public.refunds','UPDATE'), 'refund settlement is not directly granted');
select ok(
    not has_table_privilege('anon','public.profiles','SELECT')
    and not has_table_privilege('anon','public.orders','SELECT')
    and not has_table_privilege('anon','public.order_items','SELECT')
    and not has_table_privilege('anon','public.delivery_events','SELECT')
    and not has_table_privilege('anon','public.returns','SELECT')
    and not has_table_privilege('anon','public.refunds','SELECT')
    and not has_table_privilege('anon','public.support_tickets','SELECT')
    and not has_table_privilege('anon','public.ticket_messages','SELECT')
    and not has_table_privilege('anon','public.ticket_audit_log','SELECT')
    and not has_table_privilege('anon','public.notifications','SELECT')
    and not has_table_privilege('anon','public.customer_addresses','SELECT'),
    'anon has no direct SELECT grants on private customer/order/support resources');

-- 23-25: direct RLS policies must not grant Super Admin privilege by role alone.
select ok(not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename <> 'payment_transactions'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* 'is_super_admin|can_access_ticket'
), 'core-table policies do not use privileged Super Admin/ticket helpers');
select ok(not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ~* 'is_super_admin|can_access_ticket'
), 'Storage policies do not use Super Admin/ticket helpers');
select ok(not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename <> 'payment_transactions'
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%current_app_role%'
), 'core RLS policies use the active-role helper rather than stale role helper');

-- 26-33: missing-helper contract, active ownership, and actual Super Admin subject behavior.
select ok(
    not has_function_privilege(
        'anon',
        'public.can_access_ticket(uuid)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'authenticated',
        'public.can_access_ticket(uuid)',
        'EXECUTE'
    )
    and not has_function_privilege(
        'service_role',
        'public.can_access_ticket(uuid)',
        'EXECUTE'
    ),
    'unused ticket helper is not executable by client or service roles'
);
select ok(to_regprocedure('public.current_app_role()') is null, 'unused current_app_role helper is absent from the migration prerequisite contract');
select ok(to_regprocedure('public.current_store_id()') is null, 'unused current_store_id helper is absent from the migration prerequisite contract');
select ok(to_regprocedure('public.owns_order(uuid)') is null, 'unused owns_order helper is absent from the migration prerequisite contract');
select is(public.is_super_admin(), false, 'is_super_admin fails closed for an actual active Super Admin subject using an authenticated client JWT');
select ok(position('merchant' in pg_get_functiondef('public.owns_store(uuid)'::regprocedure)) > 0
          and position('active' in pg_get_functiondef('public.owns_store(uuid)'::regprocedure)) > 0,
          'owns_store requires active Merchant ownership');
select ok(exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'payment_transactions'
      and policyname = 'payment_transactions_read_authorized'
      and coalesce(qual,'') ilike '%is_super_admin%'
), 'legacy payment policy remains compatible; its helper fails closed for direct client JWTs');

-- 34-38: catalogue and direct-client privacy policy checks.
select ok(exists (select 1 from pg_policies where schemaname='public' and tablename='stores' and policyname='stores_select_published_or_own_merchant' and cmd='SELECT'), 'store policy allows published stores and authorized owner reads');
select ok(exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='product_variants'
      and policyname='variants_select_active_published_or_own_store'
      and coalesce(qual,'') ilike '%active%'
      and coalesce(qual,'') ilike '%published%'
      and coalesce(qual,'') ilike '%owns_store%'
), 'variant policy restricts public reads to active variants of published products/stores while retaining owner access');
select ok(not exists (select 1 from pg_policies where schemaname='public' and tablename='audit_logs' and cmd='SELECT' and roles && array['anon','authenticated']::name[]), 'no direct client audit-log SELECT policy exists');
select ok(not exists (select 1 from pg_policies where schemaname='public' and tablename='payment_configs' and roles && array['anon','authenticated']::name[] and cmd in ('SELECT','ALL')), 'no direct client payment-config SELECT policy exists');
select ok(not has_function_privilege('anon','public.is_super_admin()','EXECUTE'), 'anon has no execute privilege on the Super Admin helper');

-- 39-43: all five approved Storage buckets are private and have their expected policy families.
select is((select count(*)::integer from storage.buckets where id = any(array['product-images','store-logos','delivery-evidence','return-evidence','support-attachments']) and public = false), 5, 'all five approved Storage buckets exist and are private');
select ok((select count(*) = 3 from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['product_images_storage_select_published_or_own','product_images_storage_insert_own_product','product_images_storage_delete_own_product'])), 'product-images has the expected SELECT/INSERT/DELETE policy family');
select ok((select count(*) = 3 from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['store_logos_storage_select_published_or_own','store_logos_storage_insert_own','store_logos_storage_delete_unreferenced_own'])), 'store-logos has the expected SELECT/INSERT/DELETE policy family');
select ok((select count(*) = 2 from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['delivery_evidence_storage_select_participant','delivery_evidence_storage_insert_own_merchant_order'])), 'delivery-evidence has the expected private SELECT/INSERT policy family');
select ok((select count(*) = 2 from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['return_evidence_storage_select_participant','return_evidence_storage_insert_own_return'])), 'return-evidence has the expected private SELECT/INSERT policy family');
select ok((select count(*) = 2 from pg_policies where schemaname='storage' and tablename='objects' and policyname = any(array['support_attachments_storage_select_participant','support_attachments_storage_insert_participant'])), 'support-attachments has the expected private SELECT/INSERT policy family');

-- 44-49: deletion order, safe parsing, and policy/helper linkage.
select ok(exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_storage_delete_own_product'
      and coalesce(qual,'') ilike '%owns_store%'
      and coalesce(qual,'') ilike '%safe_uuid%'
      and coalesce(qual,'') ilike '%product_images%'
), 'product-image object deletion validates the owning product and existing metadata row');
select ok(exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='product_images'
      and policyname='product_images_delete_own_product_after_object'
      and coalesce(qual,'') ilike '%storage.objects%'
), 'product-image metadata deletion policy checks Storage-object absence');
select ok(not exists (
    select 1 from pg_policies
    where schemaname='storage' and tablename='objects'
      and policyname='product_images_storage_delete_own_product'
      and coalesce(qual,'') ilike '%not exists%product_images%'
), 'Storage object deletion does not require metadata to be absent');
select is(public.safe_uuid('not-a-valid-uuid'), null::uuid, 'malformed Storage UUID safely parses to NULL');
select ok(public.safe_uuid('00000000-0000-0000-0000-000000000001') is not null, 'valid UUID text parses successfully');
select ok(not exists (
    select 1 from pg_policies
    where (schemaname='public' or schemaname='storage')
      and (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ilike '%can_access_ticket%'
), 'current RLS policy design does not call the legacy ticket helper');

select * from finish();
rollback;
