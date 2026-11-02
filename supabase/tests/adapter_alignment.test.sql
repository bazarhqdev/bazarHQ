-- Migrations 012–014: storefront contact and popularity, admin dashboard trends,
-- commit-time stock-model checks for clients, and the trusted payment readers
-- the Edge Functions use. Synthetic fixtures; rolled back.
begin;
select plan(25);

-- ---------------------------------------------------------------- fixture
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('11000000-0000-4000-8000-0000000000a1','authenticated','authenticated','m12-a@example.test','test-only-hash',now(),'{}','{"full_name":"Merchant A","account_type":"merchant"}',now(),now()),
 ('11000000-0000-4000-8000-0000000000a2','authenticated','authenticated','m12-b@example.test','test-only-hash',now(),'{}','{"full_name":"Merchant B","account_type":"merchant"}',now(),now()),
 ('21000000-0000-4000-8000-0000000000c1','authenticated','authenticated','c12-1@example.test','test-only-hash',now(),'{}','{"full_name":"Customer One"}',now(),now()),
 ('31000000-0000-4000-8000-0000000000d1','authenticated','authenticated','a12-1@example.test','test-only-hash',now(),'{}','{"full_name":"Admin One"}',now(),now());
select private.grant_super_admin('31000000-0000-4000-8000-0000000000d1', 'test fixture');
insert into private.admin_ip_allowlist (cidr, note) values ('203.0.113.0/24', 'test network');
update public.profiles set phone = '01711111111' where id = '11000000-0000-4000-8000-0000000000a1';

insert into public.stores (id, owner_id, name, subdomain, status) values
 ('41000000-0000-4000-8000-0000000000e1','11000000-0000-4000-8000-0000000000a1','Shop A','shop12-a','published'),
 ('41000000-0000-4000-8000-0000000000e2','11000000-0000-4000-8000-0000000000a2','Shop B','shop12-b','draft');
insert into public.categories (id, store_id, name, slug) values
 ('51000000-0000-4000-8000-0000000000f1','41000000-0000-4000-8000-0000000000e1','Fruits','fruits'),
 ('51000000-0000-4000-8000-0000000000f2','41000000-0000-4000-8000-0000000000e2','Gadgets','gadgets');
insert into public.products (id, store_id, name, description, category_id, base_price, product_type, stock_quantity, status) values
 ('61000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-0000000000e1','Apple','Crisp apples','51000000-0000-4000-8000-0000000000f1',100,'simple',50,'active'),
 ('61000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-0000000000e1','Mango','Sweet mangoes','51000000-0000-4000-8000-0000000000f1',150,'simple',50,'active'),
 ('61000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-0000000000e1','Hidden','Draft item','51000000-0000-4000-8000-0000000000f1',90,'simple',5,'draft'),
 ('61000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-0000000000e2','Cable','USB-C','51000000-0000-4000-8000-0000000000f2',200,'simple',5,'active');
insert into public.payment_configs (store_id, method, is_enabled, credentials_encrypted, validation_status) values
 ('41000000-0000-4000-8000-0000000000e1','cod',true,null,'not_required'),
 ('41000000-0000-4000-8000-0000000000e1','bkash',true,'\x01','valid');
insert into public.orders (id, store_id, customer_id, order_phone, status, total_amount, delivery_charge, payment_method, payment_status, delivery_address, delivered_at, cancellation_reason) values
 ('81000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-0000000000e1','21000000-0000-4000-8000-0000000000c1','01700000001','delivered',610,60,'cod','cod_collected','{"recipient_name":"Customer One","address":"House 1","district":"Dhaka"}',now(),null),
 ('81000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-0000000000e1',null,'01700000002','cancelled',1410,60,'cod','cod_pending','{"recipient_name":"Guest","address":"House 2","district":"Dhaka"}',null,'Customer changed their mind'),
 ('81000000-0000-4000-8000-000000000003','41000000-0000-4000-8000-0000000000e1',null,'01700000003','pending',210,60,'cod','cod_pending','{"recipient_name":"Guest","address":"House 3","district":"Dhaka"}',null,null),
 ('81000000-0000-4000-8000-000000000004','41000000-0000-4000-8000-0000000000e2',null,'01700000004','pending',260,60,'cod','cod_pending','{"recipient_name":"Guest","address":"House 4","district":"Dhaka"}',null,null);
insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, subtotal) values
 ('81000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','Apple',4,100,400),
 ('81000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002','Mango',1,150,150),
 ('81000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000002','Mango',9,150,1350),
 ('81000000-0000-4000-8000-000000000003','61000000-0000-4000-8000-000000000002','Mango',1,150,150),
 ('81000000-0000-4000-8000-000000000004','61000000-0000-4000-8000-000000000004','Cable',1,200,200);

-- ================================================================ 012: resolve_store contact (FR-C-25)
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(public.resolve_store('shop12-a') -> 'contact' ->> 'phone', '01711111111', 'resolve_store returns the merchant phone');
select is(public.resolve_store('shop12-a') -> 'contact' ->> 'email', 'm12-a@example.test', 'resolve_store returns the merchant email');
select ok(not (public.resolve_store('shop12-a') -> 'contact' ?| array['id','full_name','role','status','address']),
          'contact carries phone and email only');
select throws_ok($$select public.resolve_store('shop12-b')$$, 'BQ003', null, 'a draft store is still unavailable');

