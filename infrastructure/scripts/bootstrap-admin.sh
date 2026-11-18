#!/bin/sh
# bootstrap-admin.sh — pre-flight check of .env before AssetNest's first-time setup.
#
# Verifies (without modifying anything):
#   1. the .env file exists (repo-root .env by default, or the path passed as $1)
#   2. SESSION_SECRET is set, is NOT the REPLACE_* placeholder, and is >= 32 bytes
#      (mirrors the fail-fast check in @assetnest/config)
#   3. ENCRYPTION_KEY is set, is NOT the REPLACE_* placeholder, and base64-decodes
#      to exactly 32 bytes (when openssl is available)
#   4. warns (does not fail) if DATABASE_URL still contains CHANGE_ME or if the
#      compose-only POSTGRES_* variables are missing
#
# This script deliberately does NOT create the admin user and does NOT touch any
# database — it only stops you from booting with example credentials. After it
# passes, follow the printed next steps (migrations, seed, start).
#
# Usage:
#   sh infrastructure/scripts/bootstrap-admin.sh [path-to-env]
#   (or chmod +x infrastructure/scripts/bootstrap-admin.sh and run it directly)
#
# Exit codes: 0 = checks passed, 1 = a required check failed.
set -eu

ENV_FILE="${1:-.env}"

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

warn() {
    echo "WARN:  $*" >&2
}

if [ ! -f "$ENV_FILE" ]; then
    fail "$ENV_FILE not found. Create it first: cp .env.example .env  — then edit every REPLACE_*/CHANGE_ME value."
fi

# Extract the value of KEY from .env without sourcing the file (sourcing would
# execute arbitrary code). Tolerates blank lines, comments and surrounding quotes.
get_val() {
    _key="$1"
    _line=$(grep -E "^[[:space:]]*${_key}[[:space:]]*=" "$ENV_FILE" | head -n 1 || true)
    if [ -z "$_line" ]; then
        printf ''
        return 0
    fi
    _val=${_line#*=}
    # Trim leading/trailing whitespace.
    _val=$(printf '%s' "$_val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    # Strip one layer of surrounding single or double quotes.
    case "$_val" in
        \"*\") _val=${_val#\"}; _val=${_val%\"} ;;
        \'*\') _val=${_val#\'}; _val=${_val%\'} ;;
        # Unquoted value: drop an inline comment introduced by whitespace + '#'
        # (dotenv convention). A '#' directly inside the value is preserved.
        *) _val=$(printf '%s' "$_val" | sed -e 's/[[:space:]]#.*$//') ;;
    esac
    printf '%s' "$_val"
}

check_secret() {
    _name="$1"
    _val="$2"
    _hint="$3"
    if [ -z "$_val" ]; then
        fail "$_name is missing or empty in $ENV_FILE. Generate one, e.g.: $_hint"
    fi
    case "$_val" in
        REPLACE_*|CHANGE_ME*|*REPLACE_WITH*|*CHANGE_ME*)
            fail "$_name in $ENV_FILE is still the example placeholder. Generate a real value: $_hint"
            ;;
    esac
}

SESSION_SECRET=$(get_val SESSION_SECRET)
ENCRYPTION_KEY=$(get_val ENCRYPTION_KEY)
DATABASE_URL=$(get_val DATABASE_URL)
POSTGRES_USER=$(get_val POSTGRES_USER)
POSTGRES_PASSWORD=$(get_val POSTGRES_PASSWORD)
POSTGRES_DB=$(get_val POSTGRES_DB)

# Mirror the fail-fast checks in @assetnest/config so a bad key fails here, not
# in an api crash loop: SESSION_SECRET >= 32 bytes; ENCRYPTION_KEY must
# base64-decode to exactly 32 bytes.
check_secret SESSION_SECRET "$SESSION_SECRET" "openssl rand -base64 48"
check_secret ENCRYPTION_KEY "$ENCRYPTION_KEY" "openssl rand -base64 32"

if [ "${#SESSION_SECRET}" -lt 32 ]; then
    fail "SESSION_SECRET in $ENV_FILE is only ${#SESSION_SECRET} bytes — @assetnest/config requires at least 32. Generate: openssl rand -base64 48"
fi

if command -v openssl >/dev/null 2>&1; then
    _keylen=$(printf '%s' "$ENCRYPTION_KEY" | openssl base64 -d -A 2>/dev/null | wc -c | tr -d '[:space:]' || true)
    if [ "$_keylen" != "32" ]; then
        fail "ENCRYPTION_KEY in $ENV_FILE does not base64-decode to exactly 32 bytes. Generate: openssl rand -base64 32"
    fi
fi

case "$DATABASE_URL" in
    *CHANGE_ME*|*REPLACE_*)
        warn "DATABASE_URL in $ENV_FILE still contains a placeholder — migrations and the API will not connect."
        ;;
esac

if [ -z "$POSTGRES_USER" ] || [ -z "$POSTGRES_PASSWORD" ] || [ -z "$POSTGRES_DB" ]; then
    warn "Compose-only variables (POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB) are missing from $ENV_FILE.
      docker compose cannot start postgres without them — see infrastructure/compose/README.md section 1."
fi

echo "OK: $ENV_FILE exists and SESSION_SECRET / ENCRYPTION_KEY are set to non-placeholder values."
echo
echo "Next steps (from the repo root):"
echo "  1. Apply database migrations:"
echo "       pnpm --filter @assetnest/db migrate"
echo "     (self-hosted full stack: migrations run automatically as the one-shot"
echo "      'migrate' compose service before the api starts)"
echo "  2. Seed the first administrator (empty databases only — idempotent):"
echo "       pnpm --filter @assetnest/db seed"
echo "     with SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD set in .env"
echo "  3. Start the stack:"
echo "       dev:         docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile infra up -d"
echo "                    pnpm dev"
echo "       self-hosted: docker compose --env-file .env -f infrastructure/compose/compose.yaml --profile app up -d --build"
echo "  4. Verify health: curl -fsS http://localhost/health/live"
echo
echo "Reminder: never commit .env. Back it up (with ENCRYPTION_KEY) as securely as your data."
