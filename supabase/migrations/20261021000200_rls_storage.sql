-- =============================================================================
-- BazarHQ SRS Version 2.1
-- Migration 002: Row-Level Security (RLS), least-privilege grants, Storage
--
-- Prerequisite: 20261021000100_core_schema.sql
-- Followed by:  20261021000300_payment_transactions_option_b.sql
--               20261021000400_payment_attempt_safeguards.sql
--
-- This migration protects the 23 core application tables. It deliberately does
-- NOT reference public.payment_transactions: migration 003 creates and secures it.
--
-- Super Admin security boundary:
-- Direct client-to-Supabase requests do not receive privileged Super Admin data
-- access from an is_super_admin() role check. All privileged Super Admin reads
-- and writes must go through trusted server-side endpoints which enforce the
-- approved network/IP allowlist AND TOTP/MFA before using server credentials.
-- Those endpoints must authorize each action and return only necessary data.
-- This migration does not implement those endpoints.
--
-- Product image deletion order:
-- 1. Delete the Storage object while the metadata row still exists.
-- 2. Delete the metadata row; its DELETE policy requires the object to be absent.
-- If step 1 succeeds and step 2 fails, retry step 2. If the object is already
-- absent, treat that as success and retry metadata deletion. Do not delete the
-- metadata first. The object-delete policy checks exact path/store/product owner.
--
-- No production credentials/secrets are included. Review before shared DB use.
-- =============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Active-role helper
-- ---------------------------------------------------------------------------

-- This migration defines the active-role helper used by its policies. It returns
-- a role only for the authenticated caller with an active profile.
create or replace function public.current_active_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
    select p.role::text
    from public.profiles p
    where p.id = (select auth.uid())
      and p.status = 'active'
$$;

revoke all on function public.current_active_app_role() from public;
grant execute on function public.current_active_app_role() to anon, authenticated, service_role;

-- safe_uuid(text) already exists in migration 001 and returns NULL for invalid UUID
-- input. Keep that canonical implementation; Storage policies use it below.

-- Migration 003 currently contains a legacy RLS branch using is_super_admin().
-- RLS cannot prove the required network allowlist or TOTP verification. Fail
-- closed for all direct anon/authenticated JWTs so that branch cannot grant
-- privileged data. Trusted server endpoints authorize Super Admins separately;
-- service_role bypasses RLS and must never be exposed to clients.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select case
        when coalesce(auth.role(), '') in ('anon', 'authenticated') then false
        else coalesce((select public.current_active_app_role()) = 'super_admin', false)
    end
$$;

-- Replace the permissive core owns_store helper with a role- and status-aware
-- predicate. This also closes the legacy payment_transactions policy's
-- owns_store(...) branch for any profile whose role has changed to Super Admin.
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
          and p.role = 'merchant'
          and p.status = 'active'
          and (select auth.role()) = 'authenticated'
    )
$$;

-- ---------------------------------------------------------------------------
-- 2. Enable RLS on all 23 core application tables
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 3. Least-privilege table grants
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

-- Anonymous SELECT is granted only for the public storefront/catalogue and
-- explicitly public announcement/policy surfaces. RLS still limits rows to
-- published stores/products, active themes, public announcements and published
-- policy versions. No anon SELECT is granted for profiles, orders, delivery,
-- returns/refunds, tickets/messages, audit, notifications or saved addresses.
grant select on
    public.themes,
    public.stores,
    public.categories,
    public.products,
    public.product_variants,
    public.product_images,
    public.announcements,
    public.policies
to anon;

-- Authenticated users receive SELECT only where a table policy scopes rows to
-- their own identity, their own store, authorized ticket participation, or
-- published catalogue information. Sensitive tables remain omitted.
grant select on
    public.profiles,
    public.themes,
    public.stores,
    public.categories,
    public.products,
    public.product_variants,
    public.product_images,
    public.orders,
    public.order_items,
    public.delivery_events,
    public.returns,
    public.support_tickets,
    public.ticket_messages,
    public.ticket_audit_log,
    public.inventory_movements,
    public.notifications,
    public.announcements,
    public.policies,
    public.customer_addresses
to authenticated;

