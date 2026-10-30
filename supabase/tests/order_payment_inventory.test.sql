-- Order, payment, COD, tracking, inventory and catalogue workflows (SRS §11, §13, API-07..14/20/21/32/33/43).
-- The first order is placed as service_role exactly as the Edge Functions do; later checks read as the owner. Rolled back.
begin;
select plan(102);

-- ---------------------------------------------------------------- shared synthetic fixture
-- Merchants A/B/C (C has a draft store), customers 1/2, Super Admins 1/2. All rolled back.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('10000000-0000-4000-8000-0000000000a1','authenticated','authenticated','merchant-a@example.test','test-only-hash',now(),'{}','{"full_name":"Merchant A","account_type":"merchant"}',now(),now()),
 ('10000000-0000-4000-8000-0000000000a2','authenticated','authenticated','merchant-b@example.test','test-only-hash',now(),'{}','{"full_name":"Merchant B","account_type":"merchant"}',now(),now()),
 ('10000000-0000-4000-8000-0000000000a3','authenticated','authenticated','merchant-c@example.test','test-only-hash',now(),'{}','{"full_name":"Merchant C","account_type":"merchant"}',now(),now()),
 ('20000000-0000-4000-8000-0000000000c1','authenticated','authenticated','customer-1@example.test','test-only-hash',now(),'{}','{"full_name":"Customer One"}',now(),now()),
 ('20000000-0000-4000-8000-0000000000c2','authenticated','authenticated','customer-2@example.test','test-only-hash',now(),'{}','{"full_name":"Customer Two","account_type":"super_admin"}',now(),now()),
 ('30000000-0000-4000-8000-0000000000d1','authenticated','authenticated','admin-1@example.test','test-only-hash',now(),'{}','{"full_name":"Admin One"}',now(),now()),
 ('30000000-0000-4000-8000-0000000000d2','authenticated','authenticated','admin-2@example.test','test-only-hash',now(),'{}','{"full_name":"Admin Two"}',now(),now());
select private.grant_super_admin('30000000-0000-4000-8000-0000000000d1', 'test fixture');
select private.grant_super_admin('30000000-0000-4000-8000-0000000000d2', 'test fixture');
insert into private.admin_ip_allowlist (cidr, note) values ('203.0.113.0/24', 'test network');
update public.profiles set phone = '01711111111' where id = '10000000-0000-4000-8000-0000000000a1';

insert into public.themes (id, name, is_active) values ('70000000-0000-4000-8000-000000000001', 'Fixture Theme', true);
insert into public.stores (id, owner_id, name, subdomain, status, theme_id) values
 ('40000000-0000-4000-8000-0000000000e1','10000000-0000-4000-8000-0000000000a1','Shop A','shop-a','published','70000000-0000-4000-8000-000000000001'),
 ('40000000-0000-4000-8000-0000000000e2','10000000-0000-4000-8000-0000000000a2','Shop B','shop-b','published',null),
 ('40000000-0000-4000-8000-0000000000e3','10000000-0000-4000-8000-0000000000a3','Shop C','shop-c','draft',null);
insert into public.categories (id, store_id, name, slug) values
 ('50000000-0000-4000-8000-0000000000f1','40000000-0000-4000-8000-0000000000e1','Fruits','fruits'),
 ('50000000-0000-4000-8000-0000000000f2','40000000-0000-4000-8000-0000000000e2','Gadgets','gadgets');
insert into public.products (id, store_id, name, description, category_id, base_price, product_type, stock_quantity, status, low_stock_threshold, deleted_at) values
 ('60000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-0000000000e1','Red Apple','Crisp apples','50000000-0000-4000-8000-0000000000f1',100,'simple',10,'active',2,null),
 ('60000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-0000000000e1','T-Shirt','Cotton tee','50000000-0000-4000-8000-0000000000f1',300,'variant',null,'active',1,null),
 ('60000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-0000000000e2','Cable','USB-C cable','50000000-0000-4000-8000-0000000000f2',200,'simple',3,'active',1,null),
 ('60000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-0000000000e1','Draft Item','Not public','50000000-0000-4000-8000-0000000000f1',50,'simple',1,'draft',0,null),
 ('60000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-0000000000e1','Deleted Item','Removed','50000000-0000-4000-8000-0000000000f1',50,'simple',1,'active',0,now());
