#!/usr/bin/env bash
# Docker-free local Supabase-like stack for end-to-end adapter verification.
#
# The supported workflow is still `supabase start` (Docker). This script exists
# for machines where Supabase's Docker images cannot be pulled. It runs the real
# services where binaries are available and emulates the rest:
#
#   PostgreSQL 16  vendored supabase/postgres init scripts + GoTrue's own auth
#                  migrations + storage/vault shims + every BazarHQ migration
#   GoTrue         real Supabase Auth binary (auth hooks, MFA/TOTP, sessions)
#   PostgREST      real binary (RLS as the caller, exactly like the Data API)
#   Edge Functions real function code on Deno (functions-router.ts)
#   Gateway        gateway.mjs: Supabase URL layout (/auth/v1, /rest/v1,
#                  /functions/v1) + a small Storage emulation that runs every
#                  object insert/select/delete as the caller, so storage.objects
#                  RLS decides, as storage-api does
#   Not emulated:  Realtime (subscriptions are not exercised here)
#
# Requirements (paths via env): GOTRUE_BIN, POSTGREST_BIN, DENO_BIN, PG_BIN,
# and the `pg` npm package resolvable from NODE_PATH.
#
# Usage: scripts/local-stack/start.sh   → prints the env file to source
#        scripts/local-stack/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/local-stack"
HARNESS="$ROOT/scripts/db-harness"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
GOTRUE_BIN="${GOTRUE_BIN:?set GOTRUE_BIN to the Supabase Auth (gotrue) binary}"
GOTRUE_MIGRATIONS="${GOTRUE_MIGRATIONS:-$(dirname "$GOTRUE_BIN")/migrations}"
POSTGREST_BIN="${POSTGREST_BIN:?set POSTGREST_BIN to the PostgREST binary}"
DENO_BIN="${DENO_BIN:-deno}"
WORK="${STACK_DIR:-/tmp/bazarhq-stack}"
PG_PORT="${STACK_PG_PORT:-54339}"
REST_PORT=54340
AUTH_PORT=54341
FN_PORT=54342
GATEWAY_PORT="${STACK_GATEWAY_PORT:-54321}"

mkdir -p "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); fi

