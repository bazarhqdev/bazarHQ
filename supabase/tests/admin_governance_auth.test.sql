-- Super Admin governance, auth hooks, role assignment, notifications, push queue, rate limits,
-- dashboards and account lifecycle (SRS §9, §12, §20.6). Rolled back.
begin;
select plan(67);

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

-- ================================================================ merchant suspension / reinstatement (FR-SA-11/12, AUTH-14)
select throws_ok($$select public.admin_set_merchant_status('10000000-0000-4000-8000-0000000000a1','10000000-0000-4000-8000-0000000000a2','suspend','Fraud reports')$$,
  '42501', null, 'only Super Admins suspend merchants');
select throws_ok($$select public.admin_set_merchant_status('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000a2','suspend','')$$,
  '22023', null, 'suspension requires a reason');
select lives_ok($$select public.admin_set_merchant_status('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000a2','suspend','Repeated fraud reports','203.0.113.9')$$,
  'a Super Admin suspends a merchant');
select ok((select status = 'suspended' and suspension_reason = 'Repeated fraud reports' from public.profiles where id = '10000000-0000-4000-8000-0000000000a2')
          and (select status = 'suspended' from public.stores where id = '40000000-0000-4000-8000-0000000000e2')
          and exists (select 1 from public.audit_logs where action = 'merchant.suspended' and actor_id = '30000000-0000-4000-8000-0000000000d1'
                      and resource_id = '10000000-0000-4000-8000-0000000000a2' and ip_address = '203.0.113.9')
          and exists (select 1 from public.notifications where user_id = '10000000-0000-4000-8000-0000000000a2' and type = 'account'),
          'suspension unpublishes the store, notifies the merchant and is audited with actor and IP');
select ok((public.custom_access_token_hook('{"user_id":"10000000-0000-4000-8000-0000000000a2","claims":{"role":"authenticated"}}') -> 'error' ->> 'http_code') = '403',
          'a suspended merchant cannot obtain a new access token');
select is((public.custom_access_token_hook('{"user_id":"10000000-0000-4000-8000-0000000000a1","claims":{"role":"authenticated"}}') -> 'claims' ->> 'app_role'),
          'merchant', 'active users get the app_role claim from their profile');
select throws_ok($$select public.resolve_store('shop-b')$$, 'BQ003', null, 'a suspended store is unavailable to shoppers');
select is((public.track_order((select order_number from public.orders where id = '80000000-0000-4000-8000-000000000004'), '01799999999') ->> 'status'),
          'pending', 'orders of a suspended store remain trackable');
select lives_ok($$select public.admin_set_merchant_status('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000a2','reinstate',null)$$,
  'a Super Admin reinstates the merchant');
select ok((select status = 'active' and suspension_reason is null from public.profiles where id = '10000000-0000-4000-8000-0000000000a2')
          and (select status = 'draft' from public.stores where id = '40000000-0000-4000-8000-0000000000e2'),
          'reinstated stores stay unpublished until the merchant republishes');
select throws_ok($$select public.admin_delete_merchant('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000a3','DELETE merchant-c')$$,
  '22023', null, 'deleting a merchant needs the exact confirmation phrase');
select lives_ok($$select public.admin_delete_merchant('30000000-0000-4000-8000-0000000000d1','10000000-0000-4000-8000-0000000000a3','DELETE merchant-c@example.test')$$,
  'a merchant is deleted with the confirmation phrase');
select ok((select status = 'deleted' and full_name = 'Deleted merchant' and phone is null from public.profiles where id = '10000000-0000-4000-8000-0000000000a3')
          and exists (select 1 from public.audit_logs where action = 'merchant.deleted'),
          'deletion anonymises the profile and is audited');

-- ================================================================ policies with dual approval (FR-SA-18/19, DB-12)
select lives_ok($$select public.admin_submit_policy('30000000-0000-4000-8000-0000000000d1','tos','2026.1',(now() at time zone 'Asia/Dhaka')::date,repeat('Terms of service text. ', 5))$$,
  'a Super Admin submits a Terms of Service version');
select throws_ok($$select public.admin_approve_policy('30000000-0000-4000-8000-0000000000d1',(select id from public.policies where version = '2026.1'))$$,
  '42501', null, 'the submitter cannot approve their own version');
select throws_ok($$select public.admin_publish_policy('30000000-0000-4000-8000-0000000000d1',(select id from public.policies where version = '2026.1'))$$,
  '23514', null, 'an unapproved version cannot be published');
select lives_ok($$select public.admin_approve_policy('30000000-0000-4000-8000-0000000000d2',(select id from public.policies where version = '2026.1'));
                 select public.admin_publish_policy('30000000-0000-4000-8000-0000000000d1',(select id from public.policies where version = '2026.1'))$$,
  'a second Super Admin approves and it is published');
select lives_ok($$select public.admin_submit_policy('30000000-0000-4000-8000-0000000000d2','tos','2026.2',current_date + 30,repeat('Updated terms of service. ', 5));
                 select public.admin_approve_policy('30000000-0000-4000-8000-0000000000d1',(select id from public.policies where version = '2026.2'));
                 select public.admin_publish_policy('30000000-0000-4000-8000-0000000000d2',(select id from public.policies where version = '2026.2'))$$,
  'a newer version goes through the same dual approval');