-- Own profile fields only. No direct INSERT/DELETE and no role/status updates.
grant update (full_name, phone, avatar_url)
    on public.profiles to authenticated;

-- Store creation is limited to draft stores owned by the active Merchant.
-- Status, owner_id and logo_url are not directly updateable by clients.
grant insert (owner_id, name, subdomain, theme_id, brand_colour, tagline, return_window_days)
    on public.stores to authenticated;
grant update (name, theme_id, brand_colour, tagline, return_window_days)
    on public.stores to authenticated;

-- Merchant category management is tenant-scoped by RLS and same-store FKs.
grant insert (store_id, name, slug, parent_id, display_order)
    on public.categories to authenticated;
grant update (name, slug, parent_id, display_order)
    on public.categories to authenticated;
grant delete on public.categories to authenticated;

-- Product creation, product stock, variant stock and product-type transitions
-- require trusted product/inventory endpoints. No direct product/variant DML.

-- Image metadata writes are allowed only for owned products and validated paths.
grant insert (
    store_id,
    product_id,
    storage_path,
    is_primary,
    display_order
)
on public.product_images to authenticated;

grant update (storage_path, is_primary, display_order)
    on public.product_images to authenticated;
grant delete on public.product_images to authenticated;

-- Orders/order_items are read-only through direct client SQL.
-- Payment configs are inaccessible directly; use a safe server projection.
-- Delivery, return, refund, support and inventory writes use trusted workflows.
-- Refunds expose only a safe column projection, never internal gateway details.
grant select (
    id, return_id, amount, method, status, processed_at,
    confirmation_reference, created_at, updated_at
) on public.refunds to authenticated;

-- Only recipient-owned notification state may be changed by the client.
grant update (is_read) on public.notifications to authenticated;

-- Saved address CRUD is limited by RLS and the schema's address-count trigger.
grant insert (customer_id, label, recipient_name, phone, address, district, postal_code, is_default)
    on public.customer_addresses to authenticated;
grant update (label, recipient_name, phone, address, district, postal_code, is_default)
    on public.customer_addresses to authenticated;
grant delete on public.customer_addresses to authenticated;

-- Explicitly deny direct client reads of audit/device-token/payment credential data.
revoke all on public.audit_logs, public.device_tokens, public.payment_configs
    from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Profiles: self only, never Super Admin elevation via direct client access
-- ---------------------------------------------------------------------------

create policy profiles_select_self
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy profiles_update_self_nonprivileged
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- No direct profile INSERT/DELETE policy. The auth signup trigger creates the
-- Customer profile; role/status administration is a trusted server operation.

-- ---------------------------------------------------------------------------
-- 5. Themes: only active themes are client-readable
-- ---------------------------------------------------------------------------

create policy themes_select_active
on public.themes for select to anon, authenticated
using (is_active = true);

-- No client theme mutation policies or grants.

-- ---------------------------------------------------------------------------
-- 6. Stores: public published stores; active Merchant's own store
-- ---------------------------------------------------------------------------

create policy stores_select_published_or_own_merchant
on public.stores for select to anon, authenticated
using (
    status = 'published'
    or (
        (select public.current_active_app_role()) = 'merchant'
        and (select public.owns_store(id))
    )
);

create policy stores_insert_own_draft
on public.stores for insert to authenticated
with check (
    owner_id = (select auth.uid())
    and status = 'draft'
    and (select public.current_active_app_role()) = 'merchant'
);

create policy stores_update_own_allowed_fields
on public.stores for update to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(id))
)
with check (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(id))
);

-- No direct store DELETE policy. Publication/suspension and logo_url changes
-- must be authorized by a trusted server endpoint.

-- ---------------------------------------------------------------------------
-- 7. Categories
-- ---------------------------------------------------------------------------

create policy categories_select_published_or_own_store
on public.categories for select to anon, authenticated
using (
    exists (
        select 1 from public.stores s
        where s.id = categories.store_id and s.status = 'published'
    )
    or (
        (select public.current_active_app_role()) = 'merchant'
        and (select public.owns_store(categories.store_id))
    )
);

create policy categories_insert_own_store
on public.categories for insert to authenticated
with check (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(store_id))
);