insert into public.product_variants (id, product_id, variant_label, price_adjustment, stock_quantity) values
 ('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000002','M',0,5),
 ('61000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000002','XL',50,0);
insert into public.payment_configs (store_id, method, is_enabled, credentials_encrypted, validation_status) values
 ('40000000-0000-4000-8000-0000000000e1','cod',true,null,'not_required'),
 ('40000000-0000-4000-8000-0000000000e1','bkash',true,'\x01','valid'),
 ('40000000-0000-4000-8000-0000000000e1','sslcommerz',true,'\x01','valid'),
 ('40000000-0000-4000-8000-0000000000e2','cod',true,null,'not_required');

-- Orders: O1 C1@A delivered COD collected · O2 C2@A pending bKash · O3 C1@B pending COD · O4 guest@B pending COD
insert into public.orders (id, store_id, customer_id, order_phone, status, total_amount, delivery_charge, payment_method, payment_status, delivery_address, delivered_at) values
 ('80000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000c1','01700000001','delivered',260,60,'cod','cod_collected','{"recipient_name":"Customer One","address":"House 1","district":"Dhaka"}',now() - interval '1 day'),
 ('80000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000c2','01700000002','pending',160,60,'bkash','pending','{"recipient_name":"Customer Two","address":"House 2","district":"Dhaka"}',null),
 ('80000000-0000-4000-8000-000000000003','40000000-0000-4000-8000-0000000000e2','20000000-0000-4000-8000-0000000000c1','01700000001','pending',320,120,'cod','cod_pending','{"recipient_name":"Customer One","address":"House 1","district":"Khulna"}',null),
 ('80000000-0000-4000-8000-000000000004','40000000-0000-4000-8000-0000000000e2',null,'01799999999','pending',260,60,'cod','cod_pending','{"recipient_name":"Guest","address":"House 9","district":"Dhaka"}',null);
insert into public.order_items (order_id, product_id, variant_id, product_name, quantity, unit_price, subtotal) values
 ('80000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',null,'Red Apple',2,100,200),
 ('80000000-0000-4000-8000-000000000002','60000000-0000-4000-8000-000000000001',null,'Red Apple',1,100,100),
 ('80000000-0000-4000-8000-000000000003','60000000-0000-4000-8000-000000000003',null,'Cable',1,200,200),
 ('80000000-0000-4000-8000-000000000004','60000000-0000-4000-8000-000000000003',null,'Cable',1,200,200);
insert into public.inventory_movements (store_id, product_id, quantity_delta, reason, note) values
 ('40000000-0000-4000-8000-0000000000e1','60000000-0000-4000-8000-000000000001',10,'manual_adjustment','fixture'),
 ('40000000-0000-4000-8000-0000000000e2','60000000-0000-4000-8000-000000000003',3,'manual_adjustment','fixture');
insert into public.customer_addresses (customer_id, label, recipient_name, phone, address, district, is_default) values
 ('20000000-0000-4000-8000-0000000000c1','Home','Customer One','01700000001','House 1','Dhaka',true),
 ('20000000-0000-4000-8000-0000000000c2','Home','Customer Two','01700000002','House 2','Dhaka',true);
insert into public.support_tickets (id, customer_id, store_id, order_id, category, subject, description, queue, assigned_to) values
 ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-0000000000c1','40000000-0000-4000-8000-0000000000e1','80000000-0000-4000-8000-000000000001','order','Late order','Where is my order please','store','10000000-0000-4000-8000-0000000000a1'),
 ('90000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-0000000000c2',null,null,'account','Login help','I cannot sign in to my account','platform',null);
insert into public.ticket_messages (ticket_id, sender_id, body) values
 ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-0000000000c1','Where is my order please'),
 ('90000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-0000000000c2','I cannot sign in to my account');
insert into public.returns (id, order_id, customer_id, reason, condition_description, status) values
 ('a0000000-0000-4000-8000-000000000001','80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-0000000000c1','damaged','Box arrived crushed','requested');
