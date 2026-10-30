-- Returns (§14.1), refunds (§14.2) and support tickets (§15): eligibility, review, restock-once,
-- refund evidence and immutability, disputes, routing, 72-hour escalation and audit. Rolled back.
begin;
select plan(84);

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

-- Extra delivered orders: O5 delivered 10 days ago (outside the 7-day window), O6 delivered 2 days ago (bKash, paid),
-- O7 delivered 3 days ago (for the rejection/dispute path).
insert into public.orders (id, store_id, customer_id, order_phone, status, total_amount, delivery_charge, payment_method, payment_status, delivery_address, delivered_at) values
 ('80000000-0000-4000-8000-000000000005','40000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000c1','01700000001','delivered',160,60,'bkash','paid','{"recipient_name":"Customer One","address":"House 1","district":"Dhaka"}',now() - interval '10 days'),
 ('80000000-0000-4000-8000-000000000006','40000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000c1','01700000001','delivered',460,60,'bkash','paid','{"recipient_name":"Customer One","address":"House 1","district":"Dhaka"}',now() - interval '2 days'),
 ('80000000-0000-4000-8000-000000000007','40000000-0000-4000-8000-0000000000e1','20000000-0000-4000-8000-0000000000c1','01700000001','delivered',160,60,'bkash','paid','{"recipient_name":"Customer One","address":"House 1","district":"Dhaka"}',now() - interval '3 days');
insert into public.order_items (order_id, product_id, variant_id, product_name, variant_label, quantity, unit_price, subtotal) values
 ('80000000-0000-4000-8000-000000000005','60000000-0000-4000-8000-000000000001',null,'Red Apple',null,1,100,100),
 ('80000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000001',null,'Red Apple',null,1,100,100),
 ('80000000-0000-4000-8000-000000000006','60000000-0000-4000-8000-000000000002','61000000-0000-4000-8000-000000000001','T-Shirt','M',1,300,300),
 ('80000000-0000-4000-8000-000000000007','60000000-0000-4000-8000-000000000001',null,'Red Apple',null,1,100,100);

-- ================================================================ return eligibility (FR-RET-01..04)
select throws_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c2','80000000-0000-4000-8000-000000000002','damaged','The box was crushed badly')$$,
  '23514', 'Returns are available after the order is delivered', 'returns need a delivered order');
select throws_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000005','damaged','The box was crushed badly')$$,
  '23514', 'The 7-day return window for this order has ended', 'the store''s return window is enforced server-side');
select throws_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c2','80000000-0000-4000-8000-000000000006','damaged','The box was crushed badly')$$,
  'P0002', null, 'a customer cannot request a return on someone else''s order');
select throws_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000006','broken','The box was crushed badly')$$,
  '22023', null, 'a return reason from the SRS list is required');
select lives_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000006','not_as_described','Colour is different from the photo')$$,
  'an eligible return is requested');
select ok((select return_number ~ '^RET-[0-9]{8}-BHQ[0-9]{6}$' and status = 'requested' and refund_amount_requested = 460
           from public.returns where order_id = '80000000-0000-4000-8000-000000000006')
          and exists (select 1 from public.notifications where user_id = '10000000-0000-4000-8000-0000000000a1' and type = 'return'),
          'the return gets a RET number and the merchant is notified');
select throws_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000006','other','Trying a second time here')$$,
  '23505', null, 'only one return per order');
update public.stores set return_window_days = 30 where id = '40000000-0000-4000-8000-0000000000e1';
select lives_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000005','damaged','The box was crushed badly')$$,
  'a longer merchant-configured window is honoured');
update public.stores set return_window_days = 7 where id = '40000000-0000-4000-8000-0000000000e1';

