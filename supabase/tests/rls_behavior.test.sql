-- RLS behaviour: tenant isolation, customer privacy, public storefront, Super Admin gate,
-- Storage paths and role assignment. Switches between the real anon/authenticated roles
-- with Supabase-style JWT claims. Synthetic fixtures; rolled back.
begin;
select plan(71);

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

-- ================================================================ signup / role assignment
select is((select role from public.profiles where id = '10000000-0000-4000-8000-0000000000a1'), 'merchant',
          'merchant sign-up metadata yields a merchant profile (server-side mapping)');
select is((select role from public.profiles where id = '20000000-0000-4000-8000-0000000000c2'), 'customer',
          'client-supplied account_type=super_admin is ignored (AUTHZ-02)');

-- ================================================================ anonymous storefront
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is((select count(*)::int from public.stores), 2, 'anon sees only published stores');
select is((select count(*)::int from public.products), 3, 'anon sees only active, non-deleted products of published stores');
select is((select count(*)::int from public.product_variants), 2, 'anon sees variants of visible products');
select throws_ok($$select count(*) from public.orders$$, '42501', null, 'anon cannot read orders');
select throws_ok($$insert into public.stores (owner_id, name, subdomain) values ('10000000-0000-4000-8000-0000000000a3','X','x-shop')$$,
                 '42501', null, 'anon cannot write protected tables');
select is((public.resolve_store('shop-a') ->> 'name'), 'Shop A', 'anon resolves a published store by subdomain');
select throws_ok($$select public.resolve_store('shop-c')$$, 'BQ003', 'Store unavailable', 'draft store is unavailable');
select throws_ok($$select public.resolve_store('no-such-shop')$$, 'BQ003', 'Store unavailable',
                 'nonexistent store gives the same answer (no enumeration)');
select is((select count(*)::int from public.search_stores('shop')), 2, 'store search returns published stores only');
select is((select count(*)::int from storage.objects where bucket_id = 'product-images'), 1,
          'anon can read images of published products only');
select is((select count(*)::int from storage.objects where bucket_id = 'store-logos'), 1, 'draft store logos are not public');
select throws_ok($$select public.create_order(null,'40000000-0000-4000-8000-0000000000e1','[]','{}','cod','anon-key-0001')$$,
                 '42501', null, 'anon cannot call the trusted order function directly');
reset role;

-- ================================================================ customer privacy (Customer One)
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 2, 'a customer sees only their own orders');
select is((select count(*)::int from public.order_items), 2, 'a customer sees only items of their own orders');
select is((select count(*)::int from public.customer_addresses), 1, 'a customer sees only their own addresses');
select throws_ok($$insert into public.customer_addresses (customer_id,label,recipient_name,phone,address,district)
                   values ('20000000-0000-4000-8000-0000000000c2','Spoof','X','01700000009','Somewhere','Dhaka')$$,
                 '42501', null, 'a customer cannot create an address for someone else');
select throws_ok($$update public.profiles set role = 'super_admin' where id = '20000000-0000-4000-8000-0000000000c1'$$,
                 '42501', null, 'a user cannot change their own role');
select lives_ok($$update public.profiles set full_name = 'Customer Uno' where id = '20000000-0000-4000-8000-0000000000c1'$$,
                'a user can edit their own non-role profile fields');
update public.profiles set full_name = 'Hijacked' where id = '20000000-0000-4000-8000-0000000000c2';
select is((select count(*)::int from public.profiles), 1, 'a customer can read only their own profile');
select is((select count(*)::int from public.inventory_movements), 0, 'customers cannot read the inventory ledger');
select is((select count(*)::int from public.audit_logs), 0, 'customers cannot read audit logs');
select throws_ok($$select * from public.payment_configs$$, '42501', null, 'customers cannot read payment configuration');
select is((select count(*)::int from public.notifications), 1, 'a customer sees only their own notifications');
update public.notifications set is_read = true where user_id = '20000000-0000-4000-8000-0000000000c2';
select throws_ok($$update public.notifications set title = 'changed'$$, '42501', null,
                 'recipients can only change is_read, never the notification content');