insert into public.notifications (user_id, type, title) values
 ('20000000-0000-4000-8000-0000000000c1','system','Hello one'),
 ('20000000-0000-4000-8000-0000000000c2','system','Hello two');
insert into storage.objects (bucket_id, name) values
 ('product-images','stores/40000000-0000-4000-8000-0000000000e1/products/60000000-0000-4000-8000-000000000001/apple.jpg'),
 ('product-images','stores/40000000-0000-4000-8000-0000000000e1/products/60000000-0000-4000-8000-000000000004/draft.jpg'),
 ('store-logos','stores/40000000-0000-4000-8000-0000000000e2/logos/logo.png'),
 ('store-logos','stores/40000000-0000-4000-8000-0000000000e3/logos/logo.png');
-- ---------------------------------------------------------------- end fixture

-- All trusted operations are invoked as the Edge Functions do: role service_role.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ================================================================ atomic order creation
select lives_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":2,"expected_unit_price":100}]',
  '{"recipient_name":"Guest Buyer","phone":"+8801755555555","address":"Road 1, Banani","district":"Dhaka"}', 'cod', 'order-key-0001')$$,
  'a guest COD order is created');
reset role;  -- assertions below read tables as the owner; 003 gives service_role no direct table access

select is((select stock_quantity from public.products where id = '60000000-0000-4000-8000-000000000001'), 8, 'stock decremented atomically');
select ok((select total_amount = 260 and subtotal = 200 and delivery_charge = 60 and payment_status = 'cod_pending'
                  and status = 'pending' and order_phone = '01755555555' and order_number ~ '^ORD-[0-9]{8}-BHQ[0-9]{6}$'
           from public.orders where idempotency_key = 'order-key-0001'),
          'order totals, COD state, normalised phone and ORD-YYYYMMDD-BHQnnnnnn number');
select ok((select count(*) = 1 and bool_and(product_name = 'Red Apple' and unit_price = 100 and subtotal = 200)
           from public.order_items where order_id = (select id from public.orders where idempotency_key = 'order-key-0001')),
          'order item snapshots name and price');
select is((select quantity_delta from public.inventory_movements
           where reason = 'sale' and reference_id = (select id from public.orders where idempotency_key = 'order-key-0001')),
          -2, 'a sale movement is written in the same transaction');
select ok((select count(*) = 1 and bool_and(event_type = 'pending' and previous_status is null) from public.delivery_events
           where order_id = (select id from public.orders where idempotency_key = 'order-key-0001')),
          'order creation records the initial pending event');
select is((select count(*)::int from public.payment_transactions
           where order_id = (select id from public.orders where idempotency_key = 'order-key-0001') and status = 'pending' and method = 'cod'),
          1, 'the initial COD payment attempt is created');
select ok((public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":2,"expected_unit_price":100}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1, Banani","district":"Dhaka"}', 'cod', 'order-key-0001') ->> 'replayed')::boolean,
  'retrying with the same idempotency key returns the original order');
select ok((select count(*) = 1 from public.orders where idempotency_key = 'order-key-0001')
          and (select stock_quantity = 8 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and (select count(*) = 1 from public.payment_transactions t join public.orders o on o.id = t.order_id where o.idempotency_key = 'order-key-0001'),
          'a retry creates no duplicate order, stock movement or payment attempt');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":3}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1, Banani","district":"Dhaka"}', 'cod', 'order-key-0001')$$,
  '23505', null, 'reusing an idempotency key for a different order is rejected');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":9}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0002')$$,
  'BQ001', null, 'overselling is refused');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1},
    {"product_id":"60000000-0000-4000-8000-000000000002","variant_id":"61000000-0000-4000-8000-000000000002","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0003')$$,
  'BQ001', null, 'a sold-out variant fails the whole order');
select ok((select stock_quantity = 8 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and not exists (select 1 from public.orders where idempotency_key = 'order-key-0003'),
          'no partial writes: the in-stock line was rolled back with the failed one');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1,"expected_unit_price":90}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0004')$$,
  'BQ002', null, 'a changed price is reported before charging (FR-C-12)');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000004","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0005')$$,
  'BQ003', null, 'draft products cannot be ordered');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000005","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0006')$$,
  'BQ003', null, 'deleted products cannot be ordered');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000003","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0007')$$,
  'BQ003', null, 'a cart cannot mix products from another store');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e3',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0008')$$,
  'BQ003', null, 'unpublished stores cannot take orders');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'nagad', 'order-key-0009')$$,
  'BQ005', null, 'only methods the store enabled can be used');