-- Evidence photo
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.attach_return_evidence((select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),
  'returns/' || (select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006') || '/photo.jpg')$$,
  '22023', 'Upload the photo first', 'evidence must exist in Storage before it is attached');
reset role;
insert into storage.objects (bucket_id, name)
select 'return-evidence', 'returns/' || id || '/photo.jpg' from public.returns where order_id = '80000000-0000-4000-8000-000000000006';
set local role authenticated;
select lives_ok($$select public.attach_return_evidence((select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),
  'returns/' || (select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006') || '/photo.jpg')$$,
  'the uploaded photo is attached');
select throws_ok($$select public.attach_return_evidence((select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),
  'returns/' || (select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006') || '/photo.jpg')$$,
  '23514', null, 'evidence is attached once');
reset role;

-- ================================================================ merchant review, receipt and restock (FR-RET-05..08)
select throws_ok($$select public.decide_return('10000000-0000-4000-8000-0000000000a2',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),'approved')$$,
  '42501', null, 'another merchant cannot review this return');
select throws_ok($$select public.decide_return('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000005'),'rejected')$$,
  '22023', null, 'rejection requires a reason');
select lives_ok($$select public.decide_return('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),
  'approved', null, 'merchant_coordinated')$$, 'the owner approves with a return method');
select ok((select status = 'approved' and decided_at is not null and return_method = 'merchant_coordinated'
           from public.returns where order_id = '80000000-0000-4000-8000-000000000006'), 'approval is recorded');
select throws_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),460,'original_method')$$,
  '23514', null, 'no refund before the returned item is received (FR-REF-01)');
select lives_ok($$select public.confirm_return_receipt('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),true,'Unworn, tags on')$$,
  'receipt confirmed with restock');
select ok((select stock_quantity = 11 from public.products where id = '60000000-0000-4000-8000-000000000001')
          and (select stock_quantity = 6 from public.product_variants where id = '61000000-0000-4000-8000-000000000001')
          and (select count(*) = 2 from public.inventory_movements where reason = 'return'
               and reference_id = (select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006')),
          'returned items are restocked with reason "return" for each stock owner');
select lives_ok($$select public.confirm_return_receipt('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),true)$$,
  'confirming receipt again is harmless');
select is((select stock_quantity from public.products where id = '60000000-0000-4000-8000-000000000001'), 11, 'stock is restored only once');

-- ================================================================ refunds (FR-REF-01..07)
select throws_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),9999,'original_method')$$,
  '22023', null, 'a refund cannot exceed the order total');
select lives_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),460,'original_method')$$,
  'the merchant initiates the refund');
select lives_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),460,'original_method')$$,
  'repeating the same refund request is idempotent');
select throws_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000006'),400,'bkash')$$,
  '23505', null, 'one refund per return');
select throws_ok($$select public.update_refund_status('10000000-0000-4000-8000-0000000000a1',
  (select f.id from public.refunds f join public.returns r on r.id = f.return_id where r.order_id = '80000000-0000-4000-8000-000000000006'), 'completed')$$,
  '22023', null, 'completion needs provider or settlement evidence');
select lives_ok($$select public.update_refund_status('10000000-0000-4000-8000-0000000000a1',
  (select f.id from public.refunds f join public.returns r on r.id = f.return_id where r.order_id = '80000000-0000-4000-8000-000000000006'), 'processing', null, 'Sent to bKash');
  select public.update_refund_status('10000000-0000-4000-8000-0000000000a1',
  (select f.id from public.refunds f join public.returns r on r.id = f.return_id where r.order_id = '80000000-0000-4000-8000-000000000006'), 'completed', 'BK-RF-7781', 'Refunded')$$,
  'processing → completed with a settlement reference');
select ok((select f.status = 'completed' and f.processed_at is not null and f.confirmation_reference = 'BK-RF-7781'
           from public.refunds f join public.returns r on r.id = f.return_id where r.order_id = '80000000-0000-4000-8000-000000000006')
          and (select status = 'closed' from public.returns where order_id = '80000000-0000-4000-8000-000000000006')
          and (select payment_status = 'refunded' from public.orders where id = '80000000-0000-4000-8000-000000000006'),
          'a completed refund closes the return and marks the order payment refunded');
select is((select count(*)::int from public.audit_logs a join public.refunds f on f.id = a.resource_id join public.returns r on r.id = f.return_id
           where r.order_id = '80000000-0000-4000-8000-000000000006' and a.action = 'refund.status_changed'),
          3, 'every refund status change is in the immutable audit history');
