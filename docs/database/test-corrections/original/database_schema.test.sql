-- Schema/catalog contract checks. Run on a disposable local Supabase database.
begin;
select plan(16);

select ok((select count(*) = 24 from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
  and table_name = any(array['profiles','themes','stores','categories','products','product_variants','product_images','orders','order_items','payment_configs','payment_transactions','delivery_events','returns','refunds','support_tickets','ticket_messages','ticket_audit_log','inventory_movements','notifications','device_tokens','audit_logs','announcements','policies','customer_addresses'])), 'all 24 in-scope application tables exist');
select ok((select count(*) = 24 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname = any(array['profiles','themes','stores','categories','products','product_variants','product_images','orders','order_items','payment_configs','payment_transactions','delivery_events','returns','refunds','support_tickets','ticket_messages','ticket_audit_log','inventory_movements','notifications','device_tokens','audit_logs','announcements','policies','customer_addresses']) and c.relrowsecurity), 'RLS is enabled on all 24 application tables');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='role'), 'canonical profiles.role exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='products' and column_name='stock_quantity'), 'simple-product stock column exists');
select ok(exists(select 1 from information_schema.columns where table_schema='public' and table_name='product_variants' and column_name='stock_quantity' and is_nullable='NO'), 'variant stock column is non-null');
select ok(exists(select 1 from pg_constraint where conrelid='public.products'::regclass and conname='products_stock_model_check'), 'product stock model constraint exists');
select ok(exists(select 1 from pg_constraint where conrelid='public.categories'::regclass and conname='categories_parent_same_store_fk'), 'category hierarchy enforces same-store ownership');
select ok(exists(select 1 from pg_constraint where conrelid='public.inventory_movements'::regclass and conname like '%variant%'), 'inventory movement variant relationship constraint exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='payment_transactions_order_idempotency_uq'), 'payment attempt idempotency index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='payment_transactions_provider_reference_uq'), 'provider-reference deduplication index exists');
select ok(exists(select 1 from pg_trigger where tgrelid='public.payment_transactions'::regclass and tgname='payment_transactions_validate_insert_trg' and not tgisinternal), 'payment insert guard trigger exists');
select ok(exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_payment_attempt' and p.prosecdef), 'payment attempt creation is a SECURITY DEFINER function');
select ok(not has_table_privilege('authenticated','public.payment_transactions','INSERT'), 'authenticated role cannot insert payment attempts directly');
select ok(not has_table_privilege('service_role','public.payment_transactions','INSERT'), 'service_role cannot insert payment attempts directly');
select ok(has_function_privilege('service_role','public.create_payment_attempt(uuid,uuid,text,text,numeric,text,jsonb,uuid)','EXECUTE'), 'service_role can execute the approved payment creation function');
select ok((select count(*)=5 from storage.buckets where id = any(array['product-images','store-logos','delivery-evidence','return-evidence','support-attachments']) and public=false), 'all five approved Storage buckets exist and are private');

select * from finish();
rollback;
