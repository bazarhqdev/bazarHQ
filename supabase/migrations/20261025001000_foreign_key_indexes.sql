-- =============================================================================
-- Migration 010 — covering indexes for foreign keys.
--
-- Why: Supabase's database advisor (splinter lint 0001 "unindexed_foreign_keys")
-- reported 17 foreign keys with no index whose leading columns match the key.
-- Without one, deleting or updating a referenced row (a profile, a variant, a
-- category, a ticket message) scans the whole referencing table, and the
-- ownership joins used by RLS and the dashboards get slower as data grows.
--
-- Additive only: no table, column, constraint, policy or function changes.
-- Every statement is idempotent (IF NOT EXISTS), so re-running is safe.
-- Column order matches each foreign key exactly, which is what the advisor checks.
--
-- Down (manual, if ever needed): drop index if exists public.<name>; for each below.
-- =============================================================================

-- Actor / author references to profiles (Super Admin and Merchant audit trails).
create index if not exists announcements_created_by_fk_idx on public.announcements (created_by);
create index if not exists announcements_sent_by_fk_idx on public.announcements (sent_by);
create index if not exists delivery_events_actor_id_fk_idx on public.delivery_events (actor_id);
create index if not exists inventory_movements_actor_id_fk_idx on public.inventory_movements (actor_id);
create index if not exists policies_approved_by_fk_idx on public.policies (approved_by);
create index if not exists policies_submitted_by_fk_idx on public.policies (submitted_by);
create index if not exists refunds_initiator_id_fk_idx on public.refunds (initiator_id);
create index if not exists themes_created_by_fk_idx on public.themes (created_by);
create index if not exists ticket_audit_log_actor_id_fk_idx on public.ticket_audit_log (actor_id);
create index if not exists ticket_messages_sender_id_fk_idx on public.ticket_messages (sender_id);

-- Same-store composite keys (tenant-consistency foreign keys from migration 001).
create index if not exists categories_parent_id_store_id_fk_idx on public.categories (parent_id, store_id);
create index if not exists products_category_id_store_id_fk_idx on public.products (category_id, store_id);
create index if not exists inventory_movements_product_id_store_id_fk_idx on public.inventory_movements (product_id, store_id);

-- Variant ↔ product consistency keys.
create index if not exists inventory_movements_variant_id_product_id_fk_idx on public.inventory_movements (variant_id, product_id);
create index if not exists order_items_variant_id_product_id_fk_idx on public.order_items (variant_id, product_id);

-- Ticket links.
create index if not exists support_tickets_order_id_fk_idx on public.support_tickets (order_id);
create index if not exists ticket_audit_log_message_id_fk_idx on public.ticket_audit_log (message_id);
