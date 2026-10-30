-- =============================================================================
-- BazarHQ SRS V2.1 Stage 1 — RLS, least-privilege grants and Storage (migration 002)
--
-- RECONSTRUCTION NOTICE: the original 20261021000200_rls_storage.sql was not
-- supplied. This rebuild follows SRS V2.1 §19.1 (operation-level RLS matrix),
-- docs/database/RLS_POLICY_MATRIX.md, and the helper functions migration 003
-- depends on (public.owns_store, public.is_super_admin). See migration 001's
-- header for how to swap in a recovered original.
--
-- Supabase grants ALL on new public tables/functions to anon, authenticated and
-- service_role by default. This migration therefore revokes everything first and
-- grants back only what each role needs. Policies never replace trusted server
-- authorization; sensitive writes go through trusted functions (later migrations).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so they can read profiles/stores under RLS)
-- -----------------------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role = 'super_admin' and p.status = 'active'
  );
$$;

create or replace function public.owns_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.profiles p on p.id = s.owner_id
    where s.id = p_store_id
      and s.owner_id = (select auth.uid())
      and p.role = 'merchant' and p.status = 'active'
  );
$$;

create or replace function public.owns_product(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products pr
    where pr.id = p_product_id and public.owns_store(pr.store_id)
  );
$$;

-- Merchant tenant ownership of an order (order belongs to the caller's store).
create or replace function public.owns_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id and public.owns_store(o.store_id)
  );
$$;

-- Customer, owning Merchant or Super Admin may read an order.
create or replace function public.can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (o.customer_id = (select auth.uid()) or public.owns_store(o.store_id) or public.is_super_admin())
  );
$$;

create or replace function public.can_read_return(p_return_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.returns r
    join public.orders o on o.id = r.order_id
    where r.id = p_return_id
      and (r.customer_id = (select auth.uid()) or public.owns_store(o.store_id) or public.is_super_admin())
  );
$$;

