# Docker-free local stack (verification)

Use `supabase start` when Docker is available. These scripts exist for machines where Supabase's images can't be pulled. They were used to verify this repository end to end.

| Piece | How it runs |
|---|---|
| PostgreSQL 16 | Vendored `supabase/postgres` init scripts, then GoTrue's own auth migrations, then the storage/Vault shims (`scripts/db-harness/supabase-shims.sql`), then every file in `supabase/migrations` and `supabase/seed.sql` |
| Auth | The real Supabase Auth (GoTrue) binary with the BazarHQ access-token and password hooks, TOTP and email auto-confirm |
| Data API | The real PostgREST binary |
| Edge Functions | The real function code on Deno (`functions-router.ts` serves all 23) |
| Gateway | `gateway.mjs`: `/auth/v1`, `/rest/v1` and `/functions/v1` like Supabase. Storage `upload`, `sign`, `remove` and `copy` run their `storage.objects` statements as the caller's role with the caller's verified JWT claims, so BazarHQ's Storage RLS decides, as in storage-api. Object bytes are kept in memory. |
| Not included | Realtime (subscriptions aren't exercised here) |

Each run generates its own JWT secret, keys, Vault encryption key and cron secret. They are written only to `$STACK_DIR/stack.env` and never reused.

```bash
export GOTRUE_BIN=/path/to/auth POSTGREST_BIN=/path/to/postgrest DENO_BIN=deno
export NODE_PATH=/path/with/node_modules   # needs the `pg` package for the gateway
export STACK_DIR=/tmp/bazarhq-stack

scripts/local-stack/start.sh
set -a; . "$STACK_DIR/stack.env"; set +a

npx tsx scripts/local-stack/adapter-flows.mts      # 42 steps: every role through createSupabaseServices
# Web app in Supabase mode (build with the stack URL and anon key), then:
#   (apps/web) ADMIN_IP_ALLOWLIST=127.0.0.1 npx next start -p 3200
BASE_URL=http://localhost:3200 node scripts/local-stack/web-smoke.mjs   # 10 browser steps

scripts/local-stack/stop.sh
```

`adapter-flows.mts` creates its own merchants, customers and Super Admins (through `grant_super_admin` and real TOTP enrolment), so run it on a fresh stack. Set `REPORT_DIR=verification` to write JSON results.
