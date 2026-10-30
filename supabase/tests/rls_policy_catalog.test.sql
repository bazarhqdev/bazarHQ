-- Catalog-level security contract: RLS coverage, least-privilege grants, function
-- privileges, append-only guards, Storage buckets, Realtime and key constraints.
-- Read-only checks against the migrated schema; rolled back.
begin;
select plan(46);

-- ---------------------------------------------------------------- RLS coverage
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
  0, 'every table in public has RLS enabled');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'payment_configs'),
  0, 'payment_configs has no client policy (deny all; safe projection via function)');
select ok(
  (select bool_and(n > 0) from (
     select t, (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t) n
     from unnest(array['profiles','themes','stores','categories','products','product_variants','product_images','orders',
                       'order_items','payment_transactions','delivery_events','returns','refunds','support_tickets',
                       'ticket_messages','ticket_audit_log','inventory_movements','notifications','device_tokens','audit_logs',
                       'announcements','policies','customer_addresses']) t) x),
  'every client-readable table has at least one explicit policy');

-- ---------------------------------------------------------------- anon grants
select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),
  0, 'anon has no table-level write privilege on any public table');
select is(
  (select count(*)::int from information_schema.column_privileges
   where grantee = 'anon' and table_schema = 'public' and privilege_type in ('INSERT','UPDATE')),
  0, 'anon has no column-level write privilege on any public table');
select ok(not has_table_privilege('anon', 'public.orders', 'SELECT'), 'anon cannot read orders directly (tracking uses a server endpoint)');
select ok(not has_table_privilege('anon', 'public.customer_addresses', 'SELECT'), 'anon cannot read saved addresses');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon cannot read profiles');

-- ---------------------------------------------------------------- authenticated grants
select ok(
  (select bool_and(not has_table_privilege('authenticated', 'public.' || t, p))
   from unnest(array['orders','order_items','payment_transactions','payment_configs','delivery_events','inventory_movements',
                     'audit_logs','ticket_audit_log','ticket_messages','refunds','returns','support_tickets','products',
                     'product_variants','policies','announcements','themes','device_tokens']) t,
        unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p),
  'authenticated has no direct writes on workflow, financial, catalogue-stock or audit tables');
select ok(
  (select bool_and(not has_column_privilege('authenticated', 'public.' || t, c, 'UPDATE'))
   from (values ('products','stock_quantity'),('product_variants','stock_quantity'),('orders','status'),('orders','payment_status'),
                ('stores','status'),('stores','owner_id'),('profiles','role'),('profiles','status'),('notifications','user_id'),
                ('notifications','reference_id'),('payment_transactions','status')) v(t, c)),
  'authenticated cannot update role, status, stock, payment state or notification targets');
select ok(has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
          and has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE'),
          'authenticated may edit own non-role profile fields and mark notifications read');
select ok(not has_column_privilege('authenticated', 'public.device_tokens', 'token', 'SELECT'),
          'raw FCM tokens are not selectable by clients');

-- ---------------------------------------------------------------- service_role is not a bypass for history/state tables
select ok(
  (select bool_and(not has_table_privilege('service_role', 'public.' || t, p))
   from unnest(array['orders','order_items','payment_transactions','delivery_events','inventory_movements','audit_logs',
                     'ticket_audit_log','refunds','returns','products','product_variants']) t,
        unnest(array['INSERT','UPDATE','DELETE']) p),
  'service_role has no direct DML on order, payment, stock, refund and audit tables (trusted functions only)');

-- ---------------------------------------------------------------- function privileges
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not in ('is_super_admin','owns_store','owns_product','owns_order','can_read_order','can_read_return',
                           'can_access_ticket','current_active_app_role','current_store_id','is_merchant','is_customer',
                           'resolve_store','search_stores','validate_cart',
                           'record_storefront_visit', 'storefront_product_popularity')),
  null::text[], 'anon can execute only the RLS helpers and public storefront functions');
select is(
  (select array_agg(f order by f) from unnest(array[
     'create_order','transition_order_status','record_cod_collection','submit_wallet_reference','apply_payment_result',
     'create_payment_attempt','record_payment_transaction_state','adjust_inventory','request_return','decide_return',
     'confirm_return_receipt','create_refund','update_refund_status','admin_intervene_refund','admin_set_merchant_status',
     'admin_delete_merchant','admin_submit_policy','admin_approve_policy','admin_publish_policy','admin_save_theme',
     'admin_delete_theme','admin_save_announcement','store_payment_credentials','get_payment_credentials','track_order',
     'register_device_token','claim_pending_push_notifications','consume_rate_limit','get_actor_context',
     'prepare_sslcommerz_payment','escalate_return','admin_resolve_return_dispute']) f
   where exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = f and has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  null::text[], 'trusted server operations are not executable with a user JWT');
select ok(
  (select bool_and(exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                           where n.nspname = 'public' and p.proname = f and has_function_privilege('service_role', p.oid, 'EXECUTE')))
   from unnest(array['create_order','transition_order_status','record_cod_collection','apply_payment_result','adjust_inventory',
                     'request_return','create_refund','admin_set_merchant_status','track_order','register_device_token']) f),
  'service_role (Edge Functions) can execute the trusted operations');