-- Ticket participants: the submitting customer, the assigned Merchant of that store, or a Super Admin (FR-SUP-09).
create or replace function public.can_access_ticket(p_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket_id
      and (
        t.customer_id = (select auth.uid())
        or (t.assigned_to = (select auth.uid()) and t.store_id is not null and public.owns_store(t.store_id))
        or public.is_super_admin()
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Enable RLS on every application table (DB-01)
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.themes enable row level security;
alter table public.stores enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payment_configs enable row level security;
alter table public.delivery_events enable row level security;
alter table public.returns enable row level security;
alter table public.refunds enable row level security;
alter table public.support_tickets enable row level security;
alter table public.ticket_messages enable row level security;
alter table public.ticket_audit_log enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.notifications enable row level security;
alter table public.device_tokens enable row level security;
alter table public.audit_logs enable row level security;
alter table public.announcements enable row level security;
alter table public.policies enable row level security;
alter table public.customer_addresses enable row level security;

-- -----------------------------------------------------------------------------
-- Least privilege: revoke Supabase's default grants, then grant back narrowly
-- -----------------------------------------------------------------------------

revoke all on table
  public.profiles, public.themes, public.stores, public.categories, public.products,
  public.product_variants, public.product_images, public.orders, public.order_items,
  public.payment_configs, public.delivery_events, public.returns, public.refunds,
  public.support_tickets, public.ticket_messages, public.ticket_audit_log,
  public.inventory_movements, public.notifications, public.device_tokens,
  public.audit_logs, public.announcements, public.policies, public.customer_addresses
from public, anon, authenticated;

-- service_role keeps read access for trusted server code but no direct writes on
-- financial/state/history tables: those go through trusted functions only.
revoke insert, update, delete, truncate on table
  public.orders, public.order_items, public.payment_configs, public.delivery_events,
  public.returns, public.refunds, public.ticket_messages, public.ticket_audit_log,
  public.inventory_movements, public.audit_logs, public.policies, public.products,
  public.product_variants, public.support_tickets, public.profiles, public.stores
from service_role;

-- Public storefront reads (published content only, enforced by policies below).
grant select on public.themes, public.stores, public.categories, public.products,
  public.product_variants, public.product_images, public.announcements, public.policies
to anon, authenticated;

-- Authenticated reads gated by ownership policies.
grant select on public.profiles, public.orders, public.order_items, public.delivery_events,
  public.returns, public.refunds, public.support_tickets, public.ticket_messages,
  public.ticket_audit_log, public.inventory_movements, public.notifications,
  public.audit_logs, public.customer_addresses
to authenticated;
grant select (id, user_id, platform, created_at, last_seen_at) on public.device_tokens to authenticated;

-- Narrow column-level write grants (role/status/stock/state columns are never granted).
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;
grant insert (owner_id, name, subdomain, theme_id, brand_colour, tagline, logo_url, return_window_days)
  on public.stores to authenticated;
grant update (name, theme_id, brand_colour, tagline, logo_url, return_window_days) on public.stores to authenticated;
grant insert (store_id, name, slug, parent_id, display_order) on public.categories to authenticated;
grant update (name, slug, parent_id, display_order) on public.categories to authenticated;
grant delete on public.categories to authenticated;
grant insert (product_id, storage_path, is_primary, display_order) on public.product_images to authenticated;
grant update (is_primary, display_order) on public.product_images to authenticated;
grant delete on public.product_images to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant insert (customer_id, label, recipient_name, phone, address, district, postal_code, is_default)
  on public.customer_addresses to authenticated;
grant update (label, recipient_name, phone, address, district, postal_code, is_default)
  on public.customer_addresses to authenticated;
grant delete on public.customer_addresses to authenticated;

-- -----------------------------------------------------------------------------
-- Policies (SRS §19.1). No policy = denied for that role/operation.
-- -----------------------------------------------------------------------------

-- profiles
create policy profiles_select_own on public.profiles
for select to authenticated using (id = (select auth.uid()));
create policy profiles_select_super_admin on public.profiles
for select to authenticated using (public.is_super_admin());
create policy profiles_update_own on public.profiles
for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- themes
create policy themes_select_active on public.themes
for select to anon, authenticated using (is_active);
create policy themes_select_super_admin on public.themes
for select to authenticated using (public.is_super_admin());

-- stores
create policy stores_select_published on public.stores
for select to anon, authenticated using (status = 'published');
create policy stores_select_owner on public.stores
for select to authenticated using (owner_id = (select auth.uid()));
create policy stores_select_super_admin on public.stores
for select to authenticated using (public.is_super_admin());
create policy stores_insert_own_draft on public.stores
for insert to authenticated
with check (
  owner_id = (select auth.uid())
  and status = 'draft'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'merchant' and p.status = 'active')
);
create policy stores_update_owner on public.stores
for update to authenticated using (public.owns_store(id)) with check (public.owns_store(id));

-- categories
create policy categories_select_published on public.categories
for select to anon, authenticated
using (exists (select 1 from public.stores s where s.id = store_id and s.status = 'published'));
create policy categories_select_owner on public.categories
for select to authenticated using (public.owns_store(store_id));
create policy categories_select_super_admin on public.categories
for select to authenticated using (public.is_super_admin());
create policy categories_insert_owner on public.categories
for insert to authenticated with check (public.owns_store(store_id));
create policy categories_update_owner on public.categories
for update to authenticated using (public.owns_store(store_id)) with check (public.owns_store(store_id));
create policy categories_delete_owner on public.categories
for delete to authenticated using (public.owns_store(store_id));

-- products (writes via trusted product/inventory operations only)
create policy products_select_published on public.products
for select to anon, authenticated
using (status = 'active' and exists (select 1 from public.stores s where s.id = store_id and s.status = 'published'));
create policy products_select_owner on public.products
for select to authenticated using (public.owns_store(store_id));
create policy products_select_super_admin on public.products
for select to authenticated using (public.is_super_admin());

-- product_variants
create policy product_variants_select_published on public.product_variants
for select to anon, authenticated
using (exists (
  select 1 from public.products p join public.stores s on s.id = p.store_id
  where p.id = product_id and p.status = 'active' and s.status = 'published'
));
create policy product_variants_select_owner on public.product_variants
for select to authenticated using (public.owns_product(product_id));
create policy product_variants_select_super_admin on public.product_variants
for select to authenticated using (public.is_super_admin());

-- product_images (metadata; binaries live in the product-images bucket)
create policy product_images_select_published on public.product_images
for select to anon, authenticated
using (exists (
  select 1 from public.products p join public.stores s on s.id = p.store_id
  where p.id = product_id and p.status = 'active' and s.status = 'published'
));
create policy product_images_select_owner on public.product_images
for select to authenticated using (public.owns_product(product_id));
create policy product_images_select_super_admin on public.product_images
for select to authenticated using (public.is_super_admin());
create policy product_images_insert_owner on public.product_images
for insert to authenticated with check (public.owns_product(product_id));
create policy product_images_update_owner on public.product_images
for update to authenticated using (public.owns_product(product_id)) with check (public.owns_product(product_id));
create policy product_images_delete_owner on public.product_images
for delete to authenticated using (public.owns_product(product_id));

-- orders / order_items / delivery_events (read-only for clients; guests use the tracking endpoint)
create policy orders_select_customer on public.orders
for select to authenticated using (customer_id = (select auth.uid()));
create policy orders_select_owner on public.orders
for select to authenticated using (public.owns_store(store_id));
create policy orders_select_super_admin on public.orders
for select to authenticated using (public.is_super_admin());

create policy order_items_select_authorized on public.order_items
for select to authenticated using (public.can_read_order(order_id));
create policy delivery_events_select_authorized on public.delivery_events
for select to authenticated using (public.can_read_order(order_id));

-- payment_configs: no client table access at all (safe projection via trusted function).

-- returns / refunds
create policy returns_select_authorized on public.returns
for select to authenticated using (public.can_read_return(id));
create policy refunds_select_authorized on public.refunds
for select to authenticated using (public.can_read_return(return_id));

-- support tickets
create policy support_tickets_select_participant on public.support_tickets
for select to authenticated using (public.can_access_ticket(id));
create policy ticket_messages_select_participant on public.ticket_messages
for select to authenticated using (public.can_access_ticket(ticket_id));
create policy ticket_audit_log_select_participant on public.ticket_audit_log
for select to authenticated using (public.can_access_ticket(ticket_id));

-- inventory ledger
create policy inventory_movements_select_owner on public.inventory_movements
for select to authenticated using (public.owns_store(store_id));
create policy inventory_movements_select_super_admin on public.inventory_movements
for select to authenticated using (public.is_super_admin());

-- notifications: recipient reads and marks read only
create policy notifications_select_recipient on public.notifications
for select to authenticated using (user_id = (select auth.uid()));
create policy notifications_update_recipient on public.notifications
for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- device tokens: owner read; writes through trusted registration only
create policy device_tokens_select_owner on public.device_tokens
for select to authenticated using (user_id = (select auth.uid()));

-- audit logs: Super Admin read-only
create policy audit_logs_select_super_admin on public.audit_logs
for select to authenticated using (public.is_super_admin());

-- announcements: sent + audience-matched; Super Admin sees all
create policy announcements_select_public on public.announcements
for select to anon using (status = 'sent' and audience = 'all');
create policy announcements_select_audience on public.announcements
for select to authenticated
using (
  status = 'sent' and (
    audience = 'all'
    or exists (select 1 from public.profiles p where p.id = (select auth.uid())
               and ((audience = 'merchants' and p.role = 'merchant') or (audience = 'customers' and p.role = 'customer')))
  )
);
create policy announcements_select_super_admin on public.announcements
for select to authenticated using (public.is_super_admin());

-- policies (ToS / Privacy)
create policy policies_select_published on public.policies
for select to anon, authenticated using (status = 'published');
create policy policies_select_super_admin on public.policies
for select to authenticated using (public.is_super_admin());

-- customer addresses: owner Customer only
create policy customer_addresses_select_owner on public.customer_addresses
for select to authenticated using (customer_id = (select auth.uid()));
create policy customer_addresses_insert_owner on public.customer_addresses
for insert to authenticated
with check (
  customer_id = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'customer' and p.status = 'active')
);
create policy customer_addresses_update_owner on public.customer_addresses
for update to authenticated using (customer_id = (select auth.uid())) with check (customer_id = (select auth.uid()));
create policy customer_addresses_delete_owner on public.customer_addresses
for delete to authenticated using (customer_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Function privileges: helpers are callable (policies run as the caller);
-- everything else in public is locked down.
-- -----------------------------------------------------------------------------

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_super_admin(), public.owns_store(uuid), public.owns_product(uuid), public.owns_order(uuid),
  public.can_read_order(uuid), public.can_read_return(uuid), public.can_access_ticket(uuid)
to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Storage: five private buckets (all access via policies / signed URLs)
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-images',      'product-images',      false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('store-logos',         'store-logos',         false, 2097152, array['image/jpeg','image/png','image/webp']),
  ('delivery-evidence',   'delivery-evidence',   false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('return-evidence',     'return-evidence',     false, 5242880, array['image/jpeg','image/png','image/webp']),
  ('support-attachments', 'support-attachments', false, 5242880, array['image/jpeg','image/png','application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- product-images: stores/{store_uuid}/products/{product_uuid}/{file}
create policy "product_images_objects_select_published" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.products p join public.stores s on s.id = p.store_id
    where (storage.foldername(objects.name))[1] = 'stores'
      and s.id::text = (storage.foldername(objects.name))[2]
      and (storage.foldername(objects.name))[3] = 'products'
      and p.id::text = (storage.foldername(objects.name))[4]
      and p.status = 'active' and s.status = 'published'
  )
);
create policy "product_images_objects_select_owner_admin" on storage.objects
for select to authenticated
using (
  bucket_id = 'product-images'
  and (public.is_super_admin() or exists (
    select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id)))
);
create policy "product_images_objects_insert_owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(objects.name))[1] = 'stores'
  and (storage.foldername(objects.name))[3] = 'products'
  and array_length(storage.foldername(objects.name), 1) = 4
  and exists (
    select 1 from public.products p
    where p.id::text = (storage.foldername(objects.name))[4]
      and p.store_id::text = (storage.foldername(objects.name))[2]
      and public.owns_store(p.store_id)
  )
);
create policy "product_images_objects_update_owner" on storage.objects
for update to authenticated
using (
  bucket_id = 'product-images'
  and exists (select 1 from public.products p
              where p.id::text = (storage.foldername(objects.name))[4] and p.store_id::text = (storage.foldername(objects.name))[2]
                and public.owns_store(p.store_id))
)
with check (
  bucket_id = 'product-images'
  and exists (select 1 from public.products p
              where p.id::text = (storage.foldername(objects.name))[4] and p.store_id::text = (storage.foldername(objects.name))[2]
                and public.owns_store(p.store_id))
);
create policy "product_images_objects_delete_owner" on storage.objects
for delete to authenticated
using (
  bucket_id = 'product-images'
  and exists (select 1 from public.products p
              where p.id::text = (storage.foldername(objects.name))[4] and p.store_id::text = (storage.foldername(objects.name))[2]
                and public.owns_store(p.store_id))
);

