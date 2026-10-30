-- Runtime safeguard tests for payment-attempt creation and Option B lifecycle.
-- Synthetic fixtures only; the entire test is rolled back.
begin;
select plan(24);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
 ('91000000-0000-4000-8000-000000000001','authenticated','authenticated','pay-merchant-a@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Payment Merchant A"}'::jsonb,now(),now()),
 ('91000000-0000-4000-8000-000000000002','authenticated','authenticated','pay-merchant-b@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Payment Merchant B"}'::jsonb,now(),now()),
 ('92000000-0000-4000-8000-000000000001','authenticated','authenticated','pay-customer@example.test','test-only-hash',now(),'{}'::jsonb,'{"full_name":"Payment Customer"}'::jsonb,now(),now());
update public.profiles set role='merchant' where id in ('91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002');

insert into public.stores (id,owner_id,name,subdomain,status) values
 ('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Payment Store A','payment-store-a','published'),
 ('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','Payment Store B','payment-store-b','published');
insert into public.payment_configs (id,store_id,method,is_enabled) values
 ('95000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','bkash',true),
 ('95000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','nagad',false),
 ('95000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000001','cod',true),
 ('95000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000002','bkash',true);

-- Payment-status rejection fixtures intentionally keep order.status='pending' for paid/cod_collected/refunded cases so each test isolates the payment_status guard.
insert into public.orders (id,store_id,customer_id,order_phone,status,total_amount,payment_method,payment_status,delivery_address,cancellation_reason) values
 ('96000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','pending','{"address":"A","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','paid','{"address":"B","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'cod','cod_collected','{"address":"C","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000004','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','refunded','{"address":"D","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000005','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','pending_verification','{"address":"E","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000006','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','confirmed',250,'bkash','failed','{"address":"F","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000007','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','cancelled',250,'bkash','failed','{"address":"G","district":"Dhaka"}'::jsonb,'customer cancellation'),
 ('96000000-0000-4000-8000-000000000008','94000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'nagad','pending','{"address":"H","district":"Dhaka"}'::jsonb,null),
 ('96000000-0000-4000-8000-000000000009','94000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000001','01700000001','pending',250,'bkash','pending','{"address":"I","district":"Dhaka"}'::jsonb,null);

select lives_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-1','{"purpose":"test"}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'valid pending order with enabled matching config creates attempt');
select is((select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001'),(select (public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-1','{"purpose":"test"}'::jsonb,'92000000-0000-4000-8000-000000000001')).id),'same key and identical facts return the existing attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-1','{"purpose":"changed"}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23505',null,'same idempotency key with different facts is rejected');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-2','{"purpose":"test"}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'different key cannot create a second active attempt');

select lives_ok($$select public.record_payment_transaction_state((select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001'),'pending_verification','BKASH-SAFE-REF-1','provider_verification',null,null)$$,'status and provider reference can be recorded in one trusted operation');
select is((select count(*)::int from public.audit_logs where resource_type='payment_transaction' and resource_id=(select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001') and action='payment_transaction.status_changed'),1,'status change receives its own audit event');
select is((select count(*)::int from public.audit_logs where resource_type='payment_transaction' and resource_id=(select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001') and action='payment_transaction.provider_reference_attached'),1,'provider reference attachment receives its own audit event when status also changes');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-3','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'new key is blocked while the order payment is awaiting verification');

select lives_ok($$select public.record_payment_transaction_state((select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001'),'paid','BKASH-SAFE-REF-1','provider_verification',null,null)$$,'pending verification can transition to paid with the same provider reference');
update public.orders set payment_status='paid' where id='96000000-0000-4000-8000-000000000001';
update public.payment_configs set is_enabled=false where id='95000000-0000-4000-8000-000000000001';
select lives_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-1','{"purpose":"test"}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'exact idempotent retry returns original attempt after settlement and config disablement');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'safeguard-key-after-paid','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'new attempt is rejected after payment settlement');

select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000002','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'paid-order-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'already-paid order cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000003','95000000-0000-4000-8000-000000000003','cod','cod',250,'cod-collected-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'cod_collected order cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000004','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'refunded-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'refunded order cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000005','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'pending-verification-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'order already awaiting verification cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000006','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'confirmed-order-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'non-pending order cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000007','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'cancelled-order-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'cancelled order cannot receive a new attempt');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000008',null,'nagad','nagad',250,'null-config-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'new attempt cannot bypass payment configuration');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000008','95000000-0000-4000-8000-000000000002','nagad','nagad',250,'disabled-config-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'disabled payment configuration is rejected');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000009','95000000-0000-4000-8000-000000000001','bkash','bkash',250,'wrong-store-config-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'configuration from another store is rejected');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000008','95000000-0000-4000-8000-000000000001','nagad','nagad',250,'wrong-method-config-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'configuration for a different payment method is rejected');
select throws_ok($$select public.create_payment_attempt('96000000-0000-4000-8000-000000000008','95000000-0000-4000-8000-000000000002','nagad','bkash',250,'provider-mismatch-key','{}'::jsonb,'92000000-0000-4000-8000-000000000001')$$,'23514',null,'provider must match selected method');
select throws_ok($$insert into public.payment_transactions(order_id,payment_config_id,method,provider,amount,currency,status,idempotency_key,metadata_sanitized) values ('96000000-0000-4000-8000-000000000008',null,'nagad','nagad',250,'BDT','pending','direct-null-config','{}'::jsonb)$$,'23514',null,'insert trigger also rejects bypassing the enabled configuration');
select is((select count(*)::int from public.audit_logs where resource_type='payment_transaction' and resource_id=(select id from public.payment_transactions where order_id='96000000-0000-4000-8000-000000000001')),4,'creation, two separate events for combined transition, and final status are all audited');

select * from finish();
rollback;
