# Migrations

Versioned SQL migrations in `supabase/migrations/`, applied in filename order by `supabase db reset` / `supabase db push`. Each runs in one transaction. Migrations after 004 are additive: they never drop or rename a table, column or policy that an earlier migration created, and they use `IF [NOT] EXISTS` / `CREATE OR REPLACE` so they are safe to re-run. Every file header explains **why** it exists and how to roll it back.

| # | File | Origin | What it does |
|---|---|---|---|
| 001 | `20261021000100_core_schema.sql` | **Reconstructed** (original not supplied) | Core tables from SRS §18.1 and DATABASE_SCHEMA.md: constraints, indexes, `updated_at` triggers, append-only guards, simple/variant stock-model invariants (DB-08), same-store relationship guards, safe profile provisioning |
| 002 | `20261021000200_rls_storage.sql` | **Reconstructed** (original not supplied) | RLS on every table, least-privilege grants (revoke-all-then-grant), authorization helpers `owns_store` / `is_super_admin`, private Storage buckets and `storage.objects` policies (§19.1, RLS_POLICY_MATRIX.md) |
| 003 | `20261021000300_payment_transactions_option_b.sql` | **Original, unchanged** | `payment_transactions` (Option B lifecycle), immutable facts, status guard, trusted functions, safe-column read grants |
| 004 | `20261021000400_payment_attempt_safeguards.sql` | **Original, unchanged** | Attempt eligibility, mandatory enabled configuration, one active attempt per order, split audit events |
| 005 | `20261023000500_frontend_alignment_schema.sql` | New | Columns the SRS workflows and the frontend need (see SCHEMA_CHANGES.md): order numbers, totals, idempotency, dispute state, ticket queue, SKU, original price, store shipping/notification settings, payment config hints. `private` schema: reference counters, rate limits, login attempts, admin IP allowlist, app settings |
| 006 | `20261023000600_authorization_and_auth_hooks.sql` | New | Helpers `current_user_id`, `current_active_app_role`, `current_store_id`, `is_merchant`, `is_customer`, `owns_product`, `owns_order`, `can_read_order`, `can_read_return`, `can_access_ticket`; Super Admin gate (role + aal2 + allowlisted IP); server-side role assignment at sign-up; `grant_super_admin`; access-token and password-verification hooks |
| 007 | `20261023000700_commerce_workflows.sql` | New | Store setup, catalogue RPCs, atomic `create_order`, payment flows (`submit_wallet_reference`, `prepare_sslcommerz_payment`, `apply_payment_result`), `transition_order_status`, COD collection, `adjust_inventory`, cart validation, tracking, credentials in Vault |
| 008 | `20261023000800_returns_refunds_support.sql` | New | Return workflow (§14.1), refunds (§14.2), ticket routing, 72-hour escalation, ticket audit (§15) |
| 009 | `20261023000900_admin_notifications_realtime_analytics.sql` | New | Super Admin operations, notifications and device tokens, push claiming, rate limits, dashboards, Realtime publication, Storage additions |
| 010 | `20261025001000_foreign_key_indexes.sql` | New | Covering indexes for 17 foreign keys (Supabase advisor 0001) |
| 011 | `20261027001100_visits_sessions_hardening.sql` | New | Storefront visit analytics (unique sessions, no personal data), list/revoke own sessions, end sessions on suspension or deletion, media paths limited to the owner's folder |
| 012 | `20261028001200_storefront_contact_popularity_admin_trends.sql` | New | `resolve_store` returns merchant phone/email (FR-C-25); `storefront_product_popularity` (units only); previous-period counts in `admin_dashboard` |
| 013 | `20261028001300_stock_model_check_definer.sql` | New (**correction**) | Deferred stock-model triggers run as definer. Without this, a merchant creating a product failed at COMMIT with `permission denied for function assert_product_stock_model` |
| 014 | `20261028001400_payment_reads_for_trusted_functions.sql` | New (**correction**) | Trusted readers `payment_snapshot`, `pending_verification_attempt` and `sslcommerz_attempt_context` (service role only). Migration 003 gives `service_role` no table access, so the Edge Functions' direct reads returned nothing and payments could never be verified |
| 015 | `20261029001500_policy_date_business_timezone.sql` | New (**correction**) | Policy effective dates are checked against the Asia/Dhaka date like every other business date, not the server's timezone (hosted Supabase runs in UTC) |

`supabase/seed.sql` adds six starter storefront themes for local and dev databases. It creates no accounts.

## About 001 and 002

The backend brief asked to preserve `20261021000100_core_schema.sql` and `20261021000200_rls_storage.sql`, but those two files were never attached; only 003, 004 and three test files were. Migration 003 cannot run without them, so they were rebuilt from SRS V2.1 §18–§19, DATABASE_SCHEMA.md, RLS_POLICY_MATRIX.md and every name that 003, 004 and the supplied tests reference (columns, constraint and trigger names, error codes). Both files say so in their header.

**If you have the originals:** replace these two files with them and run `supabase db reset && supabase test db`. Migrations 005+ are written defensively (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP … IF EXISTS` before re-creating policies), so they should apply on top. Differences will show up in the test run.

## Corrections made after a migration was written

No applied migration was edited. Problems found later were fixed by new migrations (013, 014, 015), each documenting the cause. Two of the supplied test files had a pgTAP argument mistake; see [TEST_CORRECTIONS.md](TEST_CORRECTIONS.md).

## Rollback

Each file ends with a commented "Down" block. Rolling back 012–015 is a few statements. Rolling back 005–011 in production means restoring a backup taken before `db push`, because they add columns that later data depends on. Follow DEP-07 (documented, tested rollback within 15 minutes): take a backup before every push and practise the restore in staging.

## Validation

See `docs/reports/MIGRATION_VALIDATION.md` for what was run and the results.
