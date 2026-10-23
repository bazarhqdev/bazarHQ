# BazarHQ Stage 1 Database Setup (Windows PowerShell)

## Environment audit result

The accessible workspace contained no BazarHQ application repository or existing migrations. Supabase CLI, Docker, and `psql` were unavailable in the execution environment. This folder is therefore a new minimal scaffold; migrations have **not** been applied and database tests have **not** been run.

## Prerequisites on Windows

1. Install Git if it is not already installed.
2. Install Docker Desktop and start the Docker engine.
3. Install Node.js LTS if it is not already installed.
4. Open PowerShell in the extracted `BazarHQ_Database_Stage1` folder and install the project-local Supabase CLI:

```powershell
npm install --save-dev supabase
npx supabase --version
docker version
```

If `winget` is available, Docker Desktop can be installed with `winget install --id Docker.DockerDesktop -e`; restart Windows if the installer requests it, then start Docker Desktop and wait until its engine is running. The current execution environment could not reach Debian package repositories, so tooling could not be installed here.

## Local workflow

```powershell
npx supabase --version
docker version
npx supabase start
npx supabase status
npx supabase db reset
npx supabase test db
```

`npx supabase db reset` recreates the local database from migrations and is destructive to local data in that Supabase project. Do not point it at a shared or production project. Review migration contents first.

## Inspecting changes

```powershell
npx supabase migration list
npx supabase db diff --local
npx supabase test db
```

For a linked development project only, after reviewing the diff and confirming the project ref:

```powershell
npx supabase link --project-ref <YOUR_DEVELOPMENT_PROJECT_REF>
npx supabase db push --dry-run
# Review the proposed changes before considering an actual push.
```

Do not paste secrets into SQL files, source control, chat, test fixtures, or client builds. Do not create a default Super Admin account. Configure payment credentials only through the approved server-side secret/Vault mechanism after that integration is implemented.

Option B payment transaction lifecycle semantics are approved and recorded in `docs/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md`. The migration does not implement gateway callbacks or update `orders.payment_status`; those remain trusted API responsibilities.

## Important implementation notes

- Migration `20261021000100_core_schema.sql` creates the base application schema, constraints, indexes, timestamp triggers, stock-model checks, and safe default profile provisioning.
- Migration `20261021000200_rls_storage.sql` enables RLS, grants least-privilege access, creates policies, and provisions private Storage buckets for the base tables.
- Migration `20261021000300_payment_transactions_option_b.sql` creates `payment_transactions`, idempotency/provider-reference indexes, immutable-facts and status-transition guards, trusted server-side lifecycle functions, safe-column SELECT grants, and payment transaction RLS.
- Migration `20261021000400_payment_attempt_safeguards.sql` is a forward-only correction for order/payment eligibility, mandatory enabled configuration, active-attempt prevention, and separate audit events for combined status/reference changes.
- `products` and `product_variants` stock mutations, order creation, payment state transitions, refunds, policy publication, ticket workflow changes, and audit appends are intentionally server-operation-only.
- Variant product creation and the first variant must be performed in a single transaction due the deferred stock-model invariant.
- The migrations do not create Edge Functions or client UI. Those are outside Stage 1.
- Run the SQL tests against the local Supabase stack. A successful file write is not a passing test.

## Runtime verification status

The local test suite has not yet run in this workspace because Docker, Supabase CLI, and PostgreSQL are absent and package repository access timed out. Once prerequisites are installed, run the commands above only with the local project. Do not link to or reset a shared/production project. The SQL test files use synthetic fixtures and roll back their changes.

The original migration 001 contains a historical comment naming `docs/BLOCKED_PAYMENT_TRANSACTIONS_DECISION.md`. That migration is intentionally not edited; the old documentation path now contains a pointer to the resolved decision record in `docs/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md`.