select throws_ok($$select public.create_order('10000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Merchant","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0010')$$,
  '42501', null, 'merchant accounts cannot place orders');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"12345","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0011')$$,
  '22023', null, 'an invalid Bangladeshi phone number is rejected server-side');
select throws_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000002","quantity":1}]',
  '{"recipient_name":"Guest Buyer","phone":"01755555555","address":"Road 1","district":"Dhaka"}', 'cod', 'order-key-0012')$$,
  'BQ003', null, 'a variant product needs the exact variant');
select is((public.create_order('20000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000002","variant_id":"61000000-0000-4000-8000-000000000001","quantity":2}]',
  '{"recipient_name":"Customer One","phone":"01700000001","address":"House 77, Gulshan","district":"Sylhet"}', 'bkash', 'order-key-0013', true)
  ->> 'next_action'), 'submit_wallet_reference', 'a registered bKash order asks for the wallet transaction ID');
select ok((select stock_quantity = 3 from public.product_variants where id = '61000000-0000-4000-8000-000000000001')
          and (select stock_quantity is null from public.products where id = '60000000-0000-4000-8000-000000000002'),
          'variant stock is decremented on the variant row only');
select ok((select delivery_charge = 0 + (shipping_settings ->> 'outside_dhaka_charge')::numeric
           from public.orders o join public.stores s on s.id = o.store_id where o.idempotency_key = 'order-key-0013'),
          'outside-Dhaka delivery charge comes from the store configuration');
select is((select count(*)::int from public.customer_addresses where customer_id = '20000000-0000-4000-8000-0000000000c1'), 2,
          'the new address was saved for the customer');
select throws_ok($$select public.create_payment_attempt((select id from public.orders where idempotency_key = 'order-key-0013'),
  (select id from public.payment_configs where store_id = '40000000-0000-4000-8000-0000000000e1' and method = 'bkash'),
  'bkash','bkash',(select total_amount from public.orders where idempotency_key = 'order-key-0013'),'second-attempt','{}'::jsonb,null)$$,
  '23514', null, 'a second concurrent payment attempt is refused');

-- ================================================================ canonical order transitions
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0013'), 'confirmed')$$,
  '23514', null, 'an unpaid wallet order cannot be confirmed');
select lives_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'confirmed', 'Thanks!')$$,
  'the owning merchant confirms a COD order');
select ok((select bool_or(event_type = 'confirmed' and previous_status = 'pending' and actor_id = '10000000-0000-4000-8000-0000000000a1')
           from public.delivery_events where order_id = (select id from public.orders where idempotency_key = 'order-key-0001')),
          'the transition is recorded with previous status, new status and actor');
select ok((public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'confirmed') ->> 'replayed')::boolean
  and (select count(*) = 2 from public.delivery_events where order_id = (select id from public.orders where idempotency_key = 'order-key-0001')),
  'repeating a transition is idempotent and writes no extra event');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'shipped')$$,
  '23514', null, 'steps cannot be skipped (confirmed → shipped)');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a2',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'processing')$$,
  '42501', null, 'another merchant cannot change this order');
select throws_ok($$select public.transition_order_status('30000000-0000-4000-8000-0000000000d1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'processing')$$,
  '42501', null, 'Super Admin cannot change ordinary order status');
select lives_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1', (select id from public.orders where idempotency_key = 'order-key-0001'), 'processing');
                 select public.transition_order_status('10000000-0000-4000-8000-0000000000a1', (select id from public.orders where idempotency_key = 'order-key-0001'), 'shipped', 'Courier: Pathao');
                 select public.transition_order_status('10000000-0000-4000-8000-0000000000a1', (select id from public.orders where idempotency_key = 'order-key-0001'), 'out_for_delivery')$$,
  'processing → shipped → out_for_delivery');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'cancelled', null, 'Customer changed mind')$$,
  '23514', 'Orders that are out for delivery or delivered cannot be cancelled', 'cancellation is blocked once out for delivery');