create policy categories_update_own_store
on public.categories for update to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(store_id))
)
with check (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(store_id))
);

create policy categories_delete_own_store
on public.categories for delete to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(store_id))
);

-- ---------------------------------------------------------------------------
-- 8. Products: public published-only, Merchant own-store read-only
-- ---------------------------------------------------------------------------

create policy products_select_published_or_own_store
on public.products for select to anon, authenticated
using (
    (
        status = 'published'
        and exists (
            select 1 from public.stores s
            where s.id = products.store_id and s.status = 'published'
        )
    )
    or (
        (select public.current_active_app_role()) = 'merchant'
        and (select public.owns_store(store_id))
    )
);

-- No direct product INSERT/UPDATE/DELETE. Trusted product and inventory
-- endpoints must preserve the simple-versus-variant stock model atomically.

-- ---------------------------------------------------------------------------
-- 9. Variants: public/Customer only active variants of published products
-- ---------------------------------------------------------------------------

create policy variants_select_active_published_or_own_store
on public.product_variants for select to anon, authenticated
using (
    (
        status = 'active'
        and exists (
            select 1
            from public.products p
            join public.stores s on s.id = p.store_id
            where p.id = product_variants.product_id
              and p.status = 'published'
              and s.status = 'published'
        )
    )
    or exists (
        select 1
        from public.products p
        where p.id = product_variants.product_id
          and (select public.current_active_app_role()) = 'merchant'
          and (select public.owns_store(p.store_id))
    )
);

-- No direct variant INSERT/UPDATE/DELETE. Inventory endpoints control stock.

-- ---------------------------------------------------------------------------
-- 10. Product image metadata and object-first deletion workflow
-- ---------------------------------------------------------------------------

-- product_images.store_id must match products.store_id.
-- The composite foreign key enforces this relationship.
-- Storage paths must also match the same store and product.
create policy product_images_select_published_or_own_store
on public.product_images for select to anon, authenticated
using (
    cardinality(string_to_array(storage_path, '/')) = 5
    and split_part(storage_path, '/', 1) = 'stores'
    and public.safe_uuid(split_part(storage_path, '/', 2)) is not null
    and split_part(storage_path, '/', 3) = 'products'
    and public.safe_uuid(split_part(storage_path, '/', 4)) is not null
    and split_part(storage_path, '/', 5) <> ''
    and exists (
        select 1
        from public.products p
        join public.stores s on s.id = p.store_id
        where p.id = product_images.product_id
          and public.safe_uuid(split_part(product_images.storage_path, '/', 4)) = p.id
          and public.safe_uuid(split_part(product_images.storage_path, '/', 2)) = p.store_id
          and (
              (p.status = 'published' and s.status = 'published')
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(p.store_id))
              )
          )
    )
);

create policy product_images_insert_own_product
on public.product_images for insert to authenticated
with check (
    cardinality(string_to_array(storage_path, '/')) = 5
    and split_part(storage_path, '/', 1) = 'stores'
    and split_part(storage_path, '/', 3) = 'products'
    and split_part(storage_path, '/', 5) <> ''
    and public.safe_uuid(split_part(storage_path, '/', 2)) is not null
    and public.safe_uuid(split_part(storage_path, '/', 4)) = product_id
and store_id = public.safe_uuid(split_part(storage_path, '/', 2))
and (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.products p
        where p.id = product_images.product_id
          and p.store_id = public.safe_uuid(split_part(product_images.storage_path, '/', 2))
          and (select public.owns_store(p.store_id))
    )
    and exists (
        select 1 from storage.objects so
        where so.bucket_id = 'product-images'
          and so.name = product_images.storage_path
    )
);

