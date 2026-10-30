-- =============================================================================
-- Migration 013 — run the deferred stock-model checks with definer rights.
--
-- Found by the end-to-end adapter run against real GoTrue + PostgREST
-- (scripts/local-stack): a merchant creating a product through
-- create_product() failed at COMMIT with
--   permission denied for function assert_product_stock_model
--
-- Why: products_stock_model_ct and product_variants_stock_model_ct are
-- DEFERRABLE INITIALLY DEFERRED constraint triggers (DB-08 / FR-M-15: a
-- product is either "simple with stock" or "variant with ≥1 variant", checked
-- once the whole transaction is done). Deferred triggers fire at COMMIT,
-- after the SECURITY DEFINER RPC has returned, so they run as the calling
-- client role (`authenticated`). Their helper assert_product_stock_model() is
-- not executable by clients (least privilege, migration 002), and as the
-- caller the check would also only see rows that RLS lets the caller see.
-- The pgTAP suite never commits (every file rolls back), so it never fired
-- these triggers at commit time.
--
-- Fix: the two trigger functions become SECURITY DEFINER with an empty
-- search_path. Trigger functions cannot be called directly, so this widens
-- nothing; the invariant is simply checked with full visibility regardless of
-- who commits. Client EXECUTE on assert_product_stock_model() stays revoked.
--
-- Additive only: migration 001 is not edited. Rollback:
--   alter function public.check_product_stock_model() security invoker;
--   alter function public.check_variant_stock_model() security invoker;
-- =============================================================================

alter function public.check_product_stock_model() security definer;
alter function public.check_variant_stock_model() security definer;
alter function public.check_product_stock_model() set search_path = '';
alter function public.check_variant_stock_model() set search_path = '';

revoke all on function public.check_product_stock_model() from public, anon, authenticated;
revoke all on function public.check_variant_stock_model() from public, anon, authenticated;

comment on function public.check_product_stock_model() is
  'Deferred constraint trigger (DB-08): runs as definer because it fires at COMMIT, after the caller''s SECURITY DEFINER RPC has returned.';
comment on function public.check_variant_stock_model() is
  'Deferred constraint trigger (DB-08): runs as definer because it fires at COMMIT, after the caller''s SECURITY DEFINER RPC has returned.';