-- store-logos: stores/{store_uuid}/logos/{file}
create policy "store_logos_objects_select_published" on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'store-logos'
  and exists (select 1 from public.stores s
              where s.id::text = (storage.foldername(objects.name))[2] and s.status = 'published')
);
create policy "store_logos_objects_select_owner_admin" on storage.objects
for select to authenticated
using (
  bucket_id = 'store-logos'
  and (public.is_super_admin() or exists (
    select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id)))
);
create policy "store_logos_objects_insert_owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'store-logos'
  and (storage.foldername(objects.name))[1] = 'stores'
  and (storage.foldername(objects.name))[3] = 'logos'
  and array_length(storage.foldername(objects.name), 1) = 3
  and exists (select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id))
);
create policy "store_logos_objects_update_owner" on storage.objects
for update to authenticated
using (bucket_id = 'store-logos'
       and exists (select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id)))
with check (bucket_id = 'store-logos'
       and exists (select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id)));
create policy "store_logos_objects_delete_owner" on storage.objects
for delete to authenticated
using (bucket_id = 'store-logos'
       and exists (select 1 from public.stores s where s.id::text = (storage.foldername(objects.name))[2] and public.owns_store(s.id)));

-- delivery-evidence: orders/{order_uuid}/delivery/{file}; no update/delete policies.
create policy "delivery_evidence_objects_select_authorized" on storage.objects
for select to authenticated
using (
  bucket_id = 'delivery-evidence'
  and exists (select 1 from public.orders o
              where o.id::text = (storage.foldername(objects.name))[2] and public.can_read_order(o.id))
);
create policy "delivery_evidence_objects_insert_owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'delivery-evidence'
  and (storage.foldername(objects.name))[1] = 'orders'
  and (storage.foldername(objects.name))[3] = 'delivery'
  and array_length(storage.foldername(objects.name), 1) = 3
  and exists (select 1 from public.orders o
              where o.id::text = (storage.foldername(objects.name))[2] and public.owns_store(o.store_id))
);