create policy product_images_update_own_product
on public.product_images for update to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.products p
        where p.id = product_images.product_id
          and (select public.owns_store(p.store_id))
          and cardinality(string_to_array(product_images.storage_path, '/')) = 5
          and split_part(product_images.storage_path, '/', 1) = 'stores'
          and public.safe_uuid(split_part(product_images.storage_path, '/', 2)) = p.store_id
          and split_part(product_images.storage_path, '/', 3) = 'products'
          and public.safe_uuid(split_part(product_images.storage_path, '/', 4)) = p.id
          and split_part(product_images.storage_path, '/', 5) <> ''
    )
)
with check (
    (select public.current_active_app_role()) = 'merchant'
    and cardinality(string_to_array(storage_path, '/')) = 5
    and split_part(storage_path, '/', 1) = 'stores'
    and public.safe_uuid(split_part(storage_path, '/', 2)) is not null
    and split_part(storage_path, '/', 3) = 'products'
    and public.safe_uuid(split_part(storage_path, '/', 4)) = product_id
    and split_part(storage_path, '/', 5) <> ''
    and exists (
        select 1 from public.products p
        where p.id = product_images.product_id
          and p.store_id = public.safe_uuid(split_part(product_images.storage_path, '/', 2))
          and (select public.owns_store(p.store_id))
    )
    and exists (
        select 1 from storage.objects so
        where so.bucket_id = 'product-images'
          and so.name = product_images.storage_path
    )
);

-- Metadata deletion is allowed only after the corresponding Storage object has
-- been removed. Storage DELETE does NOT require metadata absence, avoiding a
-- circular dependency. A failed metadata delete can be retried safely.
create policy product_images_delete_own_product_after_object
on public.product_images for delete to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.products p
        where p.id = product_images.product_id
          and (select public.owns_store(p.store_id))
          and cardinality(string_to_array(product_images.storage_path, '/')) = 5
          and split_part(product_images.storage_path, '/', 1) = 'stores'
          and public.safe_uuid(split_part(product_images.storage_path, '/', 2)) = p.store_id
          and split_part(product_images.storage_path, '/', 3) = 'products'
          and public.safe_uuid(split_part(product_images.storage_path, '/', 4)) = p.id
          and split_part(product_images.storage_path, '/', 5) <> ''
    )
    and not exists (
        select 1 from storage.objects so
        where so.bucket_id = 'product-images'
          and so.name = product_images.storage_path
    )
);

-- ---------------------------------------------------------------------------
-- 11. Orders and order items: no direct client writes
-- ---------------------------------------------------------------------------

create policy orders_select_customer_or_own_merchant
on public.orders for select to authenticated
using (
    customer_id = (select auth.uid())
    or (
        (select public.current_active_app_role()) = 'merchant'
        and (select public.owns_store(store_id))
    )
);

create policy order_items_select_authorized_order
on public.order_items for select to authenticated
using (
    exists (
        select 1 from public.orders o
        where o.id = order_items.order_id
          and (
              o.customer_id = (select auth.uid())
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(o.store_id))
              )
          )
    )
);

-- No direct client order/order_item writes. Guest checkout and tracking use
-- validated server endpoints; Order ID alone never grants data access.

-- ---------------------------------------------------------------------------
-- 12. Payment configuration: no direct table access
-- ---------------------------------------------------------------------------

-- payment_configs contains encrypted credential ciphertext and is intentionally
-- inaccessible to anon/authenticated clients. A trusted endpoint returns only
-- enabled method names or masked metadata after authorization.
-- Migration 003 creates payment_transactions and its own RLS/privileges.

-- ---------------------------------------------------------------------------
-- 13. Delivery events: customer timeline and own-store history
-- ---------------------------------------------------------------------------

create policy delivery_events_select_order_participant
on public.delivery_events for select to authenticated
using (
    exists (
        select 1 from public.orders o
        where o.id = delivery_events.order_id
          and (
              o.customer_id = (select auth.uid())
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(o.store_id))
              )
          )
    )
);

-- Append-only; merchant delivery/COD updates use trusted server workflows.

-- ---------------------------------------------------------------------------
-- 14. Returns and refunds
-- ---------------------------------------------------------------------------

create policy returns_select_customer_or_own_merchant
on public.returns for select to authenticated
using (
    customer_id = (select auth.uid())
    or exists (
        select 1 from public.orders o
        where o.id = returns.order_id
          and (select public.current_active_app_role()) = 'merchant'
          and (select public.owns_store(o.store_id))
    )
);

