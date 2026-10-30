#!/usr/bin/env bash
# Concurrency check for atomic order creation (DB-03, FR-C-21, API-07 idempotency).
# Needs a cluster started with `run.sh --keep`. Commits a small fixture, then:
#   1. 30 parallel sessions each try to buy 1 of the last 5 units  -> exactly 5 orders, stock 0, never negative
#   2. 10 parallel sessions retry the SAME idempotency key           -> exactly 1 order and 1 payment attempt
# Usage: scripts/db-harness/concurrency-check.sh <socket-dir> [port]
set -euo pipefail
SOCK="$1"; PORT="${2:-54329}"
PSQL=(psql -h "$SOCK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 --no-psqlrc -qAt)
STORE=c0000000-0000-4000-8000-0000000000e1
PRODUCT=c0000000-0000-4000-8000-000000000001

"${PSQL[@]}" <<SQL
insert into auth.users (id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values ('c0000000-0000-4000-8000-0000000000a1','authenticated','authenticated','conc-merchant@example.test','{"account_type":"merchant"}',now(),now())
on conflict do nothing;
insert into public.stores (id, owner_id, name, subdomain, status)
values ('$STORE','c0000000-0000-4000-8000-0000000000a1','Concurrency Shop','conc-shop','published') on conflict do nothing;
insert into public.categories (id, store_id, name, slug) values ('c0000000-0000-4000-8000-0000000000f1','$STORE','All','all') on conflict do nothing;
insert into public.products (id, store_id, name, description, category_id, base_price, product_type, stock_quantity, status)
values ('$PRODUCT','$STORE','Last Units','x','c0000000-0000-4000-8000-0000000000f1',100,'simple',5,'active')
on conflict (id) do update set stock_quantity = 5;
insert into public.payment_configs (store_id, method, is_enabled) values ('$STORE','cod',true) on conflict do nothing;
SQL

order_sql() {
  echo "select public.create_order(null, '$STORE', '[{\"product_id\":\"$PRODUCT\",\"quantity\":1}]',
    '{\"recipient_name\":\"Buyer $1\",\"phone\":\"01700000$(printf '%03d' "$1")\",\"address\":\"Road $1\",\"district\":\"Dhaka\"}', 'cod', '$2');"
}

echo "==> 30 concurrent buyers for 5 units"
pids=()
for i in $(seq 1 30); do
  ( "${PSQL[@]}" -c "$(order_sql "$i" "conc-key-$(printf '%04d' "$i")")" >/dev/null 2>"$SOCK/err-$i.log" && echo ok > "$SOCK/res-$i" || echo fail > "$SOCK/res-$i" ) &
  pids+=($!)
done
wait "${pids[@]}"
OK=$(cat "$SOCK"/res-* | grep -c ok || true)
STOCK=$("${PSQL[@]}" -c "select stock_quantity from public.products where id = '$PRODUCT'")
ORDERS=$("${PSQL[@]}" -c "select count(*) from public.orders where store_id = '$STORE'")
STOCKERR=$(grep -l "BQ001\|left in stock" "$SOCK"/err-*.log 2>/dev/null | wc -l)
echo "    succeeded=$OK orders=$ORDERS stock=$STOCK insufficient-stock-errors=$STOCKERR"
rm -f "$SOCK"/res-* "$SOCK"/err-*.log
[ "$OK" = "5" ] && [ "$ORDERS" = "5" ] && [ "$STOCK" = "0" ] && [ "$STOCKERR" = "25" ] || { echo "FAIL: oversell protection"; exit 1; }

echo "==> 10 concurrent retries with one idempotency key"
"${PSQL[@]}" -c "update public.products set stock_quantity = 5 where id = '$PRODUCT'"
pids=()
for i in $(seq 1 10); do
  ( "${PSQL[@]}" -c "$(order_sql 500 dup-key-0001)" >/dev/null 2>&1 || true ) &
  pids+=($!)
done
wait "${pids[@]}"
# A loser of the unique-index race rolls back; its client retry returns the winner's order.
"${PSQL[@]}" -c "$(order_sql 500 dup-key-0001)" >/dev/null
DUP_ORDERS=$("${PSQL[@]}" -c "select count(*) from public.orders where idempotency_key = 'dup-key-0001'")
DUP_ATTEMPTS=$("${PSQL[@]}" -c "select count(*) from public.payment_transactions t join public.orders o on o.id = t.order_id where o.idempotency_key = 'dup-key-0001'")
STOCK2=$("${PSQL[@]}" -c "select stock_quantity from public.products where id = '$PRODUCT'")
echo "    orders=$DUP_ORDERS attempts=$DUP_ATTEMPTS stock=$STOCK2"
[ "$DUP_ORDERS" = "1" ] && [ "$DUP_ATTEMPTS" = "1" ] && [ "$STOCK2" = "4" ] || { echo "FAIL: idempotent order creation"; exit 1; }
echo "PASS"
