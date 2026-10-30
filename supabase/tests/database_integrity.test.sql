-- pgTAP integrity tests. Run only in a disposable local Supabase database.
begin;
select plan(22);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('11000000-0000-4000-8000-000000000001','authenticated','authenticated','integrity-merchant@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Integrity Merchant"}'::jsonb,now(),now()),
 ('22000000-0000-4000-8000-000000000001','authenticated','authenticated','integrity-customer@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Integrity Customer"}'::jsonb,now(),now()),
 ('33000000-0000-4000-8000-000000000001','authenticated','authenticated','integrity-admin@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Integrity Admin"}'::jsonb,now(),now());
update public.profiles set role='merchant' where id='11000000-0000-4000-8000-000000000001';
update public.profiles set role='super_admin' where id='33000000-0000-4000-8000-000000000001';
insert into public.stores (id,owner_id,name,subdomain,status)
values ('44000000-0000-4000-8000-000000000001','11000000-0000-4000-8000-000000000001','Integrity Store','integrity-store','published');
insert into public.categories (id,store_id,name,slug)
values ('55000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','Integrity Category','integrity-category');

-- Simple stock representation is valid.
insert into public.products (id,store_id,name,description,category_id,base_price,product_type,stock_quantity,status)
values ('66000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001','Simple Item','',
 '55000000-0000-4000-8000-000000000001',10,'simple',3,'draft');
set constraints products_stock_model_ct, product_variants_stock_model_ct immediate;
select ok((select stock_quantity=3 and product_type='simple' from public.products where id='66000000-0000-4000-8000-000000000001'), 'simple product uses products.stock_quantity');
set constraints products_stock_model_ct, product_variants_stock_model_ct immediate;
select throws_ok($$insert into public.product_variants(product_id,variant_label,stock_quantity) values ('66000000-0000-4000-8000-000000000001','illegal variant',2)$$,'23514',null,'simple products cannot have variants');
set constraints products_stock_model_ct, product_variants_stock_model_ct deferred;

-- Variant product has NULL product stock and one or more variant rows in one transaction.
insert into public.products (id,store_id,name,description,category_id,base_price,product_type,stock_quantity,status)
values ('66000000-0000-4000-8000-000000000002','44000000-0000-4000-8000-000000000001','Variant Item','',
 '55000000-0000-4000-8000-000000000001',10,'variant',null,'draft');
insert into public.product_variants(product_id,variant_label,stock_quantity)
values ('66000000-0000-4000-8000-000000000002','Small',2);
set constraints products_stock_model_ct, product_variants_stock_model_ct immediate;
select ok((select stock_quantity is null from public.products where id='66000000-0000-4000-8000-000000000002')
  and (select count(*)=1 from public.product_variants where product_id='66000000-0000-4000-8000-000000000002'), 'variant product stock lives only on variant rows');
set constraints products_stock_model_ct, product_variants_stock_model_ct deferred;
select throws_ok($$insert into public.products (store_id,name,description,category_id,base_price,product_type,stock_quantity,status) values ('44000000-0000-4000-8000-000000000001','Bad Variant','', '55000000-0000-4000-8000-000000000001',10,'variant',2,'draft')$$,'23514',null,'variant products cannot hold product-level stock');

-- Address cap and one-default invariant.
insert into public.customer_addresses(customer_id,label,recipient_name,phone,address,district,is_default)
values ('22000000-0000-4000-8000-000000000001','Home','Customer','01700000001','Address 1','Dhaka',true);
select throws_ok($$insert into public.customer_addresses(customer_id,label,recipient_name,phone,address,district,is_default) values ('22000000-0000-4000-8000-000000000001','Second Default','Customer','01700000001','Address 2','Dhaka',true)$$,'23505',null,'at most one saved address can be default');
insert into public.customer_addresses(customer_id,label,recipient_name,phone,address,district,is_default)
values
 ('22000000-0000-4000-8000-000000000001','Office','Customer','01700000001','Address 2','Dhaka',false),
 ('22000000-0000-4000-8000-000000000001','Other','Customer','01700000001','Address 3','Dhaka',false);
select throws_ok($$insert into public.customer_addresses(customer_id,label,recipient_name,phone,address,district) values ('22000000-0000-4000-8000-000000000001','Fourth','Customer','01700000001','Address 4','Dhaka')$$,'23514',null,'fourth saved address is rejected');

