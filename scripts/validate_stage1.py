
#!/usr/bin/env python3
"""
BazarHQ Stage 1 static artifact validator.

This script performs static checks only. It does NOT:
- Parse SQL with PostgreSQL.
- Apply migrations.
- Execute pgTAP tests.
- Prove RLS or Storage behavior.
- Certify application security.

Approved migration sequence:
  001: 23 core application tables
  002: RLS for all 23 core tables + Storage policies
  003: payment_transactions (24th application table) + its RLS
  004: additive payment-attempt safeguards
"""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = ROOT / "supabase" / "migrations"
TESTS_DIR = ROOT / "supabase" / "tests"
DOCS_DATABASE_DIR = ROOT / "docs" / "database"
DOCS_REPORTS_DIR = ROOT / "docs" / "reports"

EXPECTED_MIGRATIONS = [
    "20261021000100_core_schema.sql",
    "20261021000200_rls_storage.sql",
    "20261021000300_payment_transactions_option_b.sql",
    "20261021000400_payment_attempt_safeguards.sql",
]

# These are the 23 application tables created by migration 001.
# payment_transactions is deliberately excluded: migration 003 creates it.
EXPECTED_CORE_TABLES = {
    "profiles",
    "stores",
    "themes",
    "categories",
    "products",
    "product_variants",
    "product_images",
    "orders",
    "order_items",
    "payment_configs",
    "delivery_events",
    "returns",
    "refunds",
    "support_tickets",
    "ticket_messages",
    "ticket_audit_log",
    "inventory_movements",
    "notifications",
    "device_tokens",
    "audit_logs",
    "announcements",
    "policies",
    "customer_addresses",
}

PAYMENT_TABLE = "payment_transactions"

EXPECTED_TESTS = {
    "database_schema.test.sql",
    "database_integrity.test.sql",
    "payment_transactions_safeguards.test.sql",
    "rls_behavior.test.sql",
    "rls_policy_catalog.test.sql",
}

REQUIRED_DOCUMENTS = [
    DOCS_DATABASE_DIR / "DATABASE_SCHEMA.md",
    DOCS_DATABASE_DIR / "DATABASE_SETUP.md",
    DOCS_DATABASE_DIR / "RLS_POLICY_MATRIX.md",
    DOCS_DATABASE_DIR / "PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md",
    DOCS_REPORTS_DIR / "STAGE_1_REPORT.md",
]

# pgTAP assertion functions commonly used in this project.
# plan(), finish(), and other non-assertion functions are not counted.
PGTAP_ASSERTIONS = {
    "ok",
    "is",
    "isnt",
    "cmp_ok",
    "like",
    "unlike",
    "matches",
    "throws_ok",
    "throws_like",
    "throws_matching",
    "lives_ok",
    "results_eq",
    "set_eq",
    "bag_eq",
    "row_eq",
    "is_empty",
    "isnt_empty",
    "has_table",
    "hasnt_table",
    "has_column",
    "hasnt_column",
    "has_index",
    "hasnt_index",
    "has_function",
    "hasnt_function",
    "has_trigger",
    "hasnt_trigger",
    "has_policy",
    "hasnt_policy",
    "has_privilege",
    "hasnt_privilege",
    "col_is_pk",
    "col_type_is",
    "fk_ok",
    "has_fk",
    "hasnt_fk",
    "trigger_is",
}

errors = []
warnings = []
notes = []


def read_text(path: Path) -> str | None:
    """Read a UTF-8 file, recording a clear error if it is unavailable."""
    if not path.is_file():
        errors.append(f"Missing required file: {relative(path)}")
        return None

    try:
        return path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeError) as exc:
        errors.append(f"Cannot read {relative(path)}: {exc}")
        return None


