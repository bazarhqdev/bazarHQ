-- Migration 011: storefront visit analytics (FR-M-36/37), own-session management
-- (AUTH-06, FR-M-43), session revocation on suspension (FR-SA-11) and view grants.
-- Synthetic fixtures; rolled back.
begin;
select plan(40);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at) values
 ('11000000-0000-4000-8000-0000000000a1','authenticated','authenticated','visits-merchant-a@example.test','test-only-hash',now(),'{}','{"full_name":"Visits Merchant A","account_type":"merchant"}',now(),now()),
 ('11000000-0000-4000-8000-0000000000a2','authenticated','authenticated','visits-merchant-b@example.test','test-only-hash',now(),'{}','{"full_name":"Visits Merchant B","account_type":"merchant"}',now(),now()),
 ('21000000-0000-4000-8000-0000000000c1','authenticated','authenticated','visits-customer@example.test','test-only-hash',now(),'{}','{"full_name":"Visits Customer"}',now(),now()),
 ('31000000-0000-4000-8000-0000000000d1','authenticated','authenticated','visits-admin@example.test','test-only-hash',now(),'{}','{"full_name":"Visits Admin"}',now(),now());
select private.grant_super_admin('31000000-0000-4000-8000-0000000000d1', 'test fixture');
insert into private.admin_ip_allowlist (cidr, note) values ('198.51.100.0/24', 'visits test network');

insert into public.stores (id, owner_id, name, subdomain, status) values
 ('41000000-0000-4000-8000-0000000000e1','11000000-0000-4000-8000-0000000000a1','Visit Shop A','visit-shop-a','published'),
 ('41000000-0000-4000-8000-0000000000e2','11000000-0000-4000-8000-0000000000a2','Visit Shop B','visit-shop-b','draft');

insert into auth.sessions (id, user_id, created_at, updated_at, aal, user_agent, ip) values
 ('51000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-0000000000c1',now() - interval '2 days',now() - interval '1 day','aal1','Mozilla/5.0 (Android)','192.0.2.10'),
 ('51000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-0000000000c1',now() - interval '1 hour',now(),'aal1','Mozilla/5.0 (Windows)','192.0.2.11'),
 ('51000000-0000-4000-8000-000000000003','11000000-0000-4000-8000-0000000000a1',now(),now(),'aal1','Mozilla/5.0 (Mac)','192.0.2.12'),
 ('51000000-0000-4000-8000-000000000004','11000000-0000-4000-8000-0000000000a1',now(),now(),'aal1','Mozilla/5.0 (Linux)','192.0.2.13');

-- ================================================================ catalogue
select ok((select relrowsecurity from pg_class where oid = 'public.storefront_visits'::regclass)
          and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'storefront_visits'),
          'storefront_visits has RLS on and no client policy (deny-all)');
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name = 'storefront_visits' and grantee in ('anon','authenticated')),
          0, 'clients hold no table privileges on storefront_visits');
select is((select string_agg(distinct privilege_type, ',') from information_schema.table_privileges
            where table_schema = 'public' and table_name in ('store_daily_sales','store_product_sales') and grantee = 'authenticated'),
          'SELECT', 'authenticated holds only SELECT on the analytics views');
select is((select count(*)::int from information_schema.table_privileges
            where table_schema = 'public' and table_name in ('store_daily_sales','store_product_sales') and grantee = 'anon'),
          0, 'anon holds nothing on the analytics views');
select ok(has_function_privilege('anon', 'public.record_storefront_visit(uuid,text,text)', 'execute'),
          'anon may record a storefront visit through the function');
select ok(not has_function_privilege('anon', 'public.list_my_sessions()', 'execute'),
          'anon cannot list sessions');

-- ================================================================ visits as anon
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000e1', '/products/apple?ref=fb#top', 'sess-aaaaaaaaaaaaaaaa'),
          true, 'a page view on a published store is recorded');
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000e1', '/', 'sess-aaaaaaaaaaaaaaaa'),
          true, 'a second page in the same session is recorded');
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000e1', '/', 'sess-bbbbbbbbbbbbbbbb'),
          true, 'another session is recorded');
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000e2', '/', 'sess-aaaaaaaaaaaaaaaa'),
          false, 'a draft store is not counted');
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000ff', '/', 'sess-aaaaaaaaaaaaaaaa'),
          false, 'an unknown store gives the same answer as a draft store');
select throws_ok($$select public.record_storefront_visit('41000000-0000-4000-8000-0000000000e1', '/', 'x y')$$,
                 '22023', 'Invalid visit', 'a malformed session id is rejected');
select throws_ok($$select count(*) from public.storefront_visits$$, '42501', null, 'anon cannot read visits');
select throws_ok($$insert into public.storefront_visits (store_id, session_hash, path)
                   values ('41000000-0000-4000-8000-0000000000e1', repeat('a', 64), '/')$$,
                 '42501', null, 'anon cannot insert visits directly');
reset role;

select is((select count(*)::int from public.storefront_visits where store_id = '41000000-0000-4000-8000-0000000000e1'),
          3, 'three page views were stored');
select is((select count(*)::int from public.storefront_visits where path = '/products/apple'),
          1, 'query string and fragment are stripped from the stored path');
select is((select count(*)::int from public.storefront_visits where session_hash like '%sess-%'),
          0, 'the raw session id is never stored');
select throws_ok($$update public.storefront_visits set path = '/x'$$, '55000', null, 'visits are append-only');