-- Ticket audit history cannot be edited/deleted by application SQL roles.
insert into public.support_tickets(id,customer_id,category,subject,description,status)
values ('77000000-0000-4000-8000-000000000001','22000000-0000-4000-8000-000000000001','account','Test ticket','Test description','open');
insert into public.ticket_audit_log(ticket_id,actor_id,event_type,metadata)
values ('77000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001','created','{}'::jsonb);
select throws_ok($$update public.ticket_audit_log set event_type='closed' where ticket_id='77000000-0000-4000-8000-000000000001'$$,'55000',null,'ticket audit entries are immutable');

-- Policy submitter and approver must be distinct Super Admins.
select throws_ok($$insert into public.policies(type,version,content,effective_date,submitted_by,approved_by,approved_at,status) values ('privacy','test-1','test policy',current_date,'33000000-0000-4000-8000-000000000001','33000000-0000-4000-8000-000000000001',now(),'approved')$$,'23514',null,'policy submitter cannot approve own version');

-- Option B payment lifecycle: idempotent creation, trusted status transitions, immutable facts, audit.
insert into public.payment_configs (store_id, method, is_enabled)
values ('44000000-0000-4000-8000-000000000001','bkash',true);
insert into public.orders (id,store_id,customer_id,order_phone,status,total_amount,payment_method,payment_status,delivery_address)
values ('88000000-0000-4000-8000-000000000001','44000000-0000-4000-8000-000000000001',
 '22000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','pending',
 '{"address":"Payment Test","district":"Dhaka"}'::jsonb);
select lives_ok($$select public.create_payment_attempt(
 '88000000-0000-4000-8000-000000000001',
 (select id from public.payment_configs where store_id='44000000-0000-4000-8000-000000000001' and method='bkash'),
 'bkash','bkash',250,'integrity-payment-key','{"flow":"sandbox"}'::jsonb,
 '22000000-0000-4000-8000-000000000001')$$,'trusted function creates a payment attempt');
select lives_ok($$select public.create_payment_attempt(
 '88000000-0000-4000-8000-000000000001',
 (select id from public.payment_configs where store_id='44000000-0000-4000-8000-000000000001' and method='bkash'),
 'bkash','bkash',250,'integrity-payment-key','{"flow":"sandbox"}'::jsonb,
 '22000000-0000-4000-8000-000000000001')$$,'repeated request with same idempotency key returns existing attempt');
select is((select count(*)::int from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),1,'idempotent creation does not duplicate payment attempts');
select throws_ok($$select public.create_payment_attempt(
 '88000000-0000-4000-8000-000000000001',
 (select id from public.payment_configs where store_id='44000000-0000-4000-8000-000000000001' and method='bkash'),
 'bkash','bkash',250,'integrity-payment-key','{"flow":"different-request"}'::jsonb,
 '22000000-0000-4000-8000-000000000001')$$,'23505',null,'idempotency key cannot be reused with different request facts');
select lives_ok($$select public.record_payment_transaction_state(
 (select id from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),
 'pending_verification',null,'provider_verification',null,null)$$,'provider verification can move attempt to pending_verification');
select lives_ok($$select public.record_payment_transaction_state(
 (select id from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),
 'paid','BKASH-TEST-REF-001','manual_review','11000000-0000-4000-8000-000000000001','Verified against approved sandbox evidence')$$,'authorized manual review can record a final payment result');
select is((select status from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),'paid','payment attempt reaches paid only through trusted transition');
select ok((select verified_at is not null from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),'terminal payment state records verification timestamp');
select is((select count(*)::int from public.audit_logs where resource_type='payment_transaction' and resource_id=(select id from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001')),4,'creation, status changes, and provider-reference attachment are audited separately');
select throws_ok($$update public.payment_transactions set amount=251 where order_id='88000000-0000-4000-8000-000000000001'$$,'55000',null,'payment amount is immutable after creation');
select throws_ok($$update public.payment_transactions set provider_transaction_reference='BKASH-REPLACEMENT' where order_id='88000000-0000-4000-8000-000000000001'$$,'55000',null,'assigned provider reference cannot be replaced');
select throws_ok($$delete from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'$$,'55000',null,'payment transaction history cannot be deleted');
select throws_ok($$select public.record_payment_transaction_state(
 (select id from public.payment_transactions where order_id='88000000-0000-4000-8000-000000000001'),
 'failed',null,'provider_verification',null,null)$$,'23514',null,'terminal paid attempt cannot transition to failed');

-- Unique owner constraint enforces one store per merchant.
select throws_ok($$insert into public.stores(owner_id,name,subdomain,status) values ('11000000-0000-4000-8000-000000000001','Second Store','second-integrity-store','draft')$$,'23505',null,'merchant cannot own a second store');

select * from finish();
rollback;