create policy refunds_select_customer_or_own_merchant
on public.refunds for select to authenticated
using (
    exists (
        select 1
        from public.returns r
        join public.orders o on o.id = r.order_id
        where r.id = refunds.return_id
          and (
              r.customer_id = (select auth.uid())
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(o.store_id))
              )
          )
    )
);

-- No direct return/refund writes. Eligibility, receipt, settlement and admin
-- intervention require trusted, audited workflow endpoints.

-- ---------------------------------------------------------------------------
-- 15. Support tickets, messages and ticket audit
-- ---------------------------------------------------------------------------

create policy support_tickets_select_customer_or_assigned_merchant
on public.support_tickets for select to authenticated
using (
    customer_id = (select auth.uid())
    or (
        assigned_to = (select auth.uid())
        and store_id is not null
        and (select public.current_active_app_role()) = 'merchant'
        and (select public.owns_store(store_id))
    )
);

create policy ticket_messages_select_ticket_participant
on public.ticket_messages for select to authenticated
using (
    exists (
        select 1 from public.support_tickets t
        where t.id = ticket_messages.ticket_id
          and (
              t.customer_id = (select auth.uid())
              or (
                  t.assigned_to = (select auth.uid())
                  and t.store_id is not null
                  and (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(t.store_id))
              )
          )
    )
);

create policy ticket_audit_log_select_ticket_participant
on public.ticket_audit_log for select to authenticated
using (
    exists (
        select 1 from public.support_tickets t
        where t.id = ticket_audit_log.ticket_id
          and (
              t.customer_id = (select auth.uid())
              or (
                  t.assigned_to = (select auth.uid())
                  and t.store_id is not null
                  and (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(t.store_id))
              )
          )
    )
);

-- No direct ticket writes. Trusted ticket workflow endpoints enforce assignment,
-- status transitions, escalation timer and append-only audit recording.

-- ---------------------------------------------------------------------------
-- 16. Inventory movement ledger: own Merchant store only
-- ---------------------------------------------------------------------------

create policy inventory_movements_select_own_store
on public.inventory_movements for select to authenticated
using (
    (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(store_id))
);

-- No direct INSERT/UPDATE/DELETE on immutable inventory_movements.

-- ---------------------------------------------------------------------------
-- 17. Notifications and device tokens
-- ---------------------------------------------------------------------------

create policy notifications_select_own
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

create policy notifications_update_own_read_flag
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Column-level UPDATE grant limits changes to is_read. No direct device_tokens
-- grants/policies: registration/revocation is handled by a trusted endpoint.

-- ---------------------------------------------------------------------------
-- 18. Audit logs: no direct client access, including Super Admin JWTs
-- ---------------------------------------------------------------------------

-- There is deliberately no SELECT policy for audit_logs and no direct client
-- table privilege. Authorized audit viewing is exposed through trusted server
-- endpoints only after network allowlist + TOTP/MFA enforcement.

-- ---------------------------------------------------------------------------
-- 19. Announcements: sent and audience-matched records only
-- ---------------------------------------------------------------------------

create policy announcements_select_public_audience
on public.announcements for select to anon
using (status = 'sent' and audience = 'public');

create policy announcements_select_addressed_authenticated
on public.announcements for select to authenticated
using (
    status = 'sent'
    and (
        audience = 'all'
        or audience = 'public'
        or (
            audience = 'customers'
            and (select public.current_active_app_role()) = 'customer'
        )
        or (
            audience = 'merchants'
            and (select public.current_active_app_role()) = 'merchant'
        )
    )
);

-- No direct announcement writes. Super Admin announcement workflows are trusted.

-- ---------------------------------------------------------------------------
-- 20. Policies: published versions only for direct clients
-- ---------------------------------------------------------------------------

create policy policies_select_published_only
on public.policies for select to anon, authenticated
using (status = 'published');

-- Submission, dual approval, publication and audit are trusted server workflows.

-- ---------------------------------------------------------------------------
-- 21. Customer saved addresses
-- ---------------------------------------------------------------------------

create policy customer_addresses_select_own
on public.customer_addresses for select to authenticated
using (
    customer_id = (select auth.uid())
    and (select public.current_active_app_role()) = 'customer'
);