select is((select count(*)::int from public.support_tickets), 1, 'a customer sees only their own tickets');
select is((select count(*)::int from public.ticket_messages), 1, 'a customer sees only messages of their own tickets');
select is((select count(*)::int from public.returns), 1, 'a customer sees only their own returns');
select throws_ok($$select metadata_sanitized from public.payment_transactions$$, '42501', null,
                 'payment metadata is outside the safe column projection');
select throws_ok($$update public.orders set status = 'delivered' where id = '80000000-0000-4000-8000-000000000003'$$,
                 '42501', null, 'customers cannot change order status directly');
reset role;
select is((select full_name from public.profiles where id = '20000000-0000-4000-8000-0000000000c2'), 'Customer Two',
          'RLS silently blocked editing another user''s profile');
select ok(not (select is_read from public.notifications where user_id = '20000000-0000-4000-8000-0000000000c2'),
          'RLS blocked marking another user''s notification read');

-- ================================================================ merchant tenant isolation (Merchant A)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.products where store_id = '40000000-0000-4000-8000-0000000000e1'), 4,
          'a merchant sees all of their own products, including drafts');
select is((select count(*)::int from public.products where store_id = '40000000-0000-4000-8000-0000000000e2'), 1,
          'a merchant sees another store''s products only as the public does');
select is((select count(*)::int from public.orders), 2, 'a merchant sees only their own store''s orders');
select is((select count(*)::int from public.inventory_movements where store_id = '40000000-0000-4000-8000-0000000000e2'), 0,
          'a merchant cannot read another store''s inventory ledger');
update public.stores set tagline = 'pwned' where id = '40000000-0000-4000-8000-0000000000e2';
select throws_ok($$update public.stores set status = 'published' where id = '40000000-0000-4000-8000-0000000000e1'$$,
                 '42501', null, 'store status changes only through the publish operation');
select throws_ok($$insert into public.categories (store_id, name, slug) values ('40000000-0000-4000-8000-0000000000e2','Hack','hack')$$,
                 '42501', null, 'a merchant cannot add categories to another store');
select lives_ok($$insert into public.categories (store_id, name, slug) values ('40000000-0000-4000-8000-0000000000e1','Veg','veg')$$,
                'a merchant manages categories of their own store');
select throws_ok($$update public.products set stock_quantity = 999 where id = '60000000-0000-4000-8000-000000000001'$$,
                 '42501', null, 'stock is never directly writable by a merchant');
select is((select count(*)::int from public.profiles where id = '20000000-0000-4000-8000-0000000000c1'), 0,
          'a merchant cannot read customer profiles');
select is((select count(*)::int from public.support_tickets), 1, 'a merchant sees only tickets assigned to them in their store queue');
select is((select count(*)::int from public.audit_logs), 0, 'merchants cannot read audit logs');
select throws_ok($$select public.create_store('Second shop','second-shop')$$, '23505', null, 'one store per merchant (FR-M-10)');
select throws_ok($$select public.admin_dashboard(now() - interval '7 days', now())$$, '42501', null,
                 'merchants cannot read platform analytics');
select ok(not (public.get_payment_configs()::text like '%credentials_encrypted%') and jsonb_array_length(public.get_payment_configs()) = 5,
          'the payment-config projection never contains credential ciphertext');
-- Storage paths are tenant-scoped.
select lives_ok($$insert into storage.objects (bucket_id, name) values ('product-images',
  'stores/40000000-0000-4000-8000-0000000000e1/products/60000000-0000-4000-8000-000000000001/new.jpg')$$,
  'a merchant can upload images under their own store/product path');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images',
  'stores/40000000-0000-4000-8000-0000000000e2/products/60000000-0000-4000-8000-000000000003/x.jpg')$$,
  '42501', null, 'a merchant cannot upload into another store''s path');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('product-images',
  'stores/40000000-0000-4000-8000-0000000000e1/products/60000000-0000-4000-8000-000000000003/x.jpg')$$,
  '42501', null, 'a merchant cannot attach images to another store''s product under their own path');