select throws_ok($$update public.refunds set amount = 1 where status = 'completed'$$, '55000', null, 'refund facts are immutable');
select throws_ok($$delete from public.refunds$$, '55000', null, 'refund history cannot be deleted');
select throws_ok($$select public.update_refund_status('10000000-0000-4000-8000-0000000000a1',
  (select f.id from public.refunds f join public.returns r on r.id = f.return_id where r.order_id = '80000000-0000-4000-8000-000000000006'), 'failed', null, 'oops')$$,
  '23514', null, 'a completed refund is terminal');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(jsonb_array_length(public.refund_timeline((select f.id from public.refunds f join public.returns r on r.id = f.return_id
          where r.order_id = '80000000-0000-4000-8000-000000000006'))), 3, 'the customer sees the refund timeline');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(jsonb_array_length(public.refund_timeline((select f.id from public.refunds f join public.returns r on r.id = f.return_id
          where r.order_id = '80000000-0000-4000-8000-000000000006'))), 0, 'other customers see nothing');
reset role;

-- COD refunds go by bank transfer or wallet (FR-REF-03); Super Admin intervention is audited (FR-REF-07).
select lives_ok($$select public.decide_return('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001','approved','Sorry about that','customer_drop_off');
                 select public.confirm_return_receipt('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001',false)$$,
  'COD return approved and received without restock');
select throws_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001',260,'original_method')$$,
  '23514', null, 'COD orders cannot be refunded to the original method');
select lives_ok($$select public.create_refund('10000000-0000-4000-8000-0000000000a1','a0000000-0000-4000-8000-000000000001',260,'bank_transfer')$$,
  'COD refund by bank transfer');
select throws_ok($$select public.admin_intervene_refund('10000000-0000-4000-8000-0000000000a1',
  (select id from public.refunds where return_id = 'a0000000-0000-4000-8000-000000000001'),'settle','BANK-1','Merchant tried admin path')$$,
  '42501', null, 'the intervention path is Super Admin only');
select lives_ok($$select public.admin_intervene_refund('30000000-0000-4000-8000-0000000000d1',
  (select id from public.refunds where return_id = 'a0000000-0000-4000-8000-000000000001'),'settle','BANK-TRX-42','Stalled 5 days; settled with bank evidence')$$,
  'a Super Admin settles a stalled refund with evidence');
select ok(exists (select 1 from public.audit_logs where action = 'refund.admin_intervention'
                  and actor_id = '30000000-0000-4000-8000-0000000000d1'
                  and resource_id = (select id from public.refunds where return_id = 'a0000000-0000-4000-8000-000000000001')),
          'the intervention is audited with the admin as actor');

-- ================================================================ rejection, escalation and dispute (FR-RET-09, FR-SA-21)
select lives_ok($$select public.request_return('20000000-0000-4000-8000-0000000000c1','80000000-0000-4000-8000-000000000007','change_of_mind','I no longer need this item')$$,
  'a return on another delivered order');
select throws_ok($$select public.escalate_return('20000000-0000-4000-8000-0000000000c1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'),'Please review my request')$$,
  '23514', null, 'only rejected returns can be escalated');
select lives_ok($$select public.decide_return('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'),'rejected','Opened food items cannot be returned')$$,
  'the merchant rejects with a reason');
select lives_ok($$select public.escalate_return('20000000-0000-4000-8000-0000000000c1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'),'The item was sealed and unopened')$$,
  'the customer escalates the rejection');
select ok((select dispute_status = 'open' and escalated_at is not null from public.returns where order_id = '80000000-0000-4000-8000-000000000007')
          and exists (select 1 from public.notifications where user_id = '30000000-0000-4000-8000-0000000000d1' and type = 'dispute'),
          'the dispute is open and Super Admins are notified');
select throws_ok($$select public.close_return('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'))$$,
  '23514', null, 'the merchant cannot close a return under review');
select throws_ok($$select public.admin_resolve_return_dispute('10000000-0000-4000-8000-0000000000a1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'),'override','Merchant override')$$,
  '42501', null, 'only Super Admins resolve disputes');