-- ================================================================ COD collection (DM-05)
select throws_ok($$select public.record_cod_collection('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 100)$$,
  '23514', null, 'the collected amount must equal the order total');
select lives_ok($$select public.record_cod_collection('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 260, 'Paid in cash')$$,
  'the merchant records actual COD collection');
select ok((select payment_status = 'cod_collected' and status = 'out_for_delivery' from public.orders where idempotency_key = 'order-key-0001')
          and (select bool_and(t.status = 'paid') from public.payment_transactions t join public.orders o on o.id = t.order_id
               where o.idempotency_key = 'order-key-0001')
          and (select count(*) = 1 from public.delivery_events e join public.orders o on o.id = e.order_id
               where o.idempotency_key = 'order-key-0001' and e.event_type = 'cod_collected' and e.cod_amount = 260),
          'COD collection is recorded separately: payment cod_collected, attempt paid, order status unchanged');
select ok((public.record_cod_collection('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 260) ->> 'replayed')::boolean,
  'recording collection again is idempotent');
select lives_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'delivered')$$, 'out_for_delivery → delivered');
select ok((select delivered_at is not null from public.orders where idempotency_key = 'order-key-0001'), 'delivery time is recorded');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0001'), 'cancelled', null, 'Too late')$$,
  '23514', null, 'a delivered order cannot be cancelled');

-- ================================================================ cancellation releases stock exactly once
select lives_ok($$select public.create_order('20000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":3}]',
  '{"recipient_name":"Customer One","phone":"01700000001","address":"House 1","district":"Dhaka"}', 'cod', 'order-key-0020')$$,
  'a second COD order reserves 3 units');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0020'), 'cancelled')$$,
  '22023', null, 'cancellation requires a reason');
select lives_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0020'), 'cancelled', null, 'Out of delivery area')$$,
  'the merchant cancels with a reason');
select ok((select stock_quantity = 8 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and (select stock_released_at is not null and cancellation_reason = 'Out of delivery area' from public.orders where idempotency_key = 'order-key-0020')
          and (select count(*) = 1 from public.inventory_movements where reason = 'cancellation_release'
               and reference_id = (select id from public.orders where idempotency_key = 'order-key-0020') and quantity_delta = 3),
          'cancellation restores stock with a cancellation_release movement');
select ok((public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0020'), 'cancelled', null, 'Again') ->> 'replayed')::boolean
  and (select stock_quantity = 8 from public.products where id = '60000000-0000-4000-8000-000000000001'),
  'cancelling again does not restore stock twice');
select ok(exists (select 1 from public.notifications where user_id = '20000000-0000-4000-8000-0000000000c1'
                  and type = 'order_status' and title = 'Order cancelled'),
          'the customer is notified of the cancellation');

-- ================================================================ wallet payments (Option B orchestration)
select throws_ok($$select public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0013'),
  'TRX12345', '20000000-0000-4000-8000-0000000000c2')$$, 'P0002', null,
  'another customer cannot submit a payment for this order (no enumeration)');
select lives_ok($$select public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0013'),
  'trx12345', '20000000-0000-4000-8000-0000000000c1')$$, 'the customer submits the bKash transaction ID');
select ok((select payment_status = 'pending_verification' from public.orders where idempotency_key = 'order-key-0013')
          and (select bool_and(t.status = 'pending_verification' and t.provider_transaction_reference = 'TRX12345')
               from public.payment_transactions t join public.orders o on o.id = t.order_id where o.idempotency_key = 'order-key-0013'),
          'a customer-submitted ID only moves payment to pending_verification, never paid');
select throws_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0013'), 'confirmed')$$,
  '23514', 'Payment is still awaiting server-side verification', 'orders awaiting verification cannot be confirmed');
select ok((public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0013'),
  'TRX12345', '20000000-0000-4000-8000-0000000000c1') ->> 'replayed')::boolean, 'resubmitting the same ID is idempotent');
select throws_ok($$select public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0013'),
  'TRX99999', '20000000-0000-4000-8000-0000000000c1')$$, '23514', null, 'a different ID cannot replace one under verification');