select ok((select status = 'archived' from public.policies where version = '2026.1')
          and (select status = 'published' and published_at is not null from public.policies where version = '2026.2')
          and (select count(*) = 1 from public.policies where type = 'tos' and status = 'published'),
          'publishing supersedes the previous version; history is preserved');
select throws_ok($$update public.policies set content = 'changed' where version = '2026.2'$$, '55000', null, 'approved policy text is immutable');
select throws_ok($$delete from public.policies where version = '2026.1'$$, '55000', null, 'policy versions cannot be deleted');
select ok((select count(*) = 3 from public.audit_logs where action in ('policy.submitted','policy.approved','policy.published')
           and resource_id = (select id from public.policies where version = '2026.2')),
          'submit, approve and publish are each audited');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select version from public.policies where type = 'tos'), '2026.2', 'the public sees only the published version');
reset role;

-- ================================================================ announcements (FR-SA-16/17)
select lives_ok($$select public.admin_save_announcement('30000000-0000-4000-8000-0000000000d1', null,
  '{"title":"Maintenance tonight","body":"The platform will be read-only from 2am to 3am.","audience":"merchants","action":"send"}')$$,
  'a Super Admin sends an announcement to merchants');
select ok((select status = 'sent' and recipient_count = (select count(*) from public.profiles where role = 'merchant' and status = 'active')
           from public.announcements where title = 'Maintenance tonight')
          and (select count(*) = (select count(*) from public.profiles where role = 'merchant' and status = 'active')
               from public.notifications where type = 'announcement' and title = 'Maintenance tonight'),
          'each active merchant receives it and the recipient count is recorded');
select throws_ok($$update public.announcements set body = 'edited' where title = 'Maintenance tonight'$$, '55000', null,
  'sent announcements cannot be edited');
select throws_ok($$select public.admin_delete_announcement('30000000-0000-4000-8000-0000000000d1',(select id from public.announcements where title = 'Maintenance tonight'))$$,
  '55000', null, 'sent announcements cannot be deleted');
select throws_ok($$select public.admin_save_announcement('30000000-0000-4000-8000-0000000000d1', null,
  '{"title":"Past","body":"Scheduled in the past should fail.","audience":"all","action":"schedule","scheduled_at":"2000-01-01T00:00:00Z"}')$$,
  '22023', null, 'scheduling needs a future time');
select lives_ok($$select public.admin_save_announcement('30000000-0000-4000-8000-0000000000d1', null,
  '{"title":"Eid sale","body":"Customers get free delivery during Eid.","audience":"customers","action":"schedule","scheduled_at":"2099-01-01T00:00:00Z"}')$$,
  'an announcement is scheduled');
update public.announcements set scheduled_at = now() - interval '1 minute' where title = 'Eid sale';
select is(public.dispatch_due_announcements(), 1, 'due scheduled announcements are sent by the dispatcher');
select is((select status from public.announcements where title = 'Eid sale'), 'sent', 'the scheduled announcement is now sent');

-- ================================================================ themes (FR-SA-14/15)
select throws_ok($$select public.admin_delete_theme('30000000-0000-4000-8000-0000000000d1','70000000-0000-4000-8000-000000000001')$$,
  '23503', 'This theme is in use by: Shop A', 'a theme in use cannot be deleted; affected stores are listed');
select lives_ok($$select public.admin_save_theme('30000000-0000-4000-8000-0000000000d1','70000000-0000-4000-8000-000000000001',
  '{"name":"Fixture Theme","breaking":true}')$$, 'a breaking theme update');
select ok((select breaking_change_effective_at > now() + interval '6 days' from public.themes where id = '70000000-0000-4000-8000-000000000001')
          and exists (select 1 from public.notifications where user_id = '10000000-0000-4000-8000-0000000000a1' and title = 'Theme update in 7 days'),
          'affected merchants get at least 7 days notice');

-- ================================================================ audit log is append-only for every role (DB-04)
select throws_ok($$update public.audit_logs set action = 'tampered'$$, '55000', null, 'audit rows cannot be updated, even by the owner');
select throws_ok($$delete from public.audit_logs$$, '55000', null, 'audit rows cannot be deleted, even by the owner');

-- ================================================================ login lockout hook (AUTH-07)
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":false}') ->> 'decision'), 'continue', 'failure 1');
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":false}') ->> 'decision'), 'continue', 'failure 2');
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":false}') ->> 'decision'), 'continue', 'failure 3');
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":false}') ->> 'decision'), 'continue', 'failure 4');
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":false}') ->> 'decision'), 'reject',
          'the fifth consecutive failure locks the account');
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":true}') ->> 'decision'), 'reject',
          'even the right password is refused during the 15-minute lock');
