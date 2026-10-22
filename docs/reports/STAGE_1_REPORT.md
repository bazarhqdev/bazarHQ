# BazarHQ Stage 1 Report — Database Schema, Migrations, and RLS

**Status: PARTIAL — payment transaction Option B approved and added; migrations and runtime tests not executed.**

## 1. Source and workspace audit

- Source of truth: `BazarHQ_SRS_V2.1_Final(5).docx`, the supplied final SRS attachment, especially §§6–9, 17–19, 21, 23–24, 26 and Appendix A.
- Accessible workspace audit found no BazarHQ application repository, `.git` repository, existing Supabase migration directory, schema SQL, or existing database test suite before this scaffold was created.
- A new Git repository and minimal Supabase project structure were created under `BazarHQ_Database_Stage1`; no prior application code or migrations were overwritten.
- `supabase`, `docker`, and `psql` executables were unavailable in this environment. Therefore no local Supabase service could be started and no migration could be applied.

## 2. Files created

- `supabase/config.toml`
- `supabase/migrations/20261021000100_core_schema.sql`
- `supabase/migrations/20261021000200_rls_storage.sql`
- `supabase/migrations/20261021000300_payment_transactions_option_b.sql`
- `supabase/migrations/20261021000400_payment_attempt_safeguards.sql`
- `supabase/tests/database_schema.test.sql`
- `supabase/tests/payment_transactions_safeguards.test.sql`
- `supabase/tests/rls_policy_catalog.test.sql`
- `supabase/tests/database_integrity.test.sql`
- `supabase/tests/rls_behavior.test.sql`
- `supabase/seed.sql` (safe empty seed file)
- `docs/ERD.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/RLS_POLICY_MATRIX.md`
- `docs/DATABASE_SETUP.md`
- `scripts/validate_stage1.py`
- `docs/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md` (resolved Option B decision record) and `docs/BLOCKED_PAYMENT_TRANSACTIONS_DECISION.md` (historical pointer retained for the unchanged migration-001 comment)

## 3. Schema coverage

The SRS defines 24 application tables (with `auth.users` treated as the Supabase-managed external identity table). The migration set represents all 24 application tables, including `payment_transactions` in migration 003 after the Project Owner approved Option B. The approved interpretation is recorded in `docs/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md`.

The scaffold includes primary/foreign keys, unique/check constraints, same-store ownership constraints/triggers, timestamp triggers on mutable tables, immutable history triggers, simple-vs-variant stock model checks, saved-address cap/default index, dual-approval actor validation, full-text indexes, RLS enablement and policies, five private Storage buckets, and the Option B payment attempt lifecycle table/indexes/functions/RLS. Migration 004 adds order/payment eligibility checks, a mandatory enabled matching payment configuration, active-attempt protection, and separate audit records when status and provider reference change in one operation.

## 4. Security design boundaries

- `auth.users` remains Supabase-managed; application role is stored in `profiles.role`.
- New auth users default to `customer`; Merchant/Super Admin role assignment is not accepted from user metadata and must be implemented by trusted server-side onboarding/admin operations in the later authorization stage.
- Order creation, order/payment status transitions, payment verification, refund settlement, inventory changes, ticket workflow, role assignment, and audit appends have no direct client mutation policies.
- `payment_configs` has no direct client SELECT policy because it contains encrypted credential material. A trusted API must return a safe projection.
- Storage buckets are private. Object paths and ownership must be validated by the upload authorization operation; direct object access is constrained by Storage RLS.
- Super Admin allowlisted network/VPN and TOTP enforcement must be performed at trusted server endpoints; RLS alone is not sufficient.

## 5. Stock representation

The approved SRS stock model is represented as follows:

- Simple product: `products.stock_quantity` is non-NULL and no variant rows may exist.
- Variant product: `products.stock_quantity` is NULL and one or more `product_variants.stock_quantity` rows are authoritative.
- Deferred constraint triggers validate the cross-table invariant at transaction end. Variant product creation and its first variant must be in the same transaction.
- `inventory_movements` references `(product_id, store_id)` and optional `(variant_id, product_id)`; a trigger checks variant nullability against product type. `actor_id` is nullable to represent authorized system-generated operations, as the SRS allows a system process as an actor and does not explicitly require a non-null actor. No synthetic system account is introduced.

## 6. Tests and actual results