def relative(path: Path) -> str:
    """Display project-relative paths when possible."""
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def strip_sql_comments(sql: str) -> str:
    """
    Remove SQL line/block comments while preserving quoted strings,
    quoted identifiers, and dollar-quoted function bodies.

    This is a lightweight static helper, not a complete PostgreSQL parser.
    """
    out = []
    i = 0
    state = "normal"
    dollar_tag = None

    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if state == "line_comment":
            if ch == "\n":
                out.append("\n")
                state = "normal"
            else:
                out.append(" ")
            i += 1
            continue

        if state == "block_comment":
            if ch == "*" and nxt == "/":
                out.extend("  ")
                i += 2
                state = "normal"
            else:
                out.append("\n" if ch == "\n" else " ")
                i += 1
            continue

        if state == "single_quote":
            out.append(ch)
            if ch == "'":
                if nxt == "'":
                    out.append(nxt)
                    i += 2
                    continue
                state = "normal"
            elif ch == "\\" and nxt:
                # Keep escaped character inside a string literal.
                out.append(nxt)
                i += 2
                continue
            i += 1
            continue

        if state == "double_quote":
            out.append(ch)
            if ch == '"':
                if nxt == '"':
                    out.append(nxt)
                    i += 2
                    continue
                state = "normal"
            i += 1
            continue

        if state == "dollar_quote":
            if sql.startswith(dollar_tag, i):
                out.append(dollar_tag)
                i += len(dollar_tag)
                state = "normal"
                dollar_tag = None
            else:
                out.append(ch)
                i += 1
            continue

        # Normal state.
        if ch == "-" and nxt == "-":
            out.extend("  ")
            i += 2
            state = "line_comment"
            continue

        if ch == "/" and nxt == "*":
            out.extend("  ")
            i += 2
            state = "block_comment"
            continue

        if ch == "'":
            out.append(ch)
            i += 1
            state = "single_quote"
            continue

        if ch == '"':
            out.append(ch)
            i += 1
            state = "double_quote"
            continue

        if ch == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if match:
                dollar_tag = match.group(0)
                out.append(dollar_tag)
                i += len(dollar_tag)
                state = "dollar_quote"
                continue

        out.append(ch)
        i += 1

    return "".join(out)


def lexical_balance(path: Path, sql: str) -> str | None:
    """
    Lightweight delimiter/quote check.

    It is not a substitute for PostgreSQL parsing or migration execution.
    """
    stack = []
    i = 0
    state = "normal"
    dollar_tag = None

    while i < len(sql):
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ""

        if state == "line_comment":
            if ch == "\n":
                state = "normal"
            i += 1
            continue

        if state == "block_comment":
            if ch == "*" and nxt == "/":
                state = "normal"
                i += 2
            else:
                i += 1
            continue

        if state == "single_quote":
            if ch == "'":
                if nxt == "'":
                    i += 2
                    continue
                state = "normal"
            elif ch == "\\" and nxt:
                i += 2
                continue
            i += 1
            continue

        if state == "double_quote":
            if ch == '"':
                if nxt == '"':
                    i += 2
                    continue
                state = "normal"
            i += 1
            continue

        if state == "dollar_quote":
            if sql.startswith(dollar_tag, i):
                i += len(dollar_tag)
                state = "normal"
                dollar_tag = None
            else:
                i += 1
            continue

        if ch == "-" and nxt == "-":
            state = "line_comment"
            i += 2
            continue

        if ch == "/" and nxt == "*":
            state = "block_comment"
            i += 2
            continue

        if ch == "'":
            state = "single_quote"
            i += 1
            continue

        if ch == '"':
            state = "double_quote"
            i += 1
            continue

        if ch == "$":
            match = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if match:
                dollar_tag = match.group(0)
                state = "dollar_quote"
                i += len(dollar_tag)
                continue

        if ch == "(":
            stack.append(i)
        elif ch == ")":
            if not stack:
                return f"{relative(path)}: unmatched closing parenthesis at offset {i}"
            stack.pop()

        i += 1

    if state in {"single_quote", "double_quote", "dollar_quote", "block_comment"}:
        return f"{relative(path)}: unterminated SQL lexical construct ({state})"

    if stack:
        return (
            f"{relative(path)}: {len(stack)} unmatched opening parenthesis/parentheses"
        )

    return None


def declared_tables(sql: str) -> set[str]:
    """Return names from CREATE TABLE public.table declarations."""
    clean = strip_sql_comments(sql)
    pattern = re.compile(
        r"\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"
        r"(?:public\.)?([a-z_][a-z0-9_]*)",
        re.IGNORECASE,
    )
    return {match.group(1).lower() for match in pattern.finditer(clean)}


def rls_enabled_tables(sql: str) -> set[str]:
    """Return public tables explicitly enabled for RLS."""
    clean = strip_sql_comments(sql)
    pattern = re.compile(
        r"\balter\s+table\s+(?:only\s+)?public\.([a-z_][a-z0-9_]*)"
        r"\s+enable\s+row\s+level\s+security\b",
        re.IGNORECASE,
    )
    return {match.group(1).lower() for match in pattern.finditer(clean)}


