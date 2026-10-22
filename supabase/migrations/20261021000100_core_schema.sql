
-- =============================================================================
-- BazarHQ SRS Version 2.1
-- Stage 1 / Migration 001: Core application schema
--
-- This migration creates the 23 core application tables.
-- payment_transactions is deliberately excluded; migration 003 creates it.
-- auth.users remains managed by Supabase Auth.
--
-- Apply only to a disposable/local development database until reviewed.
-- No production secrets, provider credentials, or default admin accounts.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Profiles and reusable security/timestamp helpers
-- ---------------------------------------------------------------------------

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default '',
    phone text,
    avatar_url text,
    role text not null default 'customer'
        check (role in ('customer', 'merchant', 'super_admin')),
    status text not null default 'active'
        check (status in ('active', 'suspended')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint profiles_phone_format_check
        check (phone is null or phone ~ '^[0-9]{11}$')
);

comment on table public.profiles is
    'Canonical application profile. auth.users remains managed by Supabase Auth.';
comment on column public.profiles.role is
    'Assigned only through authorized server-side role administration.';
comment on column public.profiles.status is
    'Account status. Privileged status changes must use trusted server-side logic.';


-- Standard updated_at trigger helper.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := clock_timestamp();
    return new;
end;
$$;


-- Return true only when the authenticated active Merchant owns this store.
-- SECURITY DEFINER avoids recursive RLS evaluation on the ownership lookup.
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
    );
$$;


-- Return true only for the authenticated active Super Admin.
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.profiles p
        where p.id = (select auth.uid())
          and p.role = 'super_admin'
          and p.status = 'active'
    );
$$;


-- Create a basic Customer profile for a new Supabase Auth user.
-- Never trust user-supplied metadata for role assignment.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_name text;
    v_phone text;
begin
    v_name := coalesce(
        nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
        split_part(coalesce(new.email, ''), '@', 1),
        'User'
    );

    v_phone := nullif(trim(new.raw_user_meta_data ->> 'phone'), '');

    if v_phone is not null and v_phone !~ '^[0-9]{11}$' then
        v_phone := null;
    end if;

    insert into public.profiles (id, full_name, phone, role, status)
    values (new.id, v_name, v_phone, 'customer', 'active')
    on conflict (id) do nothing;

    return new;
end;
$$;

create trigger on_auth_user_created_create_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();


-- Prevent profile role/status changes through ordinary client requests.
-- A trusted service-role endpoint must perform approved role administration.
create or replace function public.guard_profile_privileged_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_jwt_role text;
begin
    if new.role is distinct from old.role
       or new.status is distinct from old.status then

        v_jwt_role := current_setting('request.jwt.claim.role', true);

        if coalesce(v_jwt_role, '') not in
           ('service_role', 'supabase_admin')
           and current_user not in ('postgres', 'supabase_admin') then
            raise exception
                'Profile role and status changes require trusted server-side authorization'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

create trigger profiles_guard_privileged_fields
before update on public.profiles
for each row execute function public.guard_profile_privileged_fields();


-- ---------------------------------------------------------------------------
-- 2. Themes and merchant stores
-- ---------------------------------------------------------------------------