select throws_ok($$select public.submit_wallet_reference('80000000-0000-4000-8000-000000000002', 'TRX12345', '20000000-0000-4000-8000-0000000000c2')$$,
  '23505', 'This transaction ID has already been used', 'a provider transaction ID cannot be reused on another order');
select throws_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0013'), 'paid', 'manual_review', null, '10000000-0000-4000-8000-0000000000a2', 'Looks fine')$$,
  '42501', null, 'only the owning merchant or a Super Admin may manually review');
select throws_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0013'), 'paid', 'manual_review', null, '10000000-0000-4000-8000-0000000000a1', null)$$,
  '22023', null, 'manual review requires a reason');
select lives_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0013'), 'paid', 'manual_review', null, '10000000-0000-4000-8000-0000000000a1',
  'Matched TRX12345 in the bKash merchant statement')$$, 'the owning merchant records a manual verification');
select ok((select payment_status = 'paid' from public.orders where idempotency_key = 'order-key-0013')
          and exists (select 1 from public.audit_logs where action = 'order.payment_status_changed'
                      and resource_id = (select id from public.orders where idempotency_key = 'order-key-0013')
                      and metadata ->> 'new_status' = 'paid' and metadata ->> 'source' = 'manual_review'),
          'order and attempt become paid together, and the change is audited');
select lives_ok($$select public.transition_order_status('10000000-0000-4000-8000-0000000000a1',
  (select id from public.orders where idempotency_key = 'order-key-0013'), 'confirmed')$$, 'a paid order can be confirmed');

-- Definitive failure, retry, then cancellation releases stock with payment_failure_release.
select lives_ok($$select public.create_order('20000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Customer One","phone":"01700000001","address":"House 1","district":"Dhaka"}', 'bkash', 'order-key-0030');
  select public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0030'), 'FAILREF01', '20000000-0000-4000-8000-0000000000c1');
  select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
    where o.idempotency_key = 'order-key-0030'), 'failed', 'provider_verification')$$,
  'a provider-confirmed failure is recorded');
select is((select payment_status from public.orders where idempotency_key = 'order-key-0030'), 'failed', 'the order payment is marked failed');
select is((select stock_quantity from public.products where id = '60000000-0000-4000-8000-000000000001'), 7,
          'a failed payment does not silently release stock (no unapproved timeout rule)');
select lives_ok($$select public.submit_wallet_reference((select id from public.orders where idempotency_key = 'order-key-0030'),
  'RETRYREF02', '20000000-0000-4000-8000-0000000000c1')$$, 'the customer can retry with a new transaction ID');
select is((select count(*)::int from public.payment_transactions t join public.orders o on o.id = t.order_id
           where o.idempotency_key = 'order-key-0030'), 2, 'the retry is a new payment attempt');
select lives_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
    where o.idempotency_key = 'order-key-0030' and t.status = 'pending_verification'), 'failed', 'provider_verification');
  select public.transition_order_status('10000000-0000-4000-8000-0000000000a1', (select id from public.orders where idempotency_key = 'order-key-0030'),
    'cancelled', null, 'Payment failed twice')$$, 'the merchant cancels the unpaid order');
select ok((select stock_quantity = 8 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and exists (select 1 from public.inventory_movements where reason = 'payment_failure_release'
                      and reference_id = (select id from public.orders where idempotency_key = 'order-key-0030')),
          'stock is restored once, recorded as payment_failure_release');

-- SSLCommerz: only the verified webhook confirms; amount and source are checked; replays are harmless.
select lives_ok($$select public.create_order(null, '40000000-0000-4000-8000-0000000000e1',
  '[{"product_id":"60000000-0000-4000-8000-000000000001","quantity":1}]',
  '{"recipient_name":"Card Buyer","phone":"01788888888","address":"Road 5","district":"Dhaka"}', 'sslcommerz', 'order-key-0040')$$,
  'a card order is created');
select is((public.prepare_sslcommerz_payment((select id from public.orders where idempotency_key = 'order-key-0040'), null, '01788888888', 'ssl-session-0001')
           ->> 'transaction_id')::uuid,
          (select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id where o.idempotency_key = 'order-key-0040'),
          'the gateway session reuses the pending attempt (no duplicate)');
select throws_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0040'), 'paid', 'sslcommerz_webhook', 'SSL-VAL-1', null, null, 1.00)$$,
  '23514', null, 'a webhook amount that differs from the order total is rejected');