def check_migration_sequence() -> dict[str, Path]:
    """Require the exact four-file migration sequence."""
    if not MIGRATIONS_DIR.is_dir():
        errors.append(f"Missing migrations directory: {relative(MIGRATIONS_DIR)}")
        return {}

    actual_paths = sorted(
        (path for path in MIGRATIONS_DIR.glob("*.sql") if path.is_file()),
        key=lambda path: path.name,
    )
    actual_names = [path.name for path in actual_paths]

    if actual_names != EXPECTED_MIGRATIONS:
        errors.append(
            "Migration sequence/names do not match the approved sequence.\n"
            f"  Expected: {EXPECTED_MIGRATIONS}\n"
            f"  Found:    {actual_names}"
        )

    return {path.name: path for path in actual_paths}


def check_table_and_rls_sets(migration_paths: dict[str, Path]) -> None:
    """Check 23 core tables, their RLS coverage, and payment table RLS separately."""
    core_name = "20261021000100_core_schema.sql"
    rls_name = "20261021000200_rls_storage.sql"
    payment_name = "20261021000300_payment_transactions_option_b.sql"
    safeguard_name = "20261021000400_payment_attempt_safeguards.sql"

    required_names = {core_name, rls_name, payment_name, safeguard_name}
    missing_names = required_names - set(migration_paths)
    if missing_names:
        errors.append(
            "Cannot verify table/RLS sets because migrations are missing: "
            + ", ".join(sorted(missing_names))
        )
        return

    core_sql = read_text(migration_paths[core_name])
    rls_sql = read_text(migration_paths[rls_name])
    payment_sql = read_text(migration_paths[payment_name])
    safeguard_sql = read_text(migration_paths[safeguard_name])

    if any(sql is None for sql in (core_sql, rls_sql, payment_sql, safeguard_sql)):
        return

    core_tables = declared_tables(core_sql)
    expected_core = EXPECTED_CORE_TABLES

    if len(core_tables) != 23:
        errors.append(
            f"Expected 23 core tables in migration 001; found {len(core_tables)}"
        )

    if core_tables != expected_core:
        errors.append(
            "Core table set mismatch in migration 001:\n"
            f"  Missing: {sorted(expected_core - core_tables)}\n"
            f"  Extra:   {sorted(core_tables - expected_core)}"
        )

    if PAYMENT_TABLE in core_tables:
        errors.append(
            "payment_transactions must be created by migration 003, "
            "not migration 001"
        )

    rls_tables = rls_enabled_tables(rls_sql)

    if rls_tables != expected_core:
        errors.append(
            "Migration 002 RLS table set must match the 23 core tables:\n"
            f"  Missing RLS: {sorted(expected_core - rls_tables)}\n"
            f"  Unexpected: {sorted(rls_tables - expected_core)}"
        )

    if "product_images" not in core_tables:
        errors.append("product_images is missing from migration 001")
    if "product_images" not in rls_tables:
        errors.append("product_images is missing from migration 002 RLS enablement")

    payment_tables = declared_tables(payment_sql)
    if PAYMENT_TABLE not in payment_tables:
        errors.append(
            "Migration 003 must create public.payment_transactions"
        )

    payment_rls = rls_enabled_tables(payment_sql)
    if PAYMENT_TABLE not in payment_rls:
        errors.append(
            "Migration 003 must explicitly enable RLS on payment_transactions"
        )

    # Migration 002 must not create or enable RLS on the table which does not
    # exist until migration 003. References in comments or polymorphic strings
    # are not treated as table declarations.
    clean_rls_sql = strip_sql_comments(rls_sql)

    if re.search(
        r"\balter\s+table\s+(?:only\s+)?public\.payment_transactions"
        r"\s+enable\s+row\s+level\s+security\b",
        clean_rls_sql,
        re.IGNORECASE,
    ):
        errors.append(
            "Migration 002 must not configure payment_transactions RLS; "
            "migration 003 owns that configuration"
        )

    if re.search(
        r"\bcreate\s+policy\b[\s\S]*?\bon\s+public\.payment_transactions\b",
        clean_rls_sql,
        re.IGNORECASE,
    ):
        errors.append(
            "Migration 002 must not define payment_transactions policies; "
            "migration 003 owns them"
        )

    # Static markers for critical payment safeguard requirements.
    safeguard_clean = strip_sql_comments(safeguard_sql).lower()
    required_markers = {
        "enabled payment configuration validation":
            "new payment attempt requires an enabled payment configuration",
        "settled/payment-verification state guard":
            "pending_verification",
        "active-attempt guard":
            "an active payment attempt already exists for this order",
        "COD single-attempt guard":
            "a cod payment attempt already exists for this order",
        "separate status audit event":
            "payment_transaction.status_changed",
        "separate provider-reference audit event":
            "payment_transaction.provider_reference_attached",
    }

    for label, marker in required_markers.items():
        if marker.lower() not in safeguard_clean:
            errors.append(
                f"Migration 004 is missing static safeguard marker: {label}"
            )

    notes.append(
        "Table/RLS sets checked: 23 core tables in 001/002; "
        "payment_transactions and its RLS in 003."
    )