update private.auth_login_attempts set locked_until = now() - interval '1 second' where user_id = '20000000-0000-4000-8000-0000000000c1';
select is((public.hook_password_verification_attempt('{"user_id":"20000000-0000-4000-8000-0000000000c1","valid":true}') ->> 'decision'), 'continue',
          'after the lock expires a correct password works and resets the counter');

-- ================================================================ role changes
select throws_ok($$select private.grant_super_admin('20000000-0000-4000-8000-0000000000c1', '')$$, '22023', null,
  'Super Admin elevation needs a recorded reason');
insert into auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('20000000-0000-4000-8000-0000000000c9','authenticated','authenticated','google-merchant@example.test','',  '{}','{"name":"Google Merchant"}',now(),now());
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c9","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((public.become_merchant()).role, 'merchant', 'a brand-new Google sign-up can become a merchant once (FR-M-05)');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.become_merchant()$$, '23514', null, 'an established customer account cannot switch to merchant');
reset role;
select ok(exists (select 1 from public.audit_logs where action = 'profile.role_changed' and resource_id = '20000000-0000-4000-8000-0000000000c9'),
          'role changes are audited');

-- ================================================================ notifications, device tokens, push queue (MOB-08, API-22/36)
select lives_ok($$select public.register_device_token('20000000-0000-4000-8000-0000000000c1', repeat('a', 40), 'android')$$, 'a device token is registered');
select lives_ok($$select public.register_device_token('20000000-0000-4000-8000-0000000000c2', repeat('a', 40), 'android')$$,
  'the same device signing in as another user takes over the token');
select is((select user_id from public.device_tokens where token = repeat('a', 40)), '20000000-0000-4000-8000-0000000000c2'::uuid,
          'one token belongs to one user at a time');
select ok((select count(*) > 0 from jsonb_array_elements(public.claim_pending_push_notifications(500)) n
           where n -> 'tokens' ? repeat('a', 40)),
          'the push queue returns notifications with the recipient''s device tokens');
select is(jsonb_array_length(public.claim_pending_push_notifications(500)), 0, 'claimed notifications are not dispatched twice');
select lives_ok($$select public.unregister_device_token('20000000-0000-4000-8000-0000000000c2', repeat('a', 40))$$, 'tokens are removed on sign-out');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok(public.mark_all_notifications_read() > 0, 'a user marks all their notifications read');
select is((select count(*)::int from public.notifications where not is_read), 0, 'none of their notifications remain unread');
reset role;
select ok(exists (select 1 from public.notifications where user_id <> '20000000-0000-4000-8000-0000000000c1' and not is_read),
          'other users'' notifications are untouched');
select throws_ok($$select private.notify('20000000-0000-4000-8000-0000000000c1','order_status','x','y','order','00000000-0000-4000-8000-000000000000')$$,
  '23503', null, 'notification references are validated by the dispatcher (DB-13)');

-- ================================================================ rate limiting
select ok(public.consume_rate_limit('test:track:198.51.100.1', 3, 60) and public.consume_rate_limit('test:track:198.51.100.1', 3, 60)
          and public.consume_rate_limit('test:track:198.51.100.1', 3, 60) and not public.consume_rate_limit('test:track:198.51.100.1', 3, 60),
          'the fourth call inside the window is limited');

-- ================================================================ dashboards and derived customers
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select ok((public.merchant_dashboard(now() - interval '30 days', now() + interval '1 day') ->> 'revenue')::numeric = 420
          and (public.merchant_dashboard(now() - interval '30 days', now() + interval '1 day') ->> 'store_id') = '40000000-0000-4000-8000-0000000000e1',
          'the merchant dashboard is scoped to the merchant''s own store');
select is(jsonb_array_length(public.merchant_customers()), 2, 'store customers are derived from own-store orders only');
select is((select count(*)::int from public.store_daily_sales), 1, 'the analytics view applies the caller''s RLS (own store only)');
reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.77"}', true);
set local role authenticated;
select ok((public.admin_dashboard(now() - interval '30 days', now() + interval '1 day') ->> 'orders')::int = 4,
          'the platform dashboard covers all stores');
-- Merchants A, B and the Google sign-up that became a merchant above; deleted Merchant C is excluded.
select is(jsonb_array_length(public.admin_list_merchants(null, 'all')), 3, 'merchant oversight lists merchants (deleted ones excluded)');
select ok(not (public.admin_list_merchants(null, 'all')::text ~ 'credentials'), 'merchant oversight never includes payment credentials');
reset role;
select set_config('request.headers', '', true);

-- ================================================================ account deletion (FR-C-36)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$select public.delete_my_account('yes')$$, '22023', null, 'account deletion needs an explicit confirmation');
select lives_ok($$select public.delete_my_account('DELETE')$$, 'a customer deletes their account');
reset role;
select ok((select status = 'deleted' and full_name = 'Deleted user' from public.profiles where id = '20000000-0000-4000-8000-0000000000c2')
          and not exists (select 1 from public.customer_addresses where customer_id = '20000000-0000-4000-8000-0000000000c2')
          and exists (select 1 from public.orders where customer_id = '20000000-0000-4000-8000-0000000000c2'),
          'personal data is removed while order history is retained for the merchant');

select * from finish();
rollback;