create table public.themes (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,
    description text,
    preview_url text,
    is_active boolean not null default true,
    created_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.stores (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null unique
        references public.profiles(id) on delete restrict,
    name text not null check (length(trim(name)) between 1 and 160),
    subdomain text not null unique,
    status text not null default 'draft'
        check (status in ('draft', 'published', 'suspended')),
    theme_id uuid references public.themes(id) on delete set null,
    brand_colour text,
    tagline text,
    logo_url text,
    return_window_days integer not null default 7
        check (return_window_days >= 1),
    onboarding_progress integer not null default 0
        check (onboarding_progress between 0 and 100),
    onboarding_state jsonb not null default '{}'::jsonb
        check (jsonb_typeof(onboarding_state) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint stores_subdomain_format_check
        check (subdomain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'),
    constraint stores_reserved_subdomain_check
        check (subdomain !~
            '^(admin|api|www|app|mail|help|support|static)$')
);

comment on table public.stores is
    'One store per Merchant in Version 2.1. Public storefronts use unique subdomains.';
comment on column public.stores.return_window_days is
    'Merchant-configurable return window; approved default is seven calendar days.';
comment on column public.stores.onboarding_state is
    'Non-secret onboarding progress only; never store credentials or tokens here.';


create or replace function public.validate_store_owner_and_theme()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.profiles p
        where p.id = new.owner_id
          and p.role = 'merchant'
          and p.status = 'active'
    ) then
        raise exception
            'A store owner must be an active Merchant profile'
            using errcode = '23514';
    end if;

    if new.theme_id is not null and not exists (
        select 1
        from public.themes t
        where t.id = new.theme_id
          and t.is_active = true
    ) then
        raise exception
            'A store may select only an active theme'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create trigger stores_validate_owner_and_theme
before insert or update of owner_id, theme_id
on public.stores
for each row execute function public.validate_store_owner_and_theme();


-- ---------------------------------------------------------------------------
-- 3. Categories, products, variants, and product image metadata
-- ---------------------------------------------------------------------------

create table public.categories (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    name text not null check (length(trim(name)) between 1 and 120),
    slug text not null check (length(trim(slug)) between 1 and 160),
    parent_id uuid,
    display_order integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint categories_id_store_unique unique (id, store_id),
    constraint categories_store_slug_unique unique (store_id, slug),
    constraint categories_parent_same_store_fk
        foreign key (parent_id, store_id)
        references public.categories(id, store_id)
        on delete restrict,
    constraint categories_not_own_parent_check
        check (parent_id is null or parent_id <> id)
);

create table public.products (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    category_id uuid,
    name text not null check (length(trim(name)) between 1 and 200),
    description text not null default '',
    sku text,
    base_price numeric(12,2) not null check (base_price >= 0),
    product_type text not null
        check (product_type in ('simple', 'variant')),
    stock_quantity integer,
    low_stock_threshold integer not null default 5
        check (low_stock_threshold >= 0),
    status text not null default 'draft'
        check (status in ('draft', 'published', 'archived')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint products_id_store_unique unique (id, store_id),
    constraint products_category_same_store_fk
        foreign key (category_id, store_id)
        references public.categories(id, store_id)
        on delete restrict,
    constraint products_store_sku_unique unique (store_id, sku),

    -- Exactly one stock source is allowed for each product type.
    constraint products_stock_model_check check (
        (product_type = 'simple' and stock_quantity is not null
            and stock_quantity >= 0)
        or
        (product_type = 'variant' and stock_quantity is null)
    )
);

comment on column public.products.stock_quantity is
    'Authoritative stock for simple products only. NULL for variant products.';
comment on column public.products.low_stock_threshold is
    'For variant products, compare against each sellable variant; do not store aggregate stock.';


create table public.product_variants (
    id uuid primary key default gen_random_uuid(),
    product_id uuid not null
        references public.products(id) on delete restrict,
    variant_label text not null
        check (length(trim(variant_label)) between 1 and 160),
    price_adjustment numeric(12,2) not null default 0,
    stock_quantity integer not null check (stock_quantity >= 0),
    status text not null default 'active'
        check (status in ('active', 'inactive')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint product_variants_id_product_unique unique (id, product_id),
    constraint product_variants_label_unique unique (product_id, variant_label)
);


-- The SRS requires variant products to have one or more variants.
-- Deferred checks allow a product and its first variant to be inserted in
-- the same transaction before the invariant is evaluated at commit time.
-- Validate both the old and new product when a variant is moved.
-- This prevents a variant product from being left without variants.

create or replace function public.assert_product_stock_model()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_product_ids uuid[];
    v_product_id uuid;
    v_product_type text;
    v_stock_quantity integer;
    v_variant_count bigint;
begin
    -- Determine which parent products need validation.
    if tg_table_name = 'products' then
        v_product_ids := array[new.id];
    elsif tg_op = 'INSERT' then
        v_product_ids := array[new.product_id];
    elsif tg_op = 'DELETE' then
        v_product_ids := array[old.product_id];
    else
        -- UPDATE: validate both the previous and new parent.
        v_product_ids := array[old.product_id, new.product_id];
    end if;

    foreach v_product_id in array v_product_ids
    loop
        if v_product_id is null then
            continue;
        end if;

        -- Serialize validation for the product being checked.
        select p.product_type, p.stock_quantity
          into v_product_type, v_stock_quantity
        from public.products p
        where p.id = v_product_id
        for update;

        -- The product may have been deleted in this transaction.
        if not found then
            continue;
        end if;

        select count(*)
          into v_variant_count
        from public.product_variants pv
        where pv.product_id = v_product_id;

        if v_product_type = 'simple'
           and v_variant_count <> 0 then
            raise exception
                'Simple products must not have product variant rows'
                using errcode = '23514';
        end if;

        if v_product_type = 'variant' then
            if v_stock_quantity is not null then
                raise exception
                    'Variant products must have NULL products.stock_quantity'
                    using errcode = '23514';
            end if;

            if v_variant_count < 1 then
                raise exception
                    'A variant product must have at least one variant at commit'
                    using errcode = '23514';
            end if;
        end if;
    end loop;

    return null;
end;
$$;


-- Populate and validate the immutable product/variant description snapshot
-- on order items at insert time.
create or replace function public.validate_order_item_product()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_product public.products%rowtype;
    v_variant public.product_variants%rowtype;
begin
    select * into v_product
    from public.products p
    where p.id = new.product_id
      and p.store_id = new.store_id;

    if not found then
        raise exception
            'Order item product must belong to the order store'
            using errcode = '23503';
    end if;

    if v_product.product_type = 'simple' then
        if new.variant_id is not null then
            raise exception
                'Simple products cannot have an order-item variant'
                using errcode = '23514';
        end if;
        new.variant_label_snapshot := null;
    else
        if new.variant_id is null then
            raise exception
                'Variant products require a selected variant'
                using errcode = '23514';
        end if;

        select * into v_variant
        from public.product_variants pv
        where pv.id = new.variant_id
          and pv.product_id = new.product_id;

        if not found then
            raise exception
                'Selected variant does not belong to the selected product'
                using errcode = '23503';
        end if;

        new.variant_label_snapshot := v_variant.variant_label;
    end if;

    new.product_name_snapshot := v_product.name;
    return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Orders and immutable order-item snapshots
-- ---------------------------------------------------------------------------

create table public.orders (
    id uuid primary key default gen_random_uuid(),
    order_number text not null unique,
    store_id uuid not null references public.stores(id) on delete restrict,
    customer_id uuid references public.profiles(id) on delete set null,
    order_phone text not null check (order_phone ~ '^[0-9]{11}$'),
    order_email text,
    status text not null default 'pending'
        check (status in (
            'pending', 'confirmed', 'processing', 'shipped',
            'out_for_delivery', 'delivered', 'cancelled'
        )),
    total_amount numeric(12,2) not null check (total_amount >= 0),
    subtotal_amount numeric(12,2) not null check (subtotal_amount >= 0),
    delivery_fee numeric(12,2) not null default 0 check (delivery_fee >= 0),
    currency text not null default 'BDT' check (currency = 'BDT'),
    payment_method text not null
        check (payment_method in ('bkash', 'nagad', 'rocket', 'sslcommerz', 'cod')),
    payment_status text not null default 'pending'
        check (payment_status in (
            'pending', 'pending_verification', 'paid', 'failed',
            'cod_pending', 'cod_collected', 'refunded'
        )),
    delivery_address jsonb not null
        check (jsonb_typeof(delivery_address) = 'object'),
    cancellation_reason text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint orders_id_store_unique unique (id, store_id),
    constraint orders_amount_breakdown_check
        check (total_amount = subtotal_amount + delivery_fee),
    constraint orders_cancel_reason_check
        check (status <> 'cancelled' or nullif(trim(cancellation_reason), '') is not null)
);

create index orders_store_created_idx
    on public.orders(store_id, created_at desc);
create index orders_customer_created_idx
    on public.orders(customer_id, created_at desc);
create index orders_store_status_idx
    on public.orders(store_id, status, created_at desc);
create index orders_payment_status_idx
    on public.orders(payment_status, created_at);


-- State columns are reserved for trusted server-side operations.
-- Actual provider verification and orders.payment_status orchestration remain
-- the responsibility of the authorized server workflow.
create or replace function public.guard_order_state_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_jwt_role text;
begin
    if new.status is distinct from old.status
       or new.payment_status is distinct from old.payment_status then

        v_jwt_role := current_setting('request.jwt.claim.role', true);

        if coalesce(v_jwt_role, '') <> 'service_role'
           and current_user not in ('postgres', 'supabase_admin') then
            raise exception
                'Order and payment status changes require trusted server-side operations'
                using errcode = '42501';
        end if;
    end if;

    return new;
end;
$$;

create trigger orders_guard_state_changes
before update on public.orders
for each row execute function public.guard_order_state_changes();


create table public.order_items (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null,
    store_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    product_name_snapshot text not null,
    variant_label_snapshot text,
    quantity integer not null check (quantity > 0),
    unit_price numeric(12,2) not null check (unit_price >= 0),
    subtotal numeric(12,2) not null check (subtotal >= 0),
    created_at timestamptz not null default now(),

    constraint order_items_order_store_fk
        foreign key (order_id, store_id)
        references public.orders(id, store_id)
        on delete restrict,
    constraint order_items_product_store_fk
        foreign key (product_id, store_id)
        references public.products(id, store_id)
        on delete restrict,
    constraint order_items_variant_product_fk
        foreign key (variant_id, product_id)
        references public.product_variants(id, product_id)
        on delete restrict,
    constraint order_items_subtotal_check
        check (subtotal = quantity * unit_price)
);

create index order_items_order_idx on public.order_items(order_id);
create index order_items_product_idx on public.order_items(product_id);


create trigger order_items_validate_product_before_insert
before insert on public.order_items
for each row execute function public.validate_order_item_product();


-- ---------------------------------------------------------------------------
-- 5. Store payment configuration
-- ---------------------------------------------------------------------------

create table public.payment_configs (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null references public.stores(id) on delete restrict,
    method text not null
        check (method in ('bkash', 'nagad', 'rocket', 'sslcommerz', 'cod')),
    is_enabled boolean not null default false,
    credentials_encrypted text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint payment_configs_store_method_unique unique (store_id, method),
    constraint payment_configs_cod_credentials_check
        check (method <> 'cod' or credentials_encrypted is null)
);

comment on column public.payment_configs.credentials_encrypted is
    'Ciphertext only. Actual key management/encryption must be implemented in trusted server-side configuration; never store plaintext credentials.';


-- ---------------------------------------------------------------------------
-- 6. Delivery events (append-only merchant-managed delivery/COD history)
-- ---------------------------------------------------------------------------

create table public.delivery_events (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.orders(id) on delete restrict,
    actor_id uuid references public.profiles(id) on delete set null,
    event_type text not null
        check (event_type in (
            'pending', 'confirmed', 'processing', 'shipped',
            'out_for_delivery', 'delivered', 'cancelled', 'cod_collected'
        )),
    notes text,
    proof_image_path text,
    cod_amount numeric(12,2) check (cod_amount is null or cod_amount >= 0),
    created_at timestamptz not null default now()
);

create index delivery_events_order_created_idx
    on public.delivery_events(order_id, created_at);


-- ---------------------------------------------------------------------------
-- 7. Returns and refunds
-- ---------------------------------------------------------------------------

create table public.returns (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null unique references public.orders(id) on delete restrict,
    customer_id uuid not null references public.profiles(id) on delete restrict,
    reason text not null,
    condition_description text not null default '',
    evidence_storage_path text,
    status text not null default 'requested'
        check (status in ('requested', 'approved', 'rejected', 'received', 'closed')),
    merchant_response text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    received_at timestamptz
);

create index returns_customer_created_idx
    on public.returns(customer_id, created_at desc);


create table public.refunds (
    id uuid primary key default gen_random_uuid(),
    return_id uuid not null unique references public.returns(id) on delete restrict,
    amount numeric(12,2) not null check (amount >= 0),
    method text not null
        check (method in ('bkash', 'nagad', 'rocket', 'bank_transfer', 'manual', 'sslcommerz')),
    status text not null default 'initiated'
        check (status in ('initiated', 'processing', 'completed', 'failed')),
    gateway_reference text,
    initiator_id uuid references public.profiles(id) on delete set null,
    processed_at timestamptz,
    confirmation_reference text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint refunds_completed_evidence_check
        check (
            status <> 'completed'
            or nullif(trim(confirmation_reference), '') is not null
        )
);

create index refunds_status_created_idx
    on public.refunds(status, created_at);


-- ---------------------------------------------------------------------------
-- 8. Support tickets, messages, and immutable ticket audit history
-- ---------------------------------------------------------------------------

create table public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    ticket_number text not null unique,
    customer_id uuid not null references public.profiles(id) on delete restrict,
    store_id uuid references public.stores(id) on delete restrict,
    order_id uuid,
    category text not null
        check (category in (
            'order_issue', 'payment_issue', 'delivery_issue',
            'return_refund', 'account_issue', 'other'
        )),
    subject text not null check (length(trim(subject)) between 1 and 200),
    description text not null check (length(trim(description)) > 0),
    priority text not null default 'normal'
        check (priority in ('normal', 'urgent')),
    status text not null default 'open'
        check (status in (
            'open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'
        )),
    assigned_to uuid references public.profiles(id) on delete set null,
    resolution_note text,
    first_merchant_response_at timestamptz,
    escalation_at timestamptz not null default (now() + interval '72 hours'),
    closed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint support_tickets_order_store_fk
        foreign key (order_id, store_id)
        references public.orders(id, store_id)
        on delete restrict,
    constraint support_tickets_order_requires_store_check
        check (order_id is null or store_id is not null),
    constraint support_tickets_resolved_note_check
        check (status <> 'resolved' or nullif(trim(resolution_note), '') is not null)
);

create index support_tickets_customer_created_idx
    on public.support_tickets(customer_id, created_at desc);
create index support_tickets_store_status_idx
    on public.support_tickets(store_id, status, created_at);
create index support_tickets_assignee_status_idx
    on public.support_tickets(assigned_to, status, created_at);


create table public.ticket_messages (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null
        references public.support_tickets(id) on delete restrict,
    sender_id uuid not null references public.profiles(id) on delete restrict,
    body text not null check (length(trim(body)) > 0),
    attachment_storage_path text,
    created_at timestamptz not null default now()
);

create index ticket_messages_ticket_created_idx
    on public.ticket_messages(ticket_id, created_at);


create table public.ticket_audit_log (
    id uuid primary key default gen_random_uuid(),
    ticket_id uuid not null
        references public.support_tickets(id) on delete restrict,
    actor_id uuid references public.profiles(id) on delete set null,
    event_type text not null
        check (event_type in (
            'created', 'status_changed', 'reply_added', 'assignment_changed',
            'escalated', 'closed', 'reopened', 'priority_changed'
        )),
    previous_value jsonb,
    new_value jsonb,
    message_id uuid references public.ticket_messages(id) on delete set null,
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    created_at timestamptz not null default now()
);

create index ticket_audit_log_ticket_created_idx
    on public.ticket_audit_log(ticket_id, created_at);


-- ---------------------------------------------------------------------------
-- 9. Inventory movement ledger
-- ---------------------------------------------------------------------------

create table public.inventory_movements (
    id uuid primary key default gen_random_uuid(),
    store_id uuid not null,
    product_id uuid not null,
    variant_id uuid,
    quantity_delta integer not null check (quantity_delta <> 0),
    reason text not null
        check (reason in (
            'sale', 'return', 'manual_adjustment', 'cancellation_release', 'import'
        )),
    actor_id uuid references public.profiles(id) on delete set null,
    reference_type text not null
        check (reference_type in (
            'order', 'return', 'cancellation', 'manual_adjustment', 'import'
        )),
    reference_id uuid,
    created_at timestamptz not null default now(),

    constraint inventory_movements_product_store_fk
        foreign key (product_id, store_id)
        references public.products(id, store_id)
        on delete restrict,
    constraint inventory_movements_variant_product_fk
        foreign key (variant_id, product_id)
        references public.product_variants(id, product_id)
        on delete restrict
);

create index inventory_movements_store_created_idx
    on public.inventory_movements(store_id, created_at desc);
create index inventory_movements_product_created_idx
    on public.inventory_movements(product_id, created_at desc);
create index inventory_movements_reference_idx
    on public.inventory_movements(reference_type, reference_id);


create or replace function public.validate_inventory_movement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_product_type text;
begin
    select p.product_type
      into v_product_type
    from public.products p
    where p.id = new.product_id
      and p.store_id = new.store_id;

    if not found then
        raise exception
            'Inventory movement product must belong to its declared store'
            using errcode = '23503';
    end if;

    if v_product_type = 'simple' and new.variant_id is not null then
        raise exception
            'Simple-product inventory movement must have NULL variant_id'
            using errcode = '23514';
    end if;

    if v_product_type = 'variant' and new.variant_id is null then
        raise exception
            'Variant-product inventory movement requires variant_id'
            using errcode = '23514';
    end if;

    if new.variant_id is not null and not exists (
        select 1
        from public.product_variants pv
        where pv.id = new.variant_id
          and pv.product_id = new.product_id
    ) then
        raise exception
            'Inventory movement variant must belong to the referenced product'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create trigger inventory_movements_validate_before_insert
before insert on public.inventory_movements
for each row execute function public.validate_inventory_movement();


-- ---------------------------------------------------------------------------
-- 10. Notifications and device tokens
-- ---------------------------------------------------------------------------

create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    type text not null,
    title text not null,
    body text not null default '',
    is_read boolean not null default false,
    reference_type text,
    reference_id uuid,
    created_at timestamptz not null default now(),

    constraint notifications_reference_type_check
        check (
            reference_type is null
            or reference_type in (
                'store', 'product', 'order', 'payment_transaction',
                'return', 'refund', 'support_ticket', 'announcement', 'policy'
            )
        ),
    constraint notifications_reference_pair_check
        check (
            (reference_type is null and reference_id is null)
            or
            (reference_type is not null and reference_id is not null)
        )
);

create index notifications_user_created_idx
    on public.notifications(user_id, created_at desc);
create index notifications_user_unread_idx
    on public.notifications(user_id, created_at desc)
    where is_read = false;


create table public.device_tokens (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles(id) on delete cascade,
    token text not null unique,
    platform text not null default 'android'
        check (platform = 'android'),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),

    constraint device_tokens_user_token_unique unique (user_id, token)
);

create index device_tokens_user_idx on public.device_tokens(user_id);


-- ---------------------------------------------------------------------------
-- 11. Append-only system audit log
-- ---------------------------------------------------------------------------

create table public.audit_logs (
    id uuid primary key default gen_random_uuid(),
    actor_id uuid references public.profiles(id) on delete set null,
    action text not null,
    resource_type text not null,
    resource_id uuid,
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    ip_address inet,
    created_at timestamptz not null default now()
);

create index audit_logs_resource_created_idx
    on public.audit_logs(resource_type, resource_id, created_at desc);
create index audit_logs_actor_created_idx
    on public.audit_logs(actor_id, created_at desc);
create index audit_logs_created_idx
    on public.audit_logs(created_at desc);


-- Shared guard for append-only tables.
create or replace function public.prevent_append_only_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    raise exception
        'Append-only history cannot be updated or deleted: %.%',
        tg_table_schema, tg_table_name
        using errcode = '55000';
end;
$$;

create trigger audit_logs_append_only
before update or delete on public.audit_logs
for each row execute function public.prevent_append_only_mutation();

create trigger ticket_audit_log_append_only
before update or delete on public.ticket_audit_log
for each row execute function public.prevent_append_only_mutation();

create trigger delivery_events_append_only
before update or delete on public.delivery_events
for each row execute function public.prevent_append_only_mutation();

create trigger inventory_movements_append_only
before update or delete on public.inventory_movements
for each row execute function public.prevent_append_only_mutation();

create trigger ticket_messages_append_only
before update or delete on public.ticket_messages
for each row execute function public.prevent_append_only_mutation();

create trigger order_items_append_only
before update or delete on public.order_items
for each row execute function public.prevent_append_only_mutation();


-- ---------------------------------------------------------------------------
-- 12. Announcements and versioned policies
-- ---------------------------------------------------------------------------

create table public.announcements (
    id uuid primary key default gen_random_uuid(),
    title text not null check (length(trim(title)) between 1 and 200),
    body text not null check (length(trim(body)) > 0),
    audience text not null
        check (audience in ('all', 'merchants', 'customers', 'public')),
    status text not null default 'draft'
        check (status in ('draft', 'scheduled', 'sent')),
    scheduled_at timestamptz,
    sent_at timestamptz,
    sent_by uuid references public.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint announcements_schedule_check
        check (status <> 'scheduled' or scheduled_at is not null),
    constraint announcements_sent_check
        check (
            status <> 'sent'
            or (sent_at is not null and sent_by is not null)
        )
);


create or replace function public.guard_sent_announcement()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if old.status = 'sent' then
        raise exception
            'Sent announcements are immutable'
            using errcode = '55000';
    end if;

    if tg_op = 'DELETE' and old.status = 'sent' then
        raise exception
            'Sent announcements cannot be deleted'
            using errcode = '55000';
    end if;

    return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger announcements_guard_sent_update
before update or delete on public.announcements
for each row execute function public.guard_sent_announcement();


create table public.policies (
    id uuid primary key default gen_random_uuid(),
    type text not null check (type in ('tos', 'privacy')),
    version text not null check (length(trim(version)) between 1 and 50),
    content text not null check (length(trim(content)) > 0),
    effective_date date,
    submitted_by uuid not null references public.profiles(id) on delete restrict,
    approved_by uuid references public.profiles(id) on delete restrict,
    approved_at timestamptz,
    status text not null default 'draft'
        check (status in (
            'draft', 'pending_approval', 'approved', 'published', 'rejected'
        )),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint policies_type_version_unique unique (type, version),
    constraint policies_approval_separation_check
        check (approved_by is null or approved_by <> submitted_by),
    constraint policies_approved_fields_check
        check (
            status not in ('approved', 'published')
            or (
                approved_by is not null
                and approved_at is not null
                and effective_date is not null
            )
        )
);


create or replace function public.validate_policy_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_submitter_role text;
    v_approver_role text;
begin
    select p.role into v_submitter_role
    from public.profiles p
    where p.id = new.submitted_by;

    if v_submitter_role is distinct from 'super_admin' then
        raise exception
            'Policy submitter must be a Super Admin'
            using errcode = '23514';
    end if;

    if new.status in ('approved', 'published') then
        select p.role into v_approver_role
        from public.profiles p
        where p.id = new.approved_by;

        if new.approved_by is null
           or new.approved_by = new.submitted_by
           or v_approver_role is distinct from 'super_admin'
           or new.approved_at is null
           or new.effective_date is null then
            raise exception
                'Policy publication requires approval by a different Super Admin and an effective date'
                using errcode = '23514';
        end if;
    end if;

    if tg_op = 'UPDATE' and old.status = 'published'
       and (
           new.type is distinct from old.type
           or new.version is distinct from old.version
           or new.content is distinct from old.content
           or new.effective_date is distinct from old.effective_date
           or new.submitted_by is distinct from old.submitted_by
           or new.approved_by is distinct from old.approved_by
           or new.approved_at is distinct from old.approved_at
       ) then
        raise exception
            'Published policy versions are immutable; create a new version'
            using errcode = '55000';
    end if;

    return new;
end;
$$;

create trigger policies_validate_approval
before insert or update on public.policies
for each row execute function public.validate_policy_approval();


-- ---------------------------------------------------------------------------
-- 13. Saved customer addresses
-- ---------------------------------------------------------------------------

create table public.customer_addresses (
    id uuid primary key default gen_random_uuid(),
    customer_id uuid not null
        references public.profiles(id) on delete cascade,
    label text not null check (length(trim(label)) between 1 and 80),
    recipient_name text not null
        check (length(trim(recipient_name)) between 1 and 160),
    phone text not null check (phone ~ '^[0-9]{11}$'),
    address text not null check (length(trim(address)) > 0),
    district text not null check (length(trim(district)) > 0),
    postal_code text,
    is_default boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index customer_addresses_customer_idx
    on public.customer_addresses(customer_id);

create unique index customer_addresses_one_default_uq
    on public.customer_addresses(customer_id)
    where is_default = true;


-- Serialize address-count changes by locking the owning profile row.
-- This prevents concurrent requests from exceeding the three-address limit.
create or replace function public.enforce_customer_address_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
    v_customer_id uuid;
    v_role text;
    v_count bigint;
begin
    v_customer_id := new.customer_id;

    select p.role into v_role
    from public.profiles p
    where p.id = v_customer_id
    for update;

    if not found or v_role is distinct from 'customer' then
        raise exception
            'Saved addresses are available only to registered Customer profiles'
            using errcode = '23514';
    end if;

    select count(*) into v_count
    from public.customer_addresses ca
    where ca.customer_id = v_customer_id
      and ca.id is distinct from new.id;

    if v_count >= 3 then
        raise exception
            'A Customer may save at most three addresses'
            using errcode = '23514';
    end if;

    return new;
end;
$$;

create trigger customer_addresses_limit_before_write
before insert or update on public.customer_addresses
for each row execute function public.enforce_customer_address_limit();


-- ---------------------------------------------------------------------------
-- 14. Timestamp triggers for mutable tables
-- ---------------------------------------------------------------------------

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger themes_set_updated_at
before update on public.themes
for each row execute function public.set_updated_at();

create trigger stores_set_updated_at
before update on public.stores
for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
before update on public.categories
for each row execute function public.set_updated_at();

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_updated_at();

create trigger product_variants_set_updated_at
before update on public.product_variants
for each row execute function public.set_updated_at();

create trigger product_images_set_updated_at
before update on public.product_images
for each row execute function public.set_updated_at();

create trigger orders_set_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

create trigger payment_configs_set_updated_at
before update on public.payment_configs
for each row execute function public.set_updated_at();

create trigger returns_set_updated_at
before update on public.returns
for each row execute function public.set_updated_at();

create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

create trigger support_tickets_set_updated_at
before update on public.support_tickets
for each row execute function public.set_updated_at();

create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function public.set_updated_at();

create trigger policies_set_updated_at
before update on public.policies
for each row execute function public.set_updated_at();

create trigger customer_addresses_set_updated_at
before update on public.customer_addresses
for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 15. Search indexes
-- ---------------------------------------------------------------------------

create index products_store_status_idx
    on public.products(store_id, status);

create index products_category_idx
    on public.products(category_id)
    where category_id is not null;

create index products_name_search_gin
    on public.products
    using gin (
        to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(description, ''))
    );

create index stores_name_search_gin
    on public.stores
    using gin (to_tsvector('simple', coalesce(name, '')));

create index product_variants_product_status_idx
    on public.product_variants(product_id, status);

create index product_images_product_display_idx
    on public.product_images(product_id, display_order);


-- ---------------------------------------------------------------------------
-- 16. Helper function permissions
-- ---------------------------------------------------------------------------

-- RLS policies in migration 002 and payment migration 003 call these helpers.
-- They accept no arbitrary user ID; both evaluate the current authenticated user.
revoke all on function public.owns_store(uuid) from public;
revoke all on function public.is_super_admin() from public;
grant execute on function public.owns_store(uuid) to anon, authenticated, service_role;
grant execute on function public.is_super_admin() to anon, authenticated, service_role;

-- Keep internal trigger helpers unavailable as callable client APIs.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.guard_profile_privileged_fields() from public, anon, authenticated;
revoke all on function public.validate_store_owner_and_theme() from public, anon, authenticated;
revoke all on function public.assert_product_stock_model() from public, anon, authenticated;
revoke all on function public.validate_order_item_product() from public, anon, authenticated;
revoke all on function public.guard_order_state_changes() from public, anon, authenticated;
revoke all on function public.validate_inventory_movement() from public, anon, authenticated;
revoke all on function public.prevent_append_only_mutation() from public, anon, authenticated;
revoke all on function public.guard_sent_announcement() from public, anon, authenticated;
revoke all on function public.validate_policy_approval() from public, anon, authenticated;
revoke all on function public.enforce_customer_address_limit() from public, anon, authenticated;

-- Migration 002 will define table privileges, RLS policies, and Storage policies.
-- Do not treat this migration alone as a secure client-facing database.
