-- Behavioral RLS smoke tests for local Supabase. Fixtures are synthetic and rolled back.
-- These are not a substitute for the full TST-07/TST-14 matrix or external penetration testing.
begin;
select plan(10);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('10000000-0000-4000-8000-000000000001','authenticated','authenticated','merchant-a@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Merchant A"}'::jsonb,now(),now()),
 ('10000000-0000-4000-8000-000000000002','authenticated','authenticated','merchant-b@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Merchant B"}'::jsonb,now(),now()),
 ('20000000-0000-4000-8000-000000000001','authenticated','authenticated','customer-a@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Customer A"}'::jsonb,now(),now()),
 ('20000000-0000-4000-8000-000000000002','authenticated','authenticated','customer-b@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Customer B"}'::jsonb,now(),now());
update public.profiles set role='merchant' where id in ('10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002');

insert into public.stores (id, owner_id, name, subdomain, status)
values
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Store A','store-a-test','published'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','Store B','store-b-test','published');
insert into public.categories (id, store_id, name, slug)
values
 ('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Category A','category-a'),
 ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Category B','category-b');
insert into public.products (id, store_id, name, description, category_id, base_price, product_type, stock_quantity, status)
values
 ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Product A','test','40000000-0000-4000-8000-000000000001',100,'simple',5,'draft'),
 ('50000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','Product B','test','40000000-0000-4000-8000-000000000002',100,'simple',5,'draft');
insert into public.payment_configs (id, store_id, method, is_enabled) values
 ('70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','cod',true),
 ('70000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','cod',true);

insert into public.orders (id, store_id, customer_id, order_phone, status, total_amount, payment_method, payment_status, delivery_address)
values
 ('60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','01700000001','pending',100,'cod','cod_pending','{"address":"A","district":"Dhaka"}'),
 ('60000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','01700000002','pending',100,'cod','cod_pending','{"address":"B","district":"Dhaka"}');
insert into public.payment_transactions (id, order_id, payment_config_id, method, provider, amount, currency, status, idempotency_key, metadata_sanitized)
values
 ('80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','cod','cod',100,'BDT','pending','rls-order-a-key','{}'::jsonb),
 ('80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000002','cod','cod',100,'BDT','pending','rls-order-b-key','{}'::jsonb);
set constraints all immediate;

select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select is((select count(*)::int from public.products where id='50000000-0000-4000-8000-000000000001'),1,'Merchant A can read own draft product');
select is((select count(*)::int from public.products where id='50000000-0000-4000-8000-000000000002'),0,'Merchant A cannot read Merchant B draft product');
select throws_ok($$insert into public.orders (store_id, order_phone, status, total_amount, payment_method, payment_status, delivery_address) values ('30000000-0000-4000-8000-000000000001','01700000003','pending',100,'cod','cod_pending','{"address":"x"}')$$,'42501','Merchant cannot directly insert protected orders');
reset role;

select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*)::int from public.orders where id='60000000-0000-4000-8000-000000000001'),1,'Customer A can read own order');
select is((select count(*)::int from public.orders where id='60000000-0000-4000-8000-000000000002'),0,'Customer A cannot read Customer B order');
select is((select count(id)::int from public.payment_transactions where id='80000000-0000-4000-8000-000000000001'),1,'Customer A can read safe payment summary for own order');
select is((select count(id)::int from public.payment_transactions where id='80000000-0000-4000-8000-000000000002'),0,'Customer A cannot read Customer B payment attempt');
select throws_ok($$update public.payment_transactions set status='paid' where id='80000000-0000-4000-8000-000000000001'$$,'42501','Customer cannot directly update payment attempt status');
select throws_ok($$select idempotency_key from public.payment_transactions where id='80000000-0000-4000-8000-000000000001'$$,'42501','Customer cannot read internal idempotency key');
select throws_ok($$update public.profiles set role='super_admin' where id=auth.uid()$$,'42501','Customer cannot update profile role column');
reset role;

select * from finish();
rollback;
