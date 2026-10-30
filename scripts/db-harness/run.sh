#!/usr/bin/env bash
# Docker-free database harness for BazarHQ.
#
# Builds a throwaway PostgreSQL cluster the way Supabase builds its database
# (vendored supabase/postgres init scripts + role demotion), adds the small
# GoTrue / storage-api / Vault shims in supabase-shims.sql, applies every file in
# supabase/migrations in order (each in its own transaction, as `postgres`), then
# runs every supabase/tests/*.test.sql with pgTAP and prints a TAP summary.
#
# The supported workflow remains `supabase start && supabase db reset && supabase test db`.
# Use this only where Docker images cannot be pulled (CI sandboxes, air-gapped machines).
#
# Requirements: PostgreSQL 15+ server binaries, psql, the pgtap extension files and
# (optional) plpgsql_check installed into that server's extension directory.
#
# Usage: scripts/db-harness/run.sh [--keep] [--lint] [test-file ...]
#   --keep   leave the cluster running and print its connection string
#   --lint   run plpgsql_check over every public function after migrating
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HARNESS="$ROOT/scripts/db-harness"
PG_BIN="${PG_BIN:-$( (pg_config --bindir 2>/dev/null) || echo /usr/lib/postgresql/16/bin)}"
PORT="${HARNESS_PORT:-54329}"
KEEP=0
LINT=0
TESTS=()
for arg in "$@"; do
  case "$arg" in
    --keep) KEEP=1 ;;
    --lint) LINT=1 ;;
    *) TESTS+=("$arg") ;;
  esac
done

WORK="${HARNESS_DIR:-$(mktemp -d -t bazarhq-db-XXXXXX)}"
mkdir -p "$WORK"
RUNAS=()
if [ "$(id -u)" = "0" ]; then
  # PostgreSQL refuses to run as root.
  chown -R postgres "$WORK"
  RUNAS=(runuser -u postgres --)
fi

cleanup() {
  if [ "$KEEP" = "0" ]; then
    "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

psql_as() {
  local user="$1"; shift
  "$PG_BIN/psql" -h "$WORK" -p "$PORT" -U "$user" -d postgres -v ON_ERROR_STOP=1 --no-psqlrc -q "$@"
}

echo "==> Initialising cluster in $WORK (port $PORT)"
"${RUNAS[@]}" "$PG_BIN/initdb" -D "$WORK/data" -U supabase_admin --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -l "$WORK/postgres.log" -w \
  -o "-p $PORT -k $WORK -c listen_addresses='127.0.0.1' -c wal_level=logical -c max_connections=200" start >/dev/null

echo "==> Supabase base: roles, auth, storage (vendored supabase/postgres init scripts)"
psql_as supabase_admin -c "create role postgres superuser login; alter database postgres owner to postgres;"
for f in 00000000000000-initial-schema.sql 00000000000001-auth-schema.sql 00000000000002-storage-schema.sql; do
  psql_as postgres -f "$HARNESS/vendor/supabase-postgres/$f"
done
psql_as supabase_admin -f "$HARNESS/supabase-shims.sql"
for f in 10000000000000_demote-postgres.sql \
         20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql \
         20230201083204_grant_auth_roles_to_postgres.sql \
         20230529180330_alter_api_roles_for_inherit.sql; do
  psql_as supabase_admin -f "$HARNESS/vendor/supabase-postgres/$f"
done
psql_as supabase_admin -c "alter role postgres set search_path to \"\$user\", public, extensions;" \
                       -c "create extension if not exists pgtap with schema extensions;"
if [ "$LINT" = "1" ]; then
  psql_as supabase_admin -c "create extension if not exists plpgsql_check with schema extensions;"
fi

echo "==> Applying supabase/migrations as postgres"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '    %s\n' "$(basename "$f")"
  psql_as postgres --single-transaction -f "$f"
done

if [ "$LINT" = "1" ]; then
  echo "==> plpgsql_check (errors and warnings) over public functions"
  LINT_OUT="$(psql_as postgres -At -c "
    select p.oid::regprocedure || ' line ' || coalesce(r.lineno::text, '?') || ': ' || r.message || coalesce(' [' || r.hint || ']', '') || coalesce(' — ' || r.detail, '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang and l.lanname = 'plpgsql'
    cross join lateral extensions.plpgsql_check_function_tb(
      p.oid,
      relid => coalesce((select t.tgrelid from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal limit 1), 0)
    ) r
    where n.nspname in ('public','private')
      and p.prorettype <> 'event_trigger'::regtype
      and r.level in ('error','warning')
      and not (p.prorettype = 'trigger'::regtype
               and not exists (select 1 from pg_trigger t where t.tgfoid = p.oid and not t.tgisinternal))
    order by 1;")"
  if [ -n "$LINT_OUT" ]; then
    echo "$LINT_OUT"
    echo "LINT: issues found"
    LINT_FAILED=1
  else
    echo "    no errors or warnings"
  fi
fi

if [ "${#TESTS[@]}" -eq 0 ]; then
  TESTS=("$ROOT"/supabase/tests/*.test.sql)
fi

echo "==> Running ${#TESTS[@]} pgTAP test file(s)"
TOTAL=0; FAILED=0; FILES_FAILED=0
for t in "${TESTS[@]}"; do
  out="$(psql_as postgres -At -f "$t" 2>&1)" && rc=0 || rc=$?
  plan="$(printf '%s\n' "$out" | sed -n 's/^1\.\.\([0-9]*\)$/\1/p' | head -1)"
  oks="$(printf '%s\n' "$out" | grep -c '^ok ' || true)"
  noks="$(printf '%s\n' "$out" | grep -c '^not ok ' || true)"
  TOTAL=$((TOTAL + oks + noks)); FAILED=$((FAILED + noks))
  if [ "$rc" != "0" ] || [ "$noks" != "0" ] || [ -z "$plan" ] || [ "$plan" != "$oks" ]; then
    FILES_FAILED=$((FILES_FAILED + 1))
    echo "FAIL $(basename "$t")  (plan ${plan:-?}, passed $oks, failed $noks, exit $rc)"
    printf '%s\n' "$out" | grep -E '^not ok|^#|ERROR|error' | head -40 | sed 's/^/      /'
  else
    echo "ok   $(basename "$t")  ($oks/$plan)"
  fi
done
echo "==> $((TOTAL - FAILED))/$TOTAL assertions passed; $FILES_FAILED file(s) failed"

if [ "$KEEP" = "1" ]; then
  echo "Cluster kept: postgresql://postgres@/postgres?host=$WORK&port=$PORT"
fi
if [ "$FILES_FAILED" != "0" ] || [ "${LINT_FAILED:-0}" = "1" ]; then exit 1; fi
