#!/usr/bin/env bash
set -euo pipefail

# One-shot local -> Neon migration with verification + manual fallback package
# Assumptions:
# - run from project root (contains .env and .env.prod)
# - source URL in .env DATABASE_URL
# - target URL in .env.prod DATABASE_URL
# - non-interactive execution only

ROOT_DIR="$(pwd)"
BACKUP_DIR="$ROOT_DIR/backups"
MANUAL_DIR="$BACKUP_DIR/manual-neon-import"
TS="$(date +%Y%m%d_%H%M%S)"
DUMP_FILE="$BACKUP_DIR/local_pre_neon_migration_${TS}.sql"

EXPECTED_MONTHLYPLANS=9
EXPECTED_BILLS=0
EXPECTED_LOANS=1
EXPECTED_CARDS=5
EXPECTED_STATEMENTS=3
EXPECTED_TRANSACTIONS=207
EXPECTED_TX_SUM="264364.38"
EXPECTED_PFTSETTING=1

log() { printf "\n[%s] %s\n" "$(date +%H:%M:%S)" "$*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f ".env" ]] || die ".env not found in $ROOT_DIR"
[[ -f ".env.prod" ]] || die ".env.prod not found in $ROOT_DIR"

set -a
# shellcheck disable=SC1091
source .env
SOURCE_URL="${DATABASE_URL:-}"
# shellcheck disable=SC1091
source .env.prod
TARGET_URL="${DATABASE_URL:-}"
set +a

[[ -n "${SOURCE_URL}" ]] || die "Missing DATABASE_URL in .env"
[[ -n "${TARGET_URL}" ]] || die "Missing DATABASE_URL in .env.prod"

mkdir -p "$BACKUP_DIR" "$MANUAL_DIR"

# Parse URL fields via python (safe + portable)
eval "$(
python3 - <<'PY'
from urllib.parse import urlparse
import os

def export_url(prefix, url):
    u = urlparse(url)
    host = u.hostname or ""
    db = (u.path or "/").lstrip("/")
    user = u.username or ""
    pwd = u.password or ""
    port = u.port or 5432
    print(f"export {prefix}_HOST='{host}'")
    print(f"export {prefix}_DB='{db}'")
    print(f"export {prefix}_USER='{user}'")
    print(f"export {prefix}_PASS='{pwd}'")
    print(f"export {prefix}_PORT='{port}'")
    # docker client cannot use localhost of host directly
    docker_host = "host.docker.internal" if host in ("localhost","127.0.0.1") else host
    print(f"export {prefix}_DOCKER_HOST='{docker_host}'")

export_url("SRC", os.environ["SOURCE_URL"])
export_url("TGT", os.environ["TARGET_URL"])
PY
)"

log "Source (sanitized): host=${SRC_HOST} db=${SRC_DB}"
log "Target (sanitized): host=${TGT_HOST} db=${TGT_DB}"

# Neon direct connections via endpoint host typically do not need PGOPTIONS.
# Forcing endpoint via PGOPTIONS can break startup on some Neon projects.

run_psql_src() {
  local sql="$1"
  docker run --rm \
    -e PGHOST="$SRC_DOCKER_HOST" \
    -e PGPORT="$SRC_PORT" \
    -e PGDATABASE="$SRC_DB" \
    -e PGUSER="$SRC_USER" \
    -e PGPASSWORD="$SRC_PASS" \
    -e PGSSLMODE=disable \
    -e SQL_TEXT="$sql" \
    postgres:17-alpine \
    sh -lc 'printf "%s\n" "$SQL_TEXT" | psql -v ON_ERROR_STOP=1 -At -F "|"'
}