def check_required_files() -> None:
    """Require the documented paths from the actual repository layout."""
    required_files = [
        ROOT / "supabase" / "config.toml",
        ROOT / "scripts" / "validate_stage1.py",
        *REQUIRED_DOCUMENTS,
        *(TESTS_DIR / name for name in EXPECTED_TESTS),
    ]

    for path in required_files:
        if not path.is_file():
            errors.append(f"Missing required file: {relative(path)}")

    if TESTS_DIR.is_dir():
        actual_tests = {
            path.name for path in TESTS_DIR.glob("*.test.sql") if path.is_file()
        }
        unexpected = actual_tests - EXPECTED_TESTS
        missing = EXPECTED_TESTS - actual_tests

        if missing:
            errors.append(f"Missing required SQL tests: {sorted(missing)}")
        if unexpected:
            warnings.append(
                "Additional SQL test files found (not rejected): "
                + ", ".join(sorted(unexpected))
            )


def check_sql_lexical_balance(paths: list[Path]) -> None:
    """Run lightweight lexical balance checks over migrations and SQL tests."""
    for path in paths:
        sql = read_text(path)
        if sql is None:
            continue

        issue = lexical_balance(path, sql)
        if issue:
            errors.append(issue)

    notes.append(
        "SQL lexical balance checked. This is not PostgreSQL syntax validation."
    )


def check_pgtap_plans() -> None:
    """Compare each pgTAP plan(n) with its visible assertion-call count."""
    if not TESTS_DIR.is_dir():
        errors.append(f"Missing SQL tests directory: {relative(TESTS_DIR)}")
        return

    for path in sorted(TESTS_DIR.glob("*.test.sql")):
        sql = read_text(path)
        if sql is None:
            continue

        clean = strip_sql_comments(sql)

        plans = re.findall(
            r"\bselect\s+plan\s*\(\s*(\d+)\s*\)\s*;",
            clean,
            re.IGNORECASE,
        )

        if len(plans) != 1:
            errors.append(
                f"{relative(path)} must contain exactly one select plan(n); "
                f"found {len(plans)}"
            )
            continue

        planned = int(plans[0])

        assertion_pattern = re.compile(
            r"^\s*select\s+("
            + "|".join(re.escape(name) for name in sorted(PGTAP_ASSERTIONS))
            + r")\s*\(",
            re.IGNORECASE | re.MULTILINE,
        )

        actual = len(assertion_pattern.findall(clean))

        if planned != actual:
            errors.append(
                f"{relative(path)} pgTAP plan mismatch: "
                f"plan={planned}, detected assertions={actual}"
            )

    notes.append(
        "pgTAP plan counts compared with statically detected assertion calls; "
        "the tests themselves were not executed."
    )


def main() -> int:
    migration_paths = check_migration_sequence()
    check_required_files()
    check_table_and_rls_sets(migration_paths)
    check_pgtap_plans()

    sql_paths = list(migration_paths.values())
    if TESTS_DIR.is_dir():
        sql_paths.extend(
            path for path in TESTS_DIR.glob("*.test.sql") if path.is_file()
        )
    check_sql_lexical_balance(sql_paths)

    if errors:
        print("STATIC VALIDATION: FAIL")
        for err in errors:
            print(f"- {err}")

        if warnings:
            print("\nWarnings:")
            for warning in warnings:
                print(f"- {warning}")

        print("\nRuntime validation: NOT RUN")
        return 1

    print("STATIC VALIDATION: PASS")
    print(f"Migration files: {len(migration_paths)}")
    print("Core application tables: 23 (migration 001)")
    print("Core table RLS coverage: 23 (migration 002)")
    print("Payment transaction table/RLS: checked separately in migration 003")
    print(f"Required SQL tests: {len(EXPECTED_TESTS)}")
    print("Documentation paths: checked against docs/database and docs/reports")

    for note in notes:
        print(f"- {note}")

    print("\nSTATIC-ONLY LIMITATIONS:")
    print("- No PostgreSQL SQL parser was used.")
    print("- No migrations were applied.")
    print("- No pgTAP tests were executed.")
    print("- RLS, Storage, and payment behavior were not runtime-verified.")

    if warnings:
        print("\nWarnings:")
        for warning in warnings:
            print(f"- {warning}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