select lives_ok($$select public.admin_resolve_return_dispute('30000000-0000-4000-8000-0000000000d1',(select id from public.returns where order_id = '80000000-0000-4000-8000-000000000007'),'override','Photos show the seal intact')$$,
  'a Super Admin overrides the merchant decision');
select ok((select status = 'approved' and dispute_status = 'resolved' and dispute_decision = 'overridden'
           from public.returns where order_id = '80000000-0000-4000-8000-000000000007')
          and exists (select 1 from public.audit_logs where action = 'dispute.override' and actor_id = '30000000-0000-4000-8000-0000000000d1'),
          'the override is applied and audited');

-- ================================================================ support tickets (§15)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.create_support_ticket('other','Merchant ticket','Merchants cannot submit tickets here')$$,
  '42501', null, 'merchants cannot submit tickets (SRS §4.3)');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.create_support_ticket('order','Missing item','One item was missing from my box')$$,
  '22023', 'Choose the order this is about', 'store-related tickets need the order');
select lives_ok($$select public.create_support_ticket('delivery','Courier never came','The courier did not arrive as promised','urgent','80000000-0000-4000-8000-000000000006')$$,
  'a delivery ticket is created');
reset role;
select ok((select queue = 'store' and assigned_to = '10000000-0000-4000-8000-0000000000a1' and ticket_number ~ '^TKT-[0-9]{8}-BHQ[0-9]{6}$'
                  and priority = 'urgent' and status = 'open'
           from public.support_tickets where subject = 'Courier never came')
          and (select count(*) = 1 from public.ticket_messages m join public.support_tickets t on t.id = m.ticket_id where t.subject = 'Courier never came')
          and exists (select 1 from public.ticket_audit_log a join public.support_tickets t on t.id = a.ticket_id
                      where t.subject = 'Courier never came' and a.event_type = 'created'),
          'store tickets route to the active merchant with a TKT number, first message and audit entry');
set local role authenticated;
select lives_ok($$select public.create_support_ticket('account','Password reset email','I never receive the reset email')$$, 'an account ticket');
reset role;
select ok((select queue = 'platform' and assigned_to is null from public.support_tickets where subject = 'Password reset email'),
          'platform tickets go to the Super Admin queue');
update public.profiles set status = 'suspended' where id = '10000000-0000-4000-8000-0000000000a2';
set local role authenticated;
select lives_ok($$select public.create_support_ticket('order','Order on hold','Shop B has not replied at all','normal','80000000-0000-4000-8000-000000000003')$$,
  'a ticket for a store whose merchant is inactive');
reset role;
select is((select queue from public.support_tickets where subject = 'Order on hold'), 'platform',
          'tickets for an inactive merchant route to the Super Admin queue');
update public.profiles set status = 'active' where id = '10000000-0000-4000-8000-0000000000a2';

-- Replies, first response and workflow
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select public.reply_to_ticket((select id from public.support_tickets where subject = 'Courier never came'), 'We are checking with the courier.')$$,
  'the assigned merchant replies');
select lives_ok($$select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'in_progress');
                 select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'waiting_for_customer')$$,
  'open → in_progress → waiting_for_customer');
select throws_ok($$select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'closed')$$,
  '23514', null, 'tickets cannot jump to closed');
reset role;
select ok((select first_merchant_response_at is not null from public.support_tickets where subject = 'Courier never came'),
          'the first public merchant reply is timestamped');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$select public.reply_to_ticket((select id from public.support_tickets where subject = 'Courier never came'), 'Still waiting, please help.')$$,
  'the customer replies');
reset role;
select is((select status from public.support_tickets where subject = 'Courier never came'), 'in_progress',
          'a customer reply moves Waiting for Customer → In Progress');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'resolved')$$,
  '22023', null, 'resolving needs a resolution note');
select lives_ok($$select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'resolved', 'Delivered on the second attempt');
                 select public.update_ticket_status((select id from public.support_tickets where subject = 'Courier never came'), 'closed')$$,
  'resolved → closed');
select throws_ok($$select public.reply_to_ticket((select id from public.support_tickets where subject = 'Courier never came'), 'one more thing')$$,
  '23514', null, 'closed tickets are read-only');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.set_ticket_priority((select id from public.support_tickets where subject = 'Courier never came'), 'normal')$$,
  '23514', null, 'priority cannot change after resolution');