create policy customer_addresses_insert_own
on public.customer_addresses for insert to authenticated
with check (
    customer_id = (select auth.uid())
    and (select public.current_active_app_role()) = 'customer'
);

create policy customer_addresses_update_own
on public.customer_addresses for update to authenticated
using (
    customer_id = (select auth.uid())
    and (select public.current_active_app_role()) = 'customer'
)
with check (
    customer_id = (select auth.uid())
    and (select public.current_active_app_role()) = 'customer'
);

create policy customer_addresses_delete_own
on public.customer_addresses for delete to authenticated
using (
    customer_id = (select auth.uid())
    and (select public.current_active_app_role()) = 'customer'
);

-- ---------------------------------------------------------------------------
-- 22. Private Storage buckets
-- ---------------------------------------------------------------------------

-- All buckets are private. Storage RLS governs API reads; do not use public
-- object URLs for private evidence. Signed URLs must be short-lived and issued
-- only by an authorized endpoint for private resources.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('product-images', 'product-images', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']),
    ('store-logos', 'store-logos', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']),
    ('delivery-evidence', 'delivery-evidence', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']),
    ('return-evidence', 'return-evidence', false, 2097152,
        array['image/jpeg', 'image/png', 'image/webp']),
    ('support-attachments', 'support-attachments', false, 5242880,
        array['image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 23. Storage: product-images
-- Path: stores/{store_uuid}/products/{product_uuid}/{filename}
-- ---------------------------------------------------------------------------

create policy product_images_storage_select_published_or_own
on storage.objects for select to anon, authenticated
using (
    bucket_id = 'product-images'
    and cardinality(string_to_array(name, '/')) = 5
    and cardinality(storage.foldername(name)) = 4
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'products'
    and public.safe_uuid((storage.foldername(name))[4]) is not null
    and split_part(name, '/', 5) <> ''
    and exists (
        select 1
        from public.products p
        join public.stores s on s.id = p.store_id
        where p.id = public.safe_uuid((storage.foldername(name))[4])
          and s.id = public.safe_uuid((storage.foldername(name))[2])
          and p.store_id = s.id
          and (
              (
                  p.status = 'published'
                  and s.status = 'published'
                  and exists (
                      select 1 from public.product_images pi
                      where pi.product_id = p.id and pi.storage_path = storage.objects.name
                  )
              )
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(s.id))
              )
          )
    )
);

create policy product_images_storage_insert_own_product
on storage.objects for insert to authenticated
with check (
    bucket_id = 'product-images'
    and cardinality(string_to_array(name, '/')) = 5
    and cardinality(storage.foldername(name)) = 4
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'products'
    and public.safe_uuid((storage.foldername(name))[4]) is not null
    and split_part(name, '/', 5) <> ''
    and (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.products p
        where p.id = public.safe_uuid((storage.foldername(name))[4])
          and p.store_id = public.safe_uuid((storage.foldername(name))[2])
          and (select public.owns_store(p.store_id))
    )
);

-- No Storage UPDATE policy. Replace by uploading a new object and updating the
-- metadata through the authorized sequence; then delete the old owned object.
create policy product_images_storage_delete_own_product
on storage.objects for delete to authenticated
using (
    bucket_id = 'product-images'
    and cardinality(string_to_array(name, '/')) = 5
    and cardinality(storage.foldername(name)) = 4
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'products'
    and public.safe_uuid((storage.foldername(name))[4]) is not null
    and split_part(name, '/', 5) <> ''
    and (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1
        from public.products p
        join public.product_images pi on pi.product_id = p.id
        where p.id = public.safe_uuid((storage.foldername(name))[4])
          and p.store_id = public.safe_uuid((storage.foldername(name))[2])
          and pi.storage_path = storage.objects.name
          and (select public.owns_store(p.store_id))
    )
);

-- Delete order is intentionally non-circular: Storage DELETE requires metadata
-- to exist, while metadata DELETE requires the Storage object to be absent.
-- If object deletion succeeds but metadata deletion fails, retry metadata DELETE.

-- ---------------------------------------------------------------------------
-- 24. Storage: store-logos
-- Path: stores/{store_uuid}/logos/{filename}
-- ---------------------------------------------------------------------------

create policy store_logos_storage_select_published_or_own
on storage.objects for select to anon, authenticated
using (
    bucket_id = 'store-logos'
    and cardinality(string_to_array(name, '/')) = 4
    and cardinality(storage.foldername(name)) = 3
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'logos'
    and split_part(name, '/', 4) <> ''
    and exists (
        select 1 from public.stores s
        where s.id = public.safe_uuid((storage.foldername(name))[2])
          and (
              (s.status = 'published' and s.logo_url = storage.objects.name)
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(s.id))
              )
          )
    )
);

create policy store_logos_storage_insert_own
on storage.objects for insert to authenticated
with check (
    bucket_id = 'store-logos'
    and cardinality(string_to_array(name, '/')) = 4
    and cardinality(storage.foldername(name)) = 3
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'logos'
    and split_part(name, '/', 4) <> ''
    and (select public.current_active_app_role()) = 'merchant'
    and (select public.owns_store(public.safe_uuid((storage.foldername(name))[2])))
);

create policy store_logos_storage_delete_unreferenced_own
on storage.objects for delete to authenticated
using (
    bucket_id = 'store-logos'
    and cardinality(string_to_array(name, '/')) = 4
    and cardinality(storage.foldername(name)) = 3
    and (storage.foldername(name))[1] = 'stores'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'logos'
    and split_part(name, '/', 4) <> ''
    and (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.stores s
        where s.id = public.safe_uuid((storage.foldername(name))[2])
          and (select public.owns_store(s.id))
          and s.logo_url is distinct from storage.objects.name
    )
);

-- No Storage UPDATE policy. Logo replacement uses a trusted endpoint to upload,
-- set stores.logo_url to the new path, then delete the old unreferenced object.

-- ---------------------------------------------------------------------------
-- 25. Storage: delivery-evidence
-- Path: orders/{order_uuid}/delivery/{filename}
-- ---------------------------------------------------------------------------

create policy delivery_evidence_storage_select_participant
on storage.objects for select to authenticated
using (
    bucket_id = 'delivery-evidence'
    and cardinality(string_to_array(name, '/')) = 4
    and cardinality(storage.foldername(name)) = 3
    and (storage.foldername(name))[1] = 'orders'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'delivery'
    and split_part(name, '/', 4) <> ''
    and exists (
        select 1 from public.orders o
        where o.id = public.safe_uuid((storage.foldername(name))[2])
          and (
              o.customer_id = (select auth.uid())
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(o.store_id))
              )
          )
    )
);