run_psql_tgt_file() {
  local file="$1"
  docker run --rm \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -w "$ROOT_DIR" \
    -e PGHOST="$TGT_HOST" \
    -e PGPORT="$TGT_PORT" \
    -e PGDATABASE="$TGT_DB" \
    -e PGUSER="$TGT_USER" \
    -e PGPASSWORD="$TGT_PASS" \
    -e PGSSLMODE=require \
    postgres:17-alpine \
    sh -lc "psql -v ON_ERROR_STOP=1 -f \"$file\""
}

run_psql_tgt_file_bootstrap() {
  local file="$1"
  docker run --rm \
    -v "$ROOT_DIR:$ROOT_DIR" \
    -w "$ROOT_DIR" \
    -e PGHOST="$TGT_HOST" \
    -e PGPORT="$TGT_PORT" \
    -e PGDATABASE="$TGT_DB" \
    -e PGUSER="$TGT_USER" \
    -e PGPASSWORD="$TGT_PASS" \
    -e PGSSLMODE=require \
    postgres:17-alpine \
    sh -lc "psql -v ON_ERROR_STOP=0 -f \"$file\""
}

run_psql_tgt_query() {
  local sql="$1"
  docker run --rm \
    -e PGHOST="$TGT_HOST" \
    -e PGPORT="$TGT_PORT" \
    -e PGDATABASE="$TGT_DB" \
    -e PGUSER="$TGT_USER" \
    -e PGPASSWORD="$TGT_PASS" \
    -e PGSSLMODE=require \
    -e SQL_TEXT="$sql" \
    postgres:17-alpine \
    sh -lc 'printf "%s\n" "$SQL_TEXT" | psql -v ON_ERROR_STOP=1 -At -F "|"'
}

target_has_core_schema() {
  run_psql_tgt_query "SELECT CASE WHEN to_regclass('public.\"MonthlyPlan\"') IS NULL THEN 0 ELSE 1 END;" \
    | tr -d '\r' \
    | tail -n 1
}

missing_required_tables() {
  run_psql_tgt_query "$(cat <<'SQL'
WITH required(name) AS (
  VALUES
    ('MonthlyPlan'),
    ('Bill'),
    ('Loan'),
    ('Card'),
    ('Statement'),
    ('Transaction'),
    ('PftSetting')
)
SELECT COALESCE(string_agg(name, ','), '')
FROM required
WHERE to_regclass(format('public.%I', name)) IS NULL;
SQL
)"
}

ensure_required_tables_present() {
  local missing
  missing="$(missing_required_tables | tr -d '\r' | tail -n 1)"
  if [[ -n "$missing" ]]; then
    die "Target schema is incomplete. Missing tables: $missing"
  fi
}