-- return-evidence: returns/{return_uuid}/{file}; uploaded by the return's customer.
create policy "return_evidence_objects_select_authorized" on storage.objects
for select to authenticated
using (
  bucket_id = 'return-evidence'
  and exists (select 1 from public.returns r
              where r.id::text = (storage.foldername(objects.name))[2] and public.can_read_return(r.id))
);
create policy "return_evidence_objects_insert_owner" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'return-evidence'
  and (storage.foldername(objects.name))[1] = 'returns'
  and array_length(storage.foldername(objects.name), 1) = 2
  and exists (select 1 from public.returns r
              where r.id::text = (storage.foldername(objects.name))[2]
                and r.customer_id = (select auth.uid()) and r.status = 'requested')
);

-- support-attachments: tickets/{ticket_uuid}/{file}; ticket participants only.
create policy "support_attachments_objects_select_participant" on storage.objects
for select to authenticated
using (
  bucket_id = 'support-attachments'
  and exists (select 1 from public.support_tickets t
              where t.id::text = (storage.foldername(objects.name))[2] and public.can_access_ticket(t.id))
);
create policy "support_attachments_objects_insert_participant" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'support-attachments'
  and (storage.foldername(objects.name))[1] = 'tickets'
  and array_length(storage.foldername(objects.name), 1) = 2
  and exists (select 1 from public.support_tickets t
              where t.id::text = (storage.foldername(objects.name))[2]
                and t.status <> 'closed' and public.can_access_ticket(t.id))
);