select lives_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0040'), 'paid', 'sslcommerz_webhook', 'SSL-VAL-1', null, null, 160.00)$$,
  'a verified webhook marks the card payment paid');
select ok((public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0040'), 'paid', 'sslcommerz_webhook', 'SSL-VAL-1', null, null, 160.00) ->> 'replayed')::boolean,
  'a replayed webhook is idempotent');
select throws_ok($$select public.apply_payment_result((select t.id from public.payment_transactions t join public.orders o on o.id = t.order_id
  where o.idempotency_key = 'order-key-0013'), 'paid', 'sslcommerz_webhook', 'X', null, null, null)$$,
  '23514', null, 'the SSLCommerz webhook path cannot settle a wallet payment');
reset role;

-- A user JWT can never reach the payment functions.
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.apply_payment_result(gen_random_uuid(), 'paid', 'manual_review', null, '20000000-0000-4000-8000-0000000000c1', 'trust me')$$,
  '42501', null, 'a client cannot mark a payment paid');
select throws_ok($$select public.submit_wallet_reference('80000000-0000-4000-8000-000000000003', 'ABC12345', '20000000-0000-4000-8000-0000000000c1')$$,
  '42501', null, 'clients reach payment submission only through the Edge Function');
reset role;

-- ================================================================ public tracking (API-32)
select is((public.track_order((select order_number from public.orders where idempotency_key = 'order-key-0001'), '01755555555') ->> 'status'),
          'delivered', 'tracking with Order ID + phone returns the status');
select is(public.track_order((select order_number from public.orders where idempotency_key = 'order-key-0001'), '01700000000'), null,
          'a wrong phone returns the same empty answer as an unknown order');
select is(public.track_order('ORD-20000101-BHQ000001', '01755555555'), null, 'an unknown order number returns nothing');
select is((public.track_order((select order_number from public.orders where idempotency_key = 'order-key-0001'), '01755555555')
           -> 'merchant_contact' ->> 'phone'), '01711111111', 'tracking shows only the merchant phone/email as contact');

-- ================================================================ inventory adjustments (FR-M-22-INV)
select throws_ok($$select public.adjust_inventory('10000000-0000-4000-8000-0000000000a1','60000000-0000-4000-8000-000000000001',null,-100,'Damaged stock','adj-key-0001')$$,
  'BQ001', null, 'stock can never go negative');
select throws_ok($$select public.adjust_inventory('10000000-0000-4000-8000-0000000000a1','60000000-0000-4000-8000-000000000001',null,-1,'','adj-key-0002')$$,
  '22023', null, 'manual adjustments need a note');
select throws_ok($$select public.adjust_inventory('10000000-0000-4000-8000-0000000000a2','60000000-0000-4000-8000-000000000001',null,5,'Restock','adj-key-0003')$$,
  'P0002', null, 'another merchant cannot adjust this product');
select lives_ok($$select public.adjust_inventory('10000000-0000-4000-8000-0000000000a1','60000000-0000-4000-8000-000000000001',null,-6,'Spoiled crate','adj-key-0004')$$,
  'the owner adjusts stock down');