create policy delivery_evidence_storage_insert_own_merchant_order
on storage.objects for insert to authenticated
with check (
    bucket_id = 'delivery-evidence'
    and cardinality(string_to_array(name, '/')) = 4
    and cardinality(storage.foldername(name)) = 3
    and (storage.foldername(name))[1] = 'orders'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and (storage.foldername(name))[3] = 'delivery'
    and split_part(name, '/', 4) <> ''
    and (select public.current_active_app_role()) = 'merchant'
    and exists (
        select 1 from public.orders o
        where o.id = public.safe_uuid((storage.foldername(name))[2])
          and (select public.owns_store(o.store_id))
    )
);

-- No update/delete policies for delivery evidence. Use new immutable objects.

-- ---------------------------------------------------------------------------
-- 26. Storage: return-evidence
-- Path: returns/{return_uuid}/{filename}
-- ---------------------------------------------------------------------------

create policy return_evidence_storage_select_participant
on storage.objects for select to authenticated
using (
    bucket_id = 'return-evidence'
    and cardinality(string_to_array(name, '/')) = 3
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = 'returns'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and split_part(name, '/', 3) <> ''
    and exists (
        select 1
        from public.returns r
        join public.orders o on o.id = r.order_id
        where r.id = public.safe_uuid((storage.foldername(name))[2])
          and (
              r.customer_id = (select auth.uid())
              or (
                  (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(o.store_id))
              )
          )
    )
);

