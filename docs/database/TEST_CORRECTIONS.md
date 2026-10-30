# Corrections to the supplied SQL tests

Three test files came with the brief: `database_schema.test.sql`, `database_integrity.test.sql` and `payment_transactions_safeguards.test.sql`. `database_schema.test.sql` runs unchanged. The other two had the same mechanical mistake, corrected in place. The untouched originals are kept, byte-identical to the attachments, in `docs/database/test-corrections/original/`.

## The mistake

pgTAP's `throws_ok` has these forms:

```sql
throws_ok(sql, errcode, errmsg, description)
throws_ok(sql, errcode, errmsg)        -- third argument is the expected MESSAGE
```

The originals called `throws_ok(sql, '23514', 'simple products cannot have variants')`, meaning the third argument as a description. pgTAP reads it as the expected error **message**, so each assertion compared PostgreSQL's real message ("Simple product … cannot have product_variants rows") with the description text and failed, even though the right error code was raised.

## The correction

A `null` was inserted as the expected message: `throws_ok(sql, '23514', null, 'simple products cannot have variants')`. Each assertion now checks the same SQL and the same error code as before, and keeps its description. Nothing was removed and no expectation was weakened.

| File | Assertions corrected |
|---|---|
| `database_integrity.test.sql` | 12 |
| `payment_transactions_safeguards.test.sql` | 16 |

## Evidence

Running the originals against the migrated database:

```
FAIL database_integrity.test.sql  (plan 22, passed 10, failed 12)
  not ok 2 - threw 23514: simple products cannot have variants
  #   caught: 23514: Simple product … cannot have product_variants rows
  #   wanted: 23514: simple products cannot have variants
```

The SQLSTATE matches in every case; only the message comparison fails. With the correction, both files pass in full (22/22 and 24/24).