-- Same browser session on two stores produces unlinkable hashes.
update public.stores set status = 'published' where id = '41000000-0000-4000-8000-0000000000e2';
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select lives_ok($$select public.record_storefront_visit('41000000-0000-4000-8000-0000000000e2', '/', 'sess-aaaaaaaaaaaaaaaa')$$,
                'the same session visits a second store');
reset role;
select isnt((select session_hash from public.storefront_visits where store_id = '41000000-0000-4000-8000-0000000000e2' limit 1),
            (select session_hash from public.storefront_visits where store_id = '41000000-0000-4000-8000-0000000000e1' and path = '/' order by created_at limit 1),
            'the same session hashes differently per store (no cross-store tracking)');

-- ================================================================ owner is not a visitor; dashboard
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is(public.record_storefront_visit('41000000-0000-4000-8000-0000000000e1', '/', 'sess-cccccccccccccccc'),
          false, 'the store owner browsing their own store is not counted');
select is((public.merchant_dashboard(now() - interval '1 day', now() + interval '1 minute') ->> 'visitors')::int,
          2, 'merchant dashboard counts unique sessions as visitors');
select is((public.merchant_dashboard(now() - interval '1 day', now() + interval '1 minute') -> 'popular_pages' -> 0 ->> 'path'),
          '/', 'popular pages are ranked by views');
select is((public.merchant_dashboard(now() - interval '1 day', now() + interval '1 minute') ->> 'visitors_available')::boolean,
          true, 'the dashboard reports visitor data as available');
select ok((public.merchant_dashboard(now() - interval '1 day', now() + interval '1 minute') -> 'series' -> 0) ? 'visitors',
          'daily series carries visitors');
reset role;

-- ================================================================ own sessions
select set_config('request.jwt.claims',
  '{"sub":"21000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1","session_id":"51000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
select is(jsonb_array_length(public.list_my_sessions()), 2, 'a user lists only their own sessions');
select is((select count(*)::int from jsonb_array_elements(public.list_my_sessions()) e where (e ->> 'current')::boolean),
          1, 'exactly one session is flagged as current');
select throws_ok($$select public.revoke_my_session('51000000-0000-4000-8000-000000000002')$$, '23514', null,
                 'the current session cannot be revoked here (use sign out)');
select throws_ok($$select public.revoke_my_session('51000000-0000-4000-8000-000000000003')$$, 'P0002', 'Session not found',
                 'another user''s session cannot be revoked');
select lives_ok($$select public.revoke_my_session('51000000-0000-4000-8000-000000000001')$$, 'a user can end another of their sessions');
select throws_ok($$select public.admin_user_session_count('11000000-0000-4000-8000-0000000000a1')$$, '42501', null,
                 'a customer cannot count other users'' sessions');
reset role;
select is((select count(*)::int from auth.sessions where user_id = '21000000-0000-4000-8000-0000000000c1'), 1,
          'the revoked session is gone');

-- Super Admin (AAL2) can count from any network; suspension ends sessions.
select set_config('request.jwt.claims', '{"sub":"31000000-0000-4000-8000-0000000000d1","role":"authenticated","aal":"aal2"}', true);
select set_config('request.headers', '{"x-forwarded-for":"198.51.100.7"}', true);
set local role authenticated;
select is(public.admin_user_session_count('11000000-0000-4000-8000-0000000000a1'), 2, 'a Super Admin can count a merchant''s sessions');
reset role;
update public.profiles set status = 'suspended', suspension_reason = 'test' where id = '11000000-0000-4000-8000-0000000000a1';
select is((select count(*)::int from auth.sessions where user_id = '11000000-0000-4000-8000-0000000000a1'), 0,
          'suspending an account ends all of its sessions');

-- ================================================================ ticket customer names (participants only)
insert into public.support_tickets (id, customer_id, store_id, category, subject, description, queue, assigned_to) values
 ('91000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-0000000000c1','41000000-0000-4000-8000-0000000000e1','order','Where is it','Order is late again','store','11000000-0000-4000-8000-0000000000a1');
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select count(*)::int from public.ticket_customer_names(array['91000000-0000-4000-8000-000000000001'::uuid])), 0,
          'another merchant gets no names for tickets they cannot access');
reset role;
select set_config('request.jwt.claims', '{"sub":"21000000-0000-4000-8000-0000000000c1","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select is((select customer_name from public.ticket_customer_names(array['91000000-0000-4000-8000-000000000001'::uuid])),
          'Visits Customer', 'a ticket participant gets the customer name');
reset role;

-- ================================================================ media columns hold own Storage paths
select set_config('request.jwt.claims', '{"sub":"11000000-0000-4000-8000-0000000000a2","role":"authenticated","aal":"aal1"}', true);
set local role authenticated;
select lives_ok($$update public.stores set logo_url = 'stores/41000000-0000-4000-8000-0000000000e2/logos/logo.png'
                  where id = '41000000-0000-4000-8000-0000000000e2'$$, 'a logo path in the store''s own folder is accepted');
select throws_ok($$update public.stores set logo_url = 'https://tracker.example/pixel.gif'
                   where id = '41000000-0000-4000-8000-0000000000e2'$$, '23514', null, 'an external logo URL is rejected');
select throws_ok($$update public.stores set banner_url = 'stores/41000000-0000-4000-8000-0000000000e1/banners/b.png'
                   where id = '41000000-0000-4000-8000-0000000000e2'$$, '23514', null, 'a banner path from another store is rejected');
select throws_ok($$update public.profiles set avatar_url = 'users/21000000-0000-4000-8000-0000000000c1/me.png'
                   where id = '11000000-0000-4000-8000-0000000000a2'$$, '23514', null, 'an avatar path outside the user''s folder is rejected');
reset role;

select * from finish();
rollback;