select lives_ok($$select public.reopen_ticket((select id from public.support_tickets where subject = 'Courier never came'))$$,
  'the customer reopens within 7 days');
reset role;
select ok((select status = 'open' and closed_at is null from public.support_tickets where subject = 'Courier never came')
          and (select count(*) >= 3 from public.ticket_messages m join public.support_tickets t on t.id = m.ticket_id where t.subject = 'Courier never came'),
          'reopening keeps the full history');
update public.support_tickets set status = 'resolved', resolution_note = 'done' where subject = 'Courier never came';
update public.support_tickets set status = 'closed', closed_at = now() - interval '8 days' where subject = 'Courier never came';
set local role authenticated;
select throws_ok($$select public.reopen_ticket((select id from public.support_tickets where subject = 'Courier never came'))$$,
  '23514', null, 'reopening is limited to 7 days after closure');

-- 72-hour escalation (FR-SUP-10)
select lives_ok($$select public.create_support_ticket('payment','Charged twice','I was charged twice for one order','normal','80000000-0000-4000-8000-000000000005')$$,
  'a payment ticket');
select throws_ok($$select public.escalate_ticket((select id from public.support_tickets where subject = 'Charged twice'))$$,
  '23514', null, 'escalation is not available before 72 hours');
reset role;
update public.support_tickets set created_at = now() - interval '73 hours' where subject = 'Charged twice';
set local role authenticated;
select lives_ok($$select public.escalate_ticket((select id from public.support_tickets where subject = 'Charged twice'))$$,
  'after 72 hours without a merchant reply the customer escalates');
select throws_ok($$select public.escalate_ticket((select id from public.support_tickets where subject = 'Charged twice'))$$,
  '23514', null, 'a ticket is escalated once');
reset role;
select ok((select queue = 'platform' and assigned_to is null and escalation_at is not null and dispute_status = 'open'
           from public.support_tickets where subject = 'Charged twice'), 'escalation moves the ticket to the Super Admin queue');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.support_tickets where subject = 'Charged twice'), 0,
          'after escalation the ticket leaves the merchant queue');
reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.5"}', true);
set local role authenticated;
select lives_ok($$select public.admin_assign_ticket((select id from public.support_tickets where subject = 'Charged twice'), '10000000-0000-4000-8000-0000000000a1')$$,
  'a Super Admin reassigns the ticket to the store');
reset role;
select ok((select created_at < now() - interval '72 hours' and queue = 'store' from public.support_tickets where subject = 'Charged twice'),
          'reassignment does not reset the 72-hour timer');
set local role authenticated;
select lives_ok($$select public.admin_resolve_ticket_dispute((select id from public.support_tickets where subject = 'Charged twice'), 'request_info', 'Please share the bank statement')$$,
  'a Super Admin requests more information');
reset role;
select ok((select status = 'waiting_for_customer' and dispute_status = 'info_requested' from public.support_tickets where subject = 'Charged twice')
          and exists (select 1 from public.audit_logs where action = 'dispute.request_info' and actor_id = '30000000-0000-4000-8000-0000000000d1'),
          'dispute actions update the ticket and are audited');
select set_config('request.headers', '', true);

-- Thread privacy and immutable history
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.get_ticket_thread((select id from public.support_tickets where subject = 'Courier never came'))$$,
  'P0002', null, 'other customers cannot read a ticket thread');
select throws_ok($$select public.reply_to_ticket('90000000-0000-4000-8000-000000000001', 'Not my ticket')$$, '42501', null,
  'non-participants cannot reply');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok((select bool_and(m ->> 'sender_name' is not null) and count(*) >= 3
           from jsonb_array_elements(public.get_ticket_thread((select id from public.support_tickets where subject = 'Courier never came')) -> 'messages') m),
          'participants get the thread with sender names');
reset role;
select throws_ok($$update public.ticket_messages set body = 'edited'$$, '55000', null, 'ticket messages are append-only');
select throws_ok($$delete from public.ticket_audit_log$$, '55000', null, 'the ticket audit log is append-only');

select * from finish();
rollback;
