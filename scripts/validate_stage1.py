#!/usr/bin/env python3
"""Static checks for BazarHQ Stage 1 artifacts; not a PostgreSQL parser or runtime test."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = sorted((ROOT / "supabase" / "migrations").glob("*.sql"))
TESTS = sorted((ROOT / "supabase" / "tests").glob("*.test.sql"))
errors = []
notes = []

if not (ROOT / "supabase" / "config.toml").exists():
    errors.append("Missing supabase/config.toml")
if len(MIGRATIONS) != 4:
    errors.append(f"Expected 4 versioned migrations; found {len(MIGRATIONS)}")
expected_names = [
    "20261021000100_core_schema.sql",
    "20261021000200_rls_storage.sql",
    "20261021000300_payment_transactions_option_b.sql",
    "20261021000400_payment_attempt_safeguards.sql",
]
if [p.name for p in MIGRATIONS] != expected_names:
    errors.append("Migration sequence/names do not match the documented forward-only sequence")

# Check that all public application tables declared by the migrations have RLS enablement.
all_sql = "\n".join(p.read_text(encoding="utf-8") for p in MIGRATIONS)
created = set(re.findall(r"create\s+table\s+public\.([a-z_][a-z0-9_]*)", all_sql, re.I))
rls_enabled = set(re.findall(r"alter\s+table\s+public\.([a-z_][a-z0-9_]*)\s+enable\s+row\s+level\s+security", all_sql, re.I))
if len(created) != 24:
    errors.append(f"Expected 24 public application tables; found {len(created)}")
if created != rls_enabled:
    errors.append(f"RLS table set mismatch: missing={sorted(created-rls_enabled)}, extra={sorted(rls_enabled-created)}")

required = {
    "migration 004 requires a payment configuration": "new payment attempt requires an enabled payment configuration",
    "settled payment states blocked": "('paid','cod_collected','refunded','pending_verification')",
    "active attempt guard": "an active payment attempt already exists for this order",
    "COD one-attempt guard": "a cod payment attempt already exists for this order",
    "separate status audit": "payment_transaction.status_changed",
    "separate provider-reference audit": "payment_transaction.provider_reference_attached",
}
fix_sql = (ROOT / "supabase/migrations/20261021000400_payment_attempt_safeguards.sql").read_text(encoding="utf-8").lower()
for label, token in required.items():
    if token.lower() not in fix_sql:
        errors.append(f"Missing safeguard marker: {label}")

# Verify each pgTAP plan equals the number of assertion calls (excluding finish()).
assertion_re = re.compile(r"^\s*select\s+(?:ok|is|isnt|throws_ok|lives_ok|like|unlike|cmp_ok|results_eq|set_eq|has_table|has_column|has_index|has_function|has_trigger)\s*\(", re.I)
for test in TESTS:
    text = test.read_text(encoding="utf-8")
    match = re.search(r"select\s+plan\s*\(\s*(\d+)\s*\)\s*;", text, re.I)
    if not match:
        errors.append(f"{test.relative_to(ROOT)} has no pgTAP plan")
        continue
    planned = int(match.group(1))
    actual = sum(1 for line in text.splitlines() if assertion_re.match(line))
    if planned != actual:
        errors.append(f"{test.relative_to(ROOT)} plan={planned}, assertions={actual}")

# Lightweight lexical balance check. This deliberately does not claim SQL syntax validation.
def lexical_balance(path: Path):
    text = path.read_text(encoding="utf-8")
    i = 0
    stack = []
    state = "normal"
    dollar_tag = None
    while i < len(text):
        ch = text[i]
        nxt = text[i+1] if i+1 < len(text) else ""
        if state == "line_comment":
            if ch == "\n": state = "normal"
            i += 1; continue
        if state == "block_comment":
            if ch == "*" and nxt == "/": state = "normal"; i += 2; continue
            i += 1; continue
        if state == "single":
            if ch == "'":
                if nxt == "'": i += 2; continue
                state = "normal"
            elif ch == "\\":
                i += 2; continue
            i += 1; continue
        if state == "double":
            if ch == '"':
                if nxt == '"': i += 2; continue
                state = "normal"
            i += 1; continue
        if state == "dollar":
            if text.startswith(dollar_tag, i):
                i += len(dollar_tag); state = "normal"; dollar_tag = None; continue
            i += 1; continue
        if ch == "-" and nxt == "-": state = "line_comment"; i += 2; continue
        if ch == "/" and nxt == "*": state = "block_comment"; i += 2; continue
        if ch == "'": state = "single"; i += 1; continue
        if ch == '"': state = "double"; i += 1; continue
        if ch == "$": 
            m = re.match(r"\$[A-Za-z_0-9]*\$", text[i:])
            if m:
                dollar_tag = m.group(0); state = "dollar"; i += len(dollar_tag); continue
        if ch in "(": stack.append((ch, i))
        elif ch == ")":
            if not stack: return f"unmatched ')' at offset {i}"
            stack.pop()
        i += 1
    if state in {"single", "double", "dollar", "block_comment"}:
        return f"unterminated lexical construct ({state})"
    if stack:
        return f"{len(stack)} unmatched opening parenthesis/parentheses"
    return None

for sql_file in MIGRATIONS + TESTS:
    issue = lexical_balance(sql_file)
    if issue:
        errors.append(f"{sql_file.relative_to(ROOT)}: {issue}")

# Check docs and resolved decision naming.
for doc in [ROOT / "README.md", ROOT / "docs/DATABASE_SCHEMA.md", ROOT / "docs/DATABASE_SETUP.md", ROOT / "docs/RLS_POLICY_MATRIX.md", ROOT / "docs/STAGE_1_REPORT.md"]:
    if not doc.exists(): errors.append(f"Missing documentation file: {doc.relative_to(ROOT)}")
if not (ROOT / "docs/PAYMENT_TRANSACTIONS_OPTION_B_DECISION.md").exists():
    errors.append("Missing resolved Option B decision record")

if errors:
    print("STATIC VALIDATION: FAIL")
    for err in errors: print(f"- {err}")
    sys.exit(1)

print("STATIC VALIDATION: PASS")
print(f"Migrations: {len(MIGRATIONS)} (sequence names verified)")
print(f"Application tables: {len(created)}; RLS enablement statements: {len(rls_enabled)}; sets match")
print(f"pgTAP files: {len(TESTS)}; plan counts match assertion counts")
print("SQL lexical balance: PASS (not SQL syntax/runtime validation)")
print("Required payment safeguards: present by static text check")
print("Runtime migrations, PostgreSQL parsing, pgTAP, RLS and Storage behavior: NOT RUN")