select is(
  (select array_agg(n.nspname || '.' || p.proname order by 1)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  null::text[], 'every SECURITY DEFINER function pins search_path');
select ok(has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.custom_access_token_hook(jsonb)', 'EXECUTE')
          and not has_function_privilege('anon', 'public.hook_password_verification_attempt(jsonb)', 'EXECUTE'),
          'auth hooks are callable by Supabase Auth only');
select ok(not has_schema_privilege('anon', 'private', 'USAGE') and not has_schema_privilege('authenticated', 'private', 'USAGE'),
          'the private schema is not reachable by client roles');
select ok(not has_function_privilege('service_role', 'private.grant_super_admin(uuid,text)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'private.grant_super_admin(uuid,text)', 'EXECUTE'),
          'Super Admin elevation is a project-owner SQL procedure only');

-- ---------------------------------------------------------------- append-only guards
select ok(
  (select bool_and(exists (select 1 from pg_trigger tg where tg.tgrelid = ('public.' || t)::regclass and not tg.tgisinternal
                           and tg.tgfoid = 'public.prevent_append_only_mutation()'::regprocedure))
   from unnest(array['audit_logs','ticket_audit_log','delivery_events','inventory_movements','order_items','ticket_messages']) t),
  'append-only tables carry the UPDATE/DELETE guard trigger');
select ok(
  (select bool_and(not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t
                               and c.column_name = 'updated_at'))
   from unnest(array['audit_logs','ticket_audit_log','delivery_events','inventory_movements','order_items','ticket_messages']) t),
  'append-only tables have no mutable updated_at');
select ok(
  (select bool_and(exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'updated_at')
               and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = t and c.column_name = 'created_at')
               and exists (select 1 from pg_trigger tg where tg.tgrelid = ('public.' || t)::regclass and not tg.tgisinternal
                           and tg.tgfoid = 'public.set_updated_at()'::regprocedure))
   from unnest(array['profiles','themes','stores','categories','products','product_variants','product_images','orders',
                     'payment_configs','returns','refunds','support_tickets','announcements','policies','customer_addresses']) t),
  'mutable business tables have created_at, updated_at and the timestamp trigger');
select has_trigger('public', 'refunds', 'refunds_guard_row', 'refund immutability guard exists');
select has_trigger('public', 'payment_transactions', 'payment_transactions_guard_update_trg', 'payment immutability guard exists (003)');

-- ---------------------------------------------------------------- constraints
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_status_check')
   ~ 'pending.*confirmed.*processing.*shipped.*out_for_delivery.*delivered.*cancelled',
  'orders.status is limited to the seven canonical statuses');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_payment_status_check')
   ~ 'pending_verification.*paid.*failed.*cod_pending.*cod_collected.*refunded',
  'orders.payment_status is limited to the canonical payment statuses');
select ok(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.refunds'::regclass and conname = 'refunds_status_check')
   ~ 'initiated.*processing.*completed.*failed',
  'refunds.status is limited to the canonical refund statuses');
select col_is_unique('public', 'stores', array['owner_id'], 'one store per merchant');
select col_is_unique('public', 'stores', array['subdomain'], 'store subdomains are unique');
select col_is_unique('public', 'returns', array['order_id'], 'one return per order');
select col_is_unique('public', 'refunds', array['return_id'], 'one refund per return');
select has_index('public', 'products', 'products_store_sku_uq', 'SKU is unique per store');
select has_index('public', 'orders', 'orders_store_idempotency_uq', 'order idempotency key is unique per store');
select has_index('public', 'orders', 'orders_order_number_uq', 'public order numbers are unique');
select is((select confdeltype::text from pg_constraint where conrelid = 'public.order_items'::regclass and conname = 'order_items_order_id_fkey'),
          'r', 'order_items keep history: ON DELETE RESTRICT to orders (DB-06)');
select is((select confdeltype::text from pg_constraint where conrelid = 'public.product_images'::regclass and conname = 'product_images_product_id_fkey'),
          'c', 'product_images cascade with their product (DB-06)');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.stores'::regclass and conname = 'stores_subdomain_not_reserved_check'),
          'reserved subdomains are rejected by the database');
select ok(exists (select 1 from pg_constraint where conrelid = 'public.orders'::regclass and conname = 'orders_amounts_check'),
          'order total = subtotal + delivery charge');

-- ---------------------------------------------------------------- Storage
select is((select count(*)::int from storage.buckets
           where id in ('product-images','store-logos','delivery-evidence','return-evidence','support-attachments','profile-images')
             and public = false),
          6, 'six private buckets exist (no public object URLs)');
select ok((select bool_and(file_size_limit is not null and allowed_mime_types is not null) from storage.buckets),
          'every bucket enforces a size limit and a MIME allowlist');
select is((select allowed_mime_types from storage.buckets where id = 'support-attachments'),
          array['image/jpeg','image/png','application/pdf'], 'support attachments: JPG/PNG/PDF only (FR-SUP-01)');
select is((select file_size_limit from storage.buckets where id = 'product-images'), 2097152::bigint,
          'product images are capped at 2 MB (FR-M-16)');
select ok(
  (select bool_and(exists (select 1 from pg_policies p where p.schemaname = 'storage' and p.tablename = 'objects'
                           and p.cmd = 'INSERT' and p.qual is null and p.with_check like '%' || b || '%'))
   from unnest(array['product-images','store-logos','delivery-evidence','return-evidence','support-attachments','profile-images']) b),
  'each bucket has an explicit, path-scoped INSERT policy');
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE','DELETE')
     and (qual like '%delivery-evidence%' or qual like '%return-evidence%' or qual like '%support-attachments%')),
  0, 'evidence and attachment objects cannot be updated or deleted by clients');

-- ---------------------------------------------------------------- Realtime
select ok(
  (select count(*) = 4 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('orders','notifications','support_tickets','delivery_events')),
  'Realtime publishes orders, delivery events, notifications and tickets (RLS-filtered)');

select * from finish();
rollback;
