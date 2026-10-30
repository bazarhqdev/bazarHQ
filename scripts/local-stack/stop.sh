#!/usr/bin/env bash
# Stops the local stack started by start.sh.
set -uo pipefail
WORK="${STACK_DIR:-/tmp/bazarhq-stack}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
for svc in gateway functions gotrue postgrest; do
  if [ -f "$WORK/$svc.pid" ]; then kill "$(cat "$WORK/$svc.pid")" 2>/dev/null; rm -f "$WORK/$svc.pid"; fi
done
RUNAS=()
if [ "$(id -u)" = "0" ]; then RUNAS=(runuser -u postgres --); fi
[ -d "$WORK/data" ] && "${RUNAS[@]}" "$PG_BIN/pg_ctl" -D "$WORK/data" -m fast stop >/dev/null 2>&1
echo "stopped"