| Check | Result | Evidence / limitation |
|---|---|---|
| Workspace/repository audit | Completed | No existing BazarHQ repository or migration folder found in accessible roots |
| Supabase CLI availability | Not available | `command -v supabase` returned no path; npm registry lookup failed with `EAI_AGAIN` while attempting to resolve `registry.npmjs.org`. |
| Docker availability | Not available | `command -v docker` returned no path; `docker info` returned `docker: command not found`. |
| PostgreSQL client availability | Not available | `command -v psql` returned no path. |
| Static artifact validation | PASS | `python scripts/validate_stage1.py`; 24 public application tables matched 24 RLS enablement statements; all 5 pgTAP plan counts matched their assertion counts; migration order and SQL lexical balance passed static checks. Not a SQL parser or runtime test. |
| Supabase configuration parse | PASS | Python `tomllib` parsed `supabase/config.toml`; local project ID and DB port were checked. |
| Tool installation attempt | BLOCKED | `apt-get update` timed out after repeated repository `Ign` retries. `npm view supabase version --fetch-timeout=10000 --fetch-retries=0` failed with `EAI_AGAIN` resolving `registry.npmjs.org`. |
| SQL syntax / migration application | Not run | Supabase CLI, Docker, and PostgreSQL are unavailable; no disposable local Supabase database could be started. |
| pgTAP schema, integrity, payment safeguards, and RLS catalog tests | Not run | Requires `npx supabase test db` against the local Supabase stack. |
| Runtime customer/merchant isolation | Not run | Test script provided; must run on local Supabase with test role/JWT support. |
| Storage policy behavior | Not run | Catalog checks are present; object-level Storage behavior requires the local Storage service and runtime tests. |
| Runtime customer/merchant isolation | Not run | Test script provided; must run on local Supabase with test role/JWT support |
| Storage policy behavior | Not run | Requires local Storage service and object-level tests |
| Inventory concurrency / overselling | Not run | Requires real PostgreSQL transactions and concurrent test harness |

No runtime tests are claimed as passed. Installation attempts were blocked by network access: `apt-get update` timed out with repository `Ign` retries, and `npm view supabase version --fetch-timeout=10000 --fetch-retries=0` failed with `EAI_AGAIN`. The static validation script is not a security or database correctness certification.

## 7. Commands for Windows PowerShell

See `docs/DATABASE_SETUP.md`. Main local commands after installing Docker Desktop and Supabase CLI:

```powershell
npx supabase start
npx supabase status
npx supabase db reset
npx supabase test db
```

`supabase db reset` is destructive to local database data. Do not run against shared/production environments.

## 8. Issues / severity

- **High — Runtime verification unavailable:** migrations, PostgreSQL syntax, RLS policies, and storage policies remain unexecuted because the necessary tools were missing.
- **High — Server operations are not included in Stage 1:** trusted order/payment/inventory/refund/ticket/admin endpoints must be implemented and separately tested before workflows function.
- **High — Payment secrets not provisioned:** schema holds ciphertext only; Vault/encryption key configuration and key rotation are deployment tasks, not included here.
- **Medium — Super Admin network control:** managed VPN/fixed egress and TOTP checks require trusted server gateway implementation and fail-closed tests.
- **Medium — Full RLS matrix:** catalog and basic behavioral test files are included, but comprehensive table-operation/storage-object tests for every role remain necessary to satisfy TST-07/TST-14.
- **Medium — Provider-specific constraints:** real bKash/Nagad/Rocket/SSLCommerz business credentials and sandbox behavior cannot be validated at this stage.

## 9. Payment transaction lifecycle decision — resolved

The Project Owner approved Option B. Immutable facts are `id`, order/config references, method/provider, amount/currency, idempotency key, sanitized initial metadata, and creation time. A provider reference may be assigned once. Trusted functions permit only the defined monotonic status transitions, set `verified_at` for terminal `paid`/`failed` states, and append sanitized `audit_logs` records. Client and `service_role` direct table DML is revoked; the service role can execute only the approved SECURITY DEFINER functions. The functions do not implement payment gateways or automatically synchronize `orders.payment_status`; the later trusted API must coordinate that state safely.

## 10. Stage completion decision

**Stage 1 is not complete.** The payment transaction schema, indexes, trusted lifecycle functions, and corrective migration have been added to the scaffold following approval, but acceptance criteria requiring successful migration application, runtime database tests, full RLS/Storage test evidence, and confirmed implementation have not been met. Run the documented local checks, fix runtime errors, record evidence, and obtain Project Owner acceptance before beginning the next stage. No authentication UI or business feature UI was built.