ensure_target_schema() {
  local has_schema
  has_schema="$(target_has_core_schema || true)"
  if [[ "$has_schema" == "1" ]]; then
    return 0
  fi

  [[ -d "$ROOT_DIR/prisma/migrations" ]] || die "Target schema missing and prisma/migrations not found."
  log "Target schema missing; applying Prisma migrations..."

  shopt -s nullglob
  local migration_files=("$ROOT_DIR"/prisma/migrations/*/migration.sql)
  shopt -u nullglob

  [[ ${#migration_files[@]} -gt 0 ]] || die "No Prisma migration files found under prisma/migrations."

  IFS=$'\n' migration_files=($(printf '%s\n' "${migration_files[@]}" | sort))
  unset IFS

  local f
  for f in "${migration_files[@]}"; do
    log "Applying migration: ${f#$ROOT_DIR/}"
    run_psql_tgt_file_bootstrap "$f"
  done

  has_schema="$(target_has_core_schema || true)"
  if [[ "$has_schema" != "1" ]]; then
    die "Schema bootstrap finished but core table public.\"MonthlyPlan\" is still missing."
  fi

  ensure_required_tables_present
}

CHECK_SQL="$(cat <<'SQL'
SELECT 'monthlyPlans', COUNT(*), NULL::numeric FROM public."MonthlyPlan"
UNION ALL SELECT 'bills', COUNT(*), NULL::numeric FROM public."Bill"
UNION ALL SELECT 'loans', COUNT(*), NULL::numeric FROM public."Loan"
UNION ALL SELECT 'cards', COUNT(*), NULL::numeric FROM public."Card"
UNION ALL SELECT 'statements', COUNT(*), NULL::numeric FROM public."Statement"
UNION ALL SELECT 'transactions', COUNT(*), COALESCE(SUM(amount),0)::numeric FROM public."Transaction"
UNION ALL SELECT 'pftSetting', COUNT(*), NULL::numeric FROM public."PftSetting";
SQL
)"

cat > "$MANUAL_DIR/01_precheck.sql" <<'SQL'
SELECT 'monthlyPlans' AS metric, COUNT(*) AS row_count, NULL::numeric AS tx_sum FROM public."MonthlyPlan"
UNION ALL SELECT 'bills', COUNT(*), NULL::numeric FROM public."Bill"
UNION ALL SELECT 'loans', COUNT(*), NULL::numeric FROM public."Loan"
UNION ALL SELECT 'cards', COUNT(*), NULL::numeric FROM public."Card"
UNION ALL SELECT 'statements', COUNT(*), NULL::numeric FROM public."Statement"
UNION ALL SELECT 'transactions', COUNT(*), COALESCE(SUM(amount),0)::numeric FROM public."Transaction"
UNION ALL SELECT 'pftSetting', COUNT(*), NULL::numeric FROM public."PftSetting"
ORDER BY 1;
SQL

cat > "$MANUAL_DIR/02_reset.sql" <<'SQL'
BEGIN;
SET CONSTRAINTS ALL DEFERRED;

TRUNCATE TABLE
  public."Transaction",
  public."Statement",
  public."MonthlyPlan",
  public."Bill",
  public."Loan",
  public."Card",
  public."PftSetting"
RESTART IDENTITY CASCADE;
-- Optional:
-- TRUNCATE TABLE public."User" RESTART IDENTITY;

COMMIT;
SQL

cat > "$MANUAL_DIR/04_postcheck.sql" <<'SQL'
SELECT 'monthlyPlans' AS metric, COUNT(*) AS row_count, NULL::numeric AS tx_sum FROM public."MonthlyPlan"
UNION ALL SELECT 'bills', COUNT(*), NULL::numeric FROM public."Bill"
UNION ALL SELECT 'loans', COUNT(*), NULL::numeric FROM public."Loan"
UNION ALL SELECT 'cards', COUNT(*), NULL::numeric FROM public."Card"
UNION ALL SELECT 'statements', COUNT(*), NULL::numeric FROM public."Statement"
UNION ALL SELECT 'transactions', COUNT(*), COALESCE(SUM(amount),0)::numeric FROM public."Transaction"
UNION ALL SELECT 'pftSetting', COUNT(*), NULL::numeric FROM public."PftSetting"
ORDER BY 1;
SQL

log "Creating source backup: $DUMP_FILE"
docker run --rm \
  -v "$BACKUP_DIR:$BACKUP_DIR" \
  -e PGHOST="$SRC_DOCKER_HOST" \
  -e PGPORT="$SRC_PORT" \
  -e PGDATABASE="$SRC_DB" \
  -e PGUSER="$SRC_USER" \
  -e PGPASSWORD="$SRC_PASS" \
  -e PGSSLMODE=disable \
  postgres:17-alpine \
  sh -lc "pg_dump --no-owner --no-privileges --clean --if-exists --format=plain --file \"$DUMP_FILE\""

log "Generating $MANUAL_DIR/03_import_data.sql from backup"
python3 - "$DUMP_FILE" "$MANUAL_DIR/03_import_data.sql" <<'PY'
import re, sys
src, out = sys.argv[1], sys.argv[2]
tables = ["Bill","Card","Loan","MonthlyPlan","PftSetting","Statement","Transaction","User"]
copy_re = re.compile(r'^COPY public\."([^"]+)" ')
in_copy = False
keep = False
with open(src, "r", encoding="utf-8", errors="replace") as f, open(out, "w", encoding="utf-8") as w:
    w.write("-- Data-only import script for Neon SQL editor\n")
    w.write("BEGIN;\nSET CONSTRAINTS ALL DEFERRED;\n\n")
    for line in f:
        if not in_copy:
            m = copy_re.match(line)
            if m:
                in_copy = True
                keep = m.group(1) in tables
                if keep:
                    w.write(line)
            continue
        else:
            if keep:
                w.write(line)
            if line.strip() == r"\.":
                in_copy = False
                keep = False
    w.write("\nCOMMIT;\n")
PY

cat > "$MANUAL_DIR/00_readme.md" <<EOF
# Manual Neon import package
Generated: ${TS}

## Expected parity after import
- monthlyPlans: ${EXPECTED_MONTHLYPLANS}
- bills: ${EXPECTED_BILLS}
- loans: ${EXPECTED_LOANS}
- cards: ${EXPECTED_CARDS}
- statements: ${EXPECTED_STATEMENTS}
- transactions: ${EXPECTED_TRANSACTIONS}
- tx sum: ${EXPECTED_TX_SUM}
- pftSetting: ${EXPECTED_PFTSETTING}
EOF

log "Source precheck:"
run_psql_src "$CHECK_SQL" | tee "$BACKUP_DIR/local_precheck_${TS}.txt"

log "Testing target connectivity..."
set +e
run_psql_tgt_query "SELECT current_database(), current_user;" >/tmp/neon_conn_${TS}.txt 2>/tmp/neon_conn_err_${TS}.txt
TGT_CONN_RC=$?
set -e

if [[ $TGT_CONN_RC -ne 0 ]]; then
  echo "Direct Neon psql connection failed."
  cat /tmp/neon_conn_err_${TS}.txt
  echo "Fallback package ready: $MANUAL_DIR"
  exit 2
fi

ensure_target_schema

log "Target precheck:"
run_psql_tgt_query "$CHECK_SQL" | tee "$BACKUP_DIR/neon_precheck_${TS}.txt"

log "Resetting target..."
run_psql_tgt_file "$MANUAL_DIR/02_reset.sql"

log "Importing data..."
run_psql_tgt_file "$MANUAL_DIR/03_import_data.sql"

log "Target postcheck:"
run_psql_tgt_query "$CHECK_SQL" | tee "$BACKUP_DIR/neon_postcheck_${TS}.txt"

python3 - "$BACKUP_DIR/neon_postcheck_${TS}.txt" <<PY
import sys, decimal
expected = {
    "monthlyPlans": ("9", None),
    "bills": ("0", None),
    "loans": ("1", None),
    "cards": ("5", None),
    "statements": ("3", None),
    "transactions": ("207", decimal.Decimal("264364.38")),
    "pftSetting": ("1", None),
}
got = {}
with open(sys.argv[1], "r", encoding="utf-8") as f:
    for ln in f:
        ln = ln.strip()
        if not ln: continue
        metric, cnt, total = (ln.split("|") + [""])[:3]
        got[metric] = (cnt, total if total else None)

errs = []
for m, (ec, et) in expected.items():
    if m not in got:
        errs.append(f"{m}: missing")
        continue
    gc, gt = got[m]
    if gc != ec:
        errs.append(f"{m}: count expected {ec} got {gc}")
    if et is not None:
        gtd = decimal.Decimal(gt)
        if gtd.quantize(decimal.Decimal("0.01")) != et:
            errs.append(f"{m}: tx_sum expected {et} got {gtd}")

if errs:
    print("PARITY_CHECK=FAILED")
    for e in errs: print(e)
    sys.exit(3)

print("PARITY_CHECK=PASSED")
PY

log "SUCCESS"
echo "Backup: $DUMP_FILE"
echo "Manual package: $MANUAL_DIR"