create policy return_evidence_storage_insert_own_return
on storage.objects for insert to authenticated
with check (
    bucket_id = 'return-evidence'
    and cardinality(string_to_array(name, '/')) = 3
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = 'returns'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and split_part(name, '/', 3) <> ''
    and (select public.current_active_app_role()) = 'customer'
    and exists (
        select 1 from public.returns r
        where r.id = public.safe_uuid((storage.foldername(name))[2])
          and r.customer_id = (select auth.uid())
    )
);

-- No update/delete policies for return evidence. Use new immutable objects.

-- ---------------------------------------------------------------------------
-- 27. Storage: support-attachments
-- Path: tickets/{ticket_uuid}/{filename}
-- ---------------------------------------------------------------------------

create policy support_attachments_storage_select_participant
on storage.objects for select to authenticated
using (
    bucket_id = 'support-attachments'
    and cardinality(string_to_array(name, '/')) = 3
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = 'tickets'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and split_part(name, '/', 3) <> ''
    and exists (
        select 1 from public.support_tickets t
        where t.id = public.safe_uuid((storage.foldername(name))[2])
          and (
              t.customer_id = (select auth.uid())
              or (
                  t.assigned_to = (select auth.uid())
                  and t.store_id is not null
                  and (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(t.store_id))
              )
          )
    )
);

create policy support_attachments_storage_insert_participant
on storage.objects for insert to authenticated
with check (
    bucket_id = 'support-attachments'
    and cardinality(string_to_array(name, '/')) = 3
    and cardinality(storage.foldername(name)) = 2
    and (storage.foldername(name))[1] = 'tickets'
    and public.safe_uuid((storage.foldername(name))[2]) is not null
    and split_part(name, '/', 3) <> ''
    and exists (
        select 1 from public.support_tickets t
        where t.id = public.safe_uuid((storage.foldername(name))[2])
          and (
              t.customer_id = (select auth.uid())
              or (
                  t.assigned_to = (select auth.uid())
                  and t.store_id is not null
                  and (select public.current_active_app_role()) = 'merchant'
                  and (select public.owns_store(t.store_id))
              )
          )
    )
);

-- No update/delete policies for support attachments. Files are immutable.

-- ---------------------------------------------------------------------------
-- 28. Function permissions and comments
-- ---------------------------------------------------------------------------

-- Helpers required by policies are callable only where the policy design needs
-- them. They expose no privileged Super Admin data access.
revoke all on function public.safe_uuid(text) from public, anon, authenticated, service_role;
grant execute on function public.safe_uuid(text) to anon, authenticated, service_role;

revoke all on function public.current_active_app_role() from public, anon, authenticated, service_role;
grant execute on function public.current_active_app_role() to anon, authenticated, service_role;

revoke all on function public.owns_store(uuid) from public, anon, authenticated, service_role;
grant execute on function public.owns_store(uuid) to anon, authenticated, service_role;

-- Migration 003's payment_transactions_read_authorized policy references
-- is_super_admin(). Keep it executable for policy evaluation, but it returns
-- FALSE for anon/authenticated JWTs even when the subject's profile role is
-- super_admin. Trusted server endpoints must independently validate network/IP,
-- TOTP/MFA, and per-action authorization; service_role bypasses RLS and is never
-- exposed to clients.
revoke all on function public.is_super_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_super_admin() to authenticated, service_role;

-- No unused legacy helper functions are referenced or granted by this migration.

comment on function public.current_active_app_role() is
    'Returns only the authenticated caller profile role when active; never grants Super Admin privileged data access.';
comment on function public.is_super_admin() is
    'Fails closed for anon/authenticated JWTs. Does not verify network/IP allowlisting or TOTP/MFA; trusted endpoints must do so.';
comment on function public.owns_store(uuid) is
    'True only for the authenticated active Merchant who owns the specified store.';
comment on function public.safe_uuid(text) is
    'Safe parser defined in Migration 001; malformed UUID input returns NULL.';
comment on table public.audit_logs is
    'Direct client access is denied. Privileged audit reads/writes require trusted endpoints with network allowlist and TOTP/MFA enforcement.';
comment on table public.product_images is
    'Delete workflow: validate ownership, delete the exact Storage object while metadata exists, then delete metadata. If metadata deletion fails, retry it after confirming the object is absent.';

commit;