select throws_ok($$delete from storage.objects where bucket_id = 'store-logos' and name like 'stores/40000000-0000-4000-8000-0000000000e2/%'$$,
                 '42501', null, 'direct SQL deletion from Storage is rejected; use the Storage API');
reset role;
select is((select count(*)::int
           from pg_policies
           where schemaname = 'storage'
             and tablename = 'objects'
             and policyname = 'store_logos_objects_delete_owner'
             and cmd = 'DELETE'
             and qual ilike '%owns_store%'), 1,
          'store-logo DELETE policy is scoped to the owning merchant');
select is((select tagline from public.stores where id = '40000000-0000-4000-8000-0000000000e2'), null,
          'RLS blocked updating another merchant''s store');
select is((select count(*)::int from storage.objects where bucket_id = 'store-logos'
           and name like 'stores/40000000-0000-4000-8000-0000000000e2/%'), 1,
          'the other merchant''s logo remains after rejected direct SQL deletion');

-- ================================================================ Storage: customer evidence and attachments
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$insert into storage.objects (bucket_id, name) values ('return-evidence','returns/a0000000-0000-4000-8000-000000000001/photo.jpg')$$,
                'a customer can upload evidence for their own pending return');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('support-attachments','tickets/90000000-0000-4000-8000-000000000001/receipt.pdf')$$,
                'a ticket participant can attach files');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('support-attachments','tickets/90000000-0000-4000-8000-000000000002/x.pdf')$$,
                 '42501', null, 'non-participants cannot attach to a ticket');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('delivery-evidence','orders/80000000-0000-4000-8000-000000000001/delivery/x.jpg')$$,
                 '42501', null, 'customers cannot upload delivery evidence');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('profile-images','users/20000000-0000-4000-8000-0000000000c1/me.jpg')$$,
                'users upload their own profile picture');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('profile-images','users/20000000-0000-4000-8000-0000000000c2/me.jpg')$$,
                 '42501', null, 'users cannot write another user''s profile folder');
reset role;
select set_config('request.jwt.claims', '{"sub":"20000000-0000-4000-8000-0000000000c2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select throws_ok($$insert into storage.objects (bucket_id, name) values ('return-evidence','returns/a0000000-0000-4000-8000-000000000001/x.jpg')$$,
                 '42501', null, 'another customer cannot upload evidence to someone else''s return');
select is((select count(*)::int from storage.objects where bucket_id = 'return-evidence'), 0,
          'another customer cannot read someone else''s return evidence');
reset role;

-- ================================================================ Super Admin gate (AAL2 + active role; no IP allowlist)
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal1"}', true);
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10"}', true);
set local role authenticated;
select is((select count(*)::int from public.audit_logs), 0, 'Super Admin without TOTP (aal1) gets no privileged reads');
reset role;
select set_config('request.jwt.claims', '{"sub":"30000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 4, 'AAL2 Super Admin can read privileged rows regardless of request IP');
reset role;
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7, 203.0.113.10"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 4, 'AAL2 Super Admin retains privileged reads on any network');
select ok((select count(*) from public.audit_logs) > 0, 'Super Admin can read the audit log');
select throws_ok($$update public.orders set status = 'confirmed' where id = '80000000-0000-4000-8000-000000000002'$$,
                 '42501', null, 'Super Admin has no direct order-status write path');
select throws_ok($$select * from public.payment_configs$$, '42501', null, 'Super Admin never reads merchant payment credentials');
select throws_ok($$delete from public.audit_logs$$, '42501', null, 'Super Admin cannot delete audit logs');
reset role;
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.10, 198.51.100.7"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 4, 'forwarding headers do not affect Super Admin RLS authorization');
reset role;
select set_config('request.headers', '', true);

-- ================================================================ suspension takes effect immediately
update public.profiles set status = 'suspended' where id = '10000000-0000-4000-8000-0000000000a2';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.orders), 0, 'a suspended merchant loses tenant access even with an unexpired JWT');
reset role;

select * from finish();
rollback;