-- ================================================================ 012: storefront popularity (anon)
select is((select array_agg(product_id::text order by units desc) from public.storefront_product_popularity('41000000-0000-4000-8000-0000000000e1')),
          array['61000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000002'],
          'popularity ranks by units sold and ignores cancelled orders');
select is((select units from public.storefront_product_popularity('41000000-0000-4000-8000-0000000000e1') where product_id = '61000000-0000-4000-8000-000000000002'),
          2::bigint, 'cancelled-order units are not counted');
select is((select count(*)::int from public.storefront_product_popularity('41000000-0000-4000-8000-0000000000e2')), 0,
          'an unpublished store reveals nothing');
reset role;
select is((select string_agg(a, ',' order by n) from unnest((select proargnames from pg_proc where proname = 'storefront_product_popularity')) with ordinality t(a, n)),
          'p_store_id,product_id,units', 'popularity exposes only product_id and units');

-- ================================================================ 012: admin_dashboard previous-period counts
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10"}', true);
set local role authenticated;
select ok((public.admin_dashboard(now() - interval '7 days', now() + interval '1 minute')) ?& array['merchants_previous','customers_previous','merchants','customers_total'],
          'admin_dashboard returns current and previous-period counts');
select ok(((public.admin_dashboard(now() + interval '1 day', now() + interval '2 days')) ->> 'merchants_previous')::int
          >= ((public.admin_dashboard(now() - interval '7 days', now())) ->> 'merchants_previous')::int,
          'previous counts only include accounts created before the period');
reset role;
select set_config('request.headers', '', true);
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.admin_dashboard(now() - interval '1 day', now())$$, '42501', null, 'admin_dashboard still requires TOTP (AAL2)');
reset role;

-- ================================================================ 013: stock-model checks at commit time, as a client
select ok((select prosecdef from pg_proc where oid = 'public.check_product_stock_model'::regproc)
          and (select prosecdef from pg_proc where oid = 'public.check_variant_stock_model'::regproc),
          'deferred stock-model trigger functions run as definer');
select ok(not has_function_privilege('authenticated', 'public.assert_product_stock_model(uuid)', 'EXECUTE'),
          'clients still cannot call assert_product_stock_model directly');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select public.create_product('{"name":"Banana","description":"Sagor bananas","category_id":"51000000-0000-4000-8000-0000000000f1",
  "base_price":90,"product_type":"variant","status":"active","variants":[{"variant_label":"Dozen","stock_quantity":6}]}')$$,
  'a merchant creates a variant product');
-- Fire the deferred constraint triggers now, still as the client (what COMMIT does).
select lives_ok($$set constraints all immediate$$, 'commit-time stock-model checks pass as the merchant (was: permission denied)');
select throws_ok($$select public.create_product('{"name":"Bad","description":"No variants here","category_id":"51000000-0000-4000-8000-0000000000f1",
  "base_price":10,"product_type":"variant","variants":[]}')$$, '22023', null, 'the stock model is still enforced');
reset role;
set constraints all deferred;

-- ================================================================ 014: trusted payment readers
select ok(not has_function_privilege('anon', 'public.payment_snapshot(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.payment_snapshot(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.pending_verification_attempt(uuid)', 'EXECUTE')
          and not has_function_privilege('authenticated', 'public.sslcommerz_attempt_context(uuid)', 'EXECUTE'),
          'clients cannot call the payment readers');
select ok(has_function_privilege('service_role', 'public.payment_snapshot(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.pending_verification_attempt(uuid)', 'EXECUTE')
          and has_function_privilege('service_role', 'public.sslcommerz_attempt_context(uuid)', 'EXECUTE'),
          'Edge Functions (service_role) can call the payment readers');
select ok(not has_table_privilege('service_role', 'public.payment_transactions', 'SELECT'),
          'service_role still has no direct table access (migration 003 design kept)');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok($$select set_config('test.order12', (public.create_order(null, '41000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"61000000-0000-4000-8000-000000000001","quantity":1,"expected_unit_price":100}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555512","address":"Road 1, Banani","district":"Dhaka"}', 'bkash', 'order-key-12') -> 'order' ->> 'id'), true)$$,
  'a bKash order is created with its first attempt');
select lives_ok($$select public.submit_wallet_reference(current_setting('test.order12')::uuid, 'TRX12345678', null, '01755555512')$$,
  'the customer reference is attached once');
select ok((public.payment_snapshot(current_setting('test.order12')::uuid) -> 'payment' ->> 'providerReferenceMasked') = '••••5678'
          and not (public.payment_snapshot(current_setting('test.order12')::uuid) -> 'payment' ? 'idempotencyKey'),
          'payment_snapshot masks the reference and hides internal fields');
select is(public.pending_verification_attempt(current_setting('test.order12')::uuid) ->> 'provider_transaction_reference', 'TRX12345678',
          'pending_verification_attempt gives the server the raw reference to verify');
reset role;

-- ================================================================ 015: policy dates follow the Bangladesh business day
select ok(pg_get_functiondef('public.admin_submit_policy'::regproc) ~ 'Asia/Dhaka',
          'admin_submit_policy compares with the Asia/Dhaka date');
set local timezone = 'UTC';
select throws_ok($$select public.admin_submit_policy('31000000-0000-4000-8000-0000000000d1', 'privacy', 'tz-1',
    ((now() at time zone 'Asia/Dhaka')::date - 1), repeat('Privacy policy text. ', 5))$$,
  '22023', null, 'a date before today in Dhaka is refused even when the server runs in UTC');
reset timezone;

select * from finish();
rollback;