# Local-only secrets, generated per run. Never reused anywhere else.
JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 48)"
sign() { node -e '
  const c=require("crypto"); const [secret, role]=process.argv.slice(1);
  const b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url");
  const h=b({alg:"HS256",typ:"JWT"}); const now=Math.floor(Date.now()/1000);
  const p=b({iss:"supabase-local",role,iat:now,exp:now+60*60*24*30});
  process.stdout.write(h+"."+p+"."+c.createHmac("sha256",secret).update(h+"."+p).digest("base64url"));
' "$JWT_SECRET" "$1"; }
ANON_KEY="$(sign anon)"
SERVICE_KEY="$(sign service_role)"

echo "==> PostgreSQL on :$PG_PORT ($WORK/data)"
rm -rf "$WORK/data"
[ "${#RUNAS[@]}" -gt 0 ] && chown -R postgres "$WORK"
"${RUNAS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U supabase_admin --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -w \
  -o "-p $PG_PORT -k $WORK -c listen_addresses='127.0.0.1' -c wal_level=logical -c max_connections=200" start >/dev/null
psql_as() { local u="$1"; shift; "$PG_BIN/psql" -h "$WORK" -p "$PG_PORT" -U "$u" -d postgres -v ON_ERROR_STOP=1 --no-psqlrc -q "$@"; }

psql_as supabase_admin -c "create role postgres superuser login; alter database postgres owner to postgres;"
for f in 00000000000000-initial-schema.sql 00000000000001-auth-schema.sql 00000000000002-storage-schema.sql; do
  psql_as postgres -f "$HARNESS/vendor/supabase-postgres/$f"
done

echo "==> GoTrue auth migrations"
# As on the Supabase platform, GoTrue (supabase_auth_admin) owns the auth schema it migrates.
psql_as supabase_admin -c "
  alter schema auth owner to supabase_auth_admin;
  do \$\$ declare r record; begin
    for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'auth' and c.relkind in ('r','S','v') loop
      execute format('alter table auth.%I owner to supabase_auth_admin', r.relname);
    end loop;
    for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' loop
      execute format('alter function %s owner to supabase_auth_admin', r.sig);
    end loop;
  end \$\$;"
GOTRUE_DB_DRIVER=postgres \
GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:$PG_PORT/postgres?search_path=auth&sslmode=disable" \
GOTRUE_DB_MIGRATIONS_PATH="$GOTRUE_MIGRATIONS" GOTRUE_JWT_SECRET="$JWT_SECRET" API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" \
GOTRUE_SITE_URL=http://localhost:3000 "$GOTRUE_BIN" migrate > "$WORK/gotrue-migrate.log" 2>&1

echo "==> Storage/Vault shims, role demotion"
psql_as supabase_admin -f "$HARNESS/supabase-shims.sql"
for f in 10000000000000_demote-postgres.sql \
         20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql \
         20230201083204_grant_auth_roles_to_postgres.sql \
         20230529180330_alter_api_roles_for_inherit.sql; do
  psql_as supabase_admin -f "$HARNESS/vendor/supabase-postgres/$f"
done
psql_as supabase_admin -c "alter role postgres set search_path to \"\$user\", public, extensions;"

echo "==> BazarHQ migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  psql_as postgres -1 -f "$f" > /dev/null 2>> "$WORK/migrations.log"
  echo "    $(basename "$f")"
done
psql_as postgres -f "$ROOT/supabase/seed.sql" > /dev/null
# Payment-credential encryption key (DB-05): a random per-run Vault secret, as BACKEND_SETUP.md describes.
psql_as postgres -c "select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'payment_credentials_key', 'local stack only');" > /dev/null
# Local network allowlist for the Super Admin gate (fail-closed otherwise).
psql_as postgres -c "insert into private.admin_ip_allowlist (cidr, note) values ('127.0.0.1/32', 'local stack') on conflict do nothing;"
psql_as postgres -c "notify pgrst, 'reload schema';"

echo "==> PostgREST on :$REST_PORT"
PGRST_DB_URI="postgres://authenticator@127.0.0.1:$PG_PORT/postgres" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon \
PGRST_DB_EXTRA_SEARCH_PATH=public,extensions PGRST_JWT_SECRET="$JWT_SECRET" PGRST_SERVER_PORT=$REST_PORT \
PGRST_SERVER_HOST=127.0.0.1 PGRST_DB_MAX_ROWS=10000 \
  nohup "$POSTGREST_BIN" > "$WORK/postgrest.log" 2>&1 &
echo $! > "$WORK/postgrest.pid"

echo "==> GoTrue on :$AUTH_PORT"
GOTRUE_API_HOST=127.0.0.1 PORT=$AUTH_PORT API_EXTERNAL_URL="http://127.0.0.1:$GATEWAY_PORT/auth/v1" \
GOTRUE_DB_DRIVER=postgres GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin@127.0.0.1:$PG_PORT/postgres?search_path=auth&sslmode=disable" \
GOTRUE_DB_MIGRATIONS_PATH="$GOTRUE_MIGRATIONS" GOTRUE_SITE_URL=http://localhost:3000 GOTRUE_URI_ALLOW_LIST='*' \
GOTRUE_JWT_SECRET="$JWT_SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role \
GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_DISABLE_SIGNUP=false GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_MFA_TOTP_ENROLL_ENABLED=true GOTRUE_MFA_TOTP_VERIFY_ENABLED=true GOTRUE_MFA_MAX_ENROLLED_FACTORS=10 \
GOTRUE_PASSWORD_MIN_LENGTH=8 GOTRUE_RATE_LIMIT_TOKEN_REFRESH=10000 GOTRUE_RATE_LIMIT_VERIFY=10000 GOTRUE_RATE_LIMIT_EMAIL_SENT=10000 \
GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS=10000 GOTRUE_RATE_LIMIT_OTP=10000 GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED=true \
GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/public/custom_access_token_hook \
GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED=true \
GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI=pg-functions://postgres/public/hook_password_verification_attempt \
GOTRUE_LOG_LEVEL=warn \
  nohup "$GOTRUE_BIN" serve > "$WORK/gotrue.log" 2>&1 &
echo $! > "$WORK/gotrue.pid"

echo "==> Edge Functions on :$FN_PORT"
SUPABASE_URL="http://127.0.0.1:$GATEWAY_PORT" SUPABASE_ANON_KEY="$ANON_KEY" SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" \
APP_ENV=development PAYMENT_PROVIDER_MODE=simulator ALLOWED_ORIGINS='*' PUBLIC_APP_URL=http://localhost:3000 \
CRON_SECRET="$(head -c 32 /dev/urandom | base64 | tr -d "/+=\n")" CLIENT_IP_HEADER=x-forwarded-for CLIENT_IP_POSITION=last FN_PORT=$FN_PORT \
  nohup "$DENO_BIN" run --allow-net --allow-env --allow-read --config "$ROOT/supabase/functions/deno.json" \
  "$HERE/functions-router.ts" > "$WORK/functions.log" 2>&1 &
echo $! > "$WORK/functions.pid"

echo "==> Gateway on :$GATEWAY_PORT"
STACK_PG="postgres://postgres@127.0.0.1:$PG_PORT/postgres" JWT_SECRET="$JWT_SECRET" GATEWAY_PORT=$GATEWAY_PORT \
REST_URL="http://127.0.0.1:$REST_PORT" AUTH_URL="http://127.0.0.1:$AUTH_PORT" FN_URL="http://127.0.0.1:$FN_PORT" \
  nohup node "$HERE/gateway.mjs" > "$WORK/gateway.log" 2>&1 &
echo $! > "$WORK/gateway.pid"

for i in $(seq 1 60); do
  if curl -fs "http://127.0.0.1:$GATEWAY_PORT/auth/v1/health" >/dev/null 2>&1 \
     && curl -fs -o /dev/null "http://127.0.0.1:$GATEWAY_PORT/rest/v1/" -H "apikey: $ANON_KEY" 2>/dev/null \
     && curl -fs -o /dev/null "http://127.0.0.1:$FN_PORT/__health" 2>/dev/null; then
    break
  fi
  sleep 1
done

cat > "$WORK/stack.env" <<EOF
STACK_URL=http://127.0.0.1:$GATEWAY_PORT
STACK_ANON_KEY=$ANON_KEY
STACK_SERVICE_KEY=$SERVICE_KEY
STACK_PG=postgres://postgres@127.0.0.1:$PG_PORT/postgres
STACK_PG_SOCKET=$WORK
STACK_PG_PORT=$PG_PORT
EOF
echo "==> Ready. Environment written to $WORK/stack.env (local-only keys)."