-- Stock history for Red Apple: 10 −2 (order 1) −3 +3 (order 2 cancelled) −1 +1 (order 3 failed, cancelled) −1 (card order) = 7.
select ok((select stock_quantity = 1 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and exists (select 1 from public.inventory_movements where idempotency_key = 'adj-key-0004' and reason = 'manual_adjustment'
                      and actor_id = '10000000-0000-4000-8000-0000000000a1' and note = 'Spoiled crate'),
          'the adjustment is in the ledger with actor and note');
select ok(exists (select 1 from public.notifications where user_id = '10000000-0000-4000-8000-0000000000a1' and type = 'low_stock'),
          'crossing the low-stock threshold notifies the merchant');
select ok((public.adjust_inventory('10000000-0000-4000-8000-0000000000a1','60000000-0000-4000-8000-000000000001',null,-6,'Spoiled crate','adj-key-0004') ->> 'replayed')::boolean
          and (select stock_quantity = 1 from public.products where id = '60000000-0000-4000-8000-000000000001'),
          'retrying an adjustment with the same key does not apply it twice');
select throws_ok($$select public.adjust_inventory('10000000-0000-4000-8000-0000000000a1','60000000-0000-4000-8000-000000000001',null,4,'Other','adj-key-0004')$$,
  '23505', null, 'an idempotency key cannot be reused for a different adjustment');
reset role;

-- ================================================================ merchant catalogue functions (actor = auth.uid())
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select public.create_product('{"name":"Mango","description":"Himsagar mangoes","category_id":"50000000-0000-4000-8000-0000000000f1",
  "base_price":150,"compare_at_price":180,"product_type":"simple","stock_quantity":7,"status":"active","sku":"MNG-1"}')$$,
  'a merchant creates a simple product with opening stock');
select ok((select stock_quantity = 7 and compare_at_price = 180 from public.products where sku = 'MNG-1')
          and exists (select 1 from public.inventory_movements m join public.products p on p.id = m.product_id
                      where p.sku = 'MNG-1' and m.quantity_delta = 7 and m.note = 'Opening stock'),
          'opening stock goes through the ledger');
select lives_ok($$select public.create_product('{"name":"Hoodie","description":"Warm hoodie","category_id":"50000000-0000-4000-8000-0000000000f1",
  "base_price":900,"product_type":"variant","status":"draft","variants":[{"variant_label":"S","stock_quantity":4},{"variant_label":"L","price_adjustment":100,"stock_quantity":0}]}')$$,
  'a merchant creates a variant product and its variants atomically');
select ok((select p.stock_quantity is null and count(v.*) = 2 and sum(v.stock_quantity) = 4
           from public.products p join public.product_variants v on v.product_id = p.id where p.name = 'Hoodie' group by p.stock_quantity),
          'variant stock lives on variants; product stock is NULL');
select throws_ok($$select public.create_product('{"name":"Empty","description":"No variants","category_id":"50000000-0000-4000-8000-0000000000f1",
  "base_price":10,"product_type":"variant","variants":[]}')$$, '22023', null, 'a variant product needs at least one variant');
select throws_ok($$select public.create_product('{"name":"Cheap","description":"Bad compare","category_id":"50000000-0000-4000-8000-0000000000f1",
  "base_price":100,"compare_at_price":90,"product_type":"simple","stock_quantity":1}')$$, '22023', null,
  'the original price must be above the base price');
select throws_ok($$select public.create_product('{"name":"Wrong store","description":"Other category","category_id":"50000000-0000-4000-8000-0000000000f2",
  "base_price":100,"product_type":"simple","stock_quantity":1}')$$, '22023', null, 'categories must belong to the merchant''s store');
select lives_ok($$select public.duplicate_product((select id from public.products where sku = 'MNG-1'), '{"copy_sku":true}')$$,
                'duplicate a product');
select ok((select status = 'draft' and stock_quantity = 0 and compare_at_price = 180 from public.products where sku = 'MNG-1-COPY'),
          'the copy is a draft with stock 0 and a unique SKU (FR-M-19)');
select throws_ok($$select public.update_product((select id from public.products where sku = 'MNG-1'),
  '{"name":"Mango","description":"Himsagar mangoes","category_id":"50000000-0000-4000-8000-0000000000f1","base_price":150,"product_type":"variant"}')$$,
  '23514', null, 'the simple/variant stock model cannot be switched in place');
select lives_ok($$select public.delete_product((select id from public.products where sku = 'MNG-1'))$$, 'soft delete');
reset role;
select ok((select deleted_at is not null and status = 'inactive' from public.products where name = 'Mango' and sku = 'MNG-1'),
          'deleted products are kept for order history');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.create_product('{"name":"Hack","description":"x","category_id":"50000000-0000-4000-8000-0000000000f1","base_price":1,"product_type":"simple","stock_quantity":1}')$$,
  '42501', null, 'customers cannot create products');
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a3","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.publish_store()$$, '23514', null, 'a store without a payment method and checklist cannot be published');
reset role;

select * from finish();
rollback;
