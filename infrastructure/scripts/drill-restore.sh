#!/bin/sh
# AssetNest backup → loss → restore drill.
#
# Creates two uniquely named throwaway databases on the same PostgreSQL server:
#   <DRILL_DB>_<run>_src  — migrated, seeded and given a marker asset
#   <DRILL_DB>_<run>_dst  — the restore target
# It backs up the source (database + a private-file archive), drops the source to
# simulate data loss, restores into the target and compares row counts + marker.
#
#   DATABASE_URL     required  postgres connection string (any database on the server)
#   DRILL_DB         optional  database name prefix (default assetnest_drill)
#   DRILL_ADMIN_URL  optional  defaults to DATABASE_URL with database "postgres"
#   MIGRATE_CMD      optional  default "node packages/db/dist/migrate.js"
#   SEED_CMD         optional  default "node packages/db/dist/seed.js"
#   BACKUP_DIR       optional  default ./var/backups
#   KEEP_DRILL=1     optional  keep the restored database for inspection
#
# Requires: psql, pg_dump, pg_restore, node, and the built @assetnest/db.
set -eu
umask 077
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$DIR/lib.sh"

REPO_ROOT=$(CDPATH='' cd -- "$DIR/../.." && pwd)
cd "$REPO_ROOT"

: "${DATABASE_URL:?DATABASE_URL is required}"
DRILL_DB=${DRILL_DB:-assetnest_drill}
case "$DRILL_DB" in
  [!a-z_]*|*[!a-z0-9_]*) die "DRILL_DB must be a lowercase PostgreSQL identifier prefix" ;;
esac
[ "${#DRILL_DB}" -le 40 ] || die "DRILL_DB prefix must be at most 40 characters"
ADMIN_URL=${DRILL_ADMIN_URL:-$(with_dbname "$DATABASE_URL" postgres)}
MIGRATE_CMD=${MIGRATE_CMD:-node packages/db/dist/migrate.js}
SEED_CMD=${SEED_CMD:-node packages/db/dist/seed.js}
BACKUP_DIR=${BACKUP_DIR:-./var/backups}
KEEP=${KEEP_DRILL:-0}
STAMP=$(utc_stamp)

need psql
need pg_dump
need pg_restore
need node

psql_drill() { psql --no-psqlrc --set ON_ERROR_STOP=1 "$@"; }

DRILL_DIR=$(mktemp -d "${TMPDIR:-/tmp}/assetnest-drill-XXXXXXXX")
RUN_ID=$(printf '%s' "${DRILL_DIR##*-}" | tr '[:upper:]' '[:lower:]')
SRC_DB="${DRILL_DB}_${RUN_ID}_src"
DST_DB="${DRILL_DB}_${RUN_ID}_dst"
SRC_CREATED=0
DST_CREATED=0
cleanup() {
  status=$?
  if [ "$SRC_CREATED" = 1 ]; then
    psql_drill "$ADMIN_URL" -c "DROP DATABASE \"$SRC_DB\" WITH (FORCE)" >/dev/null || status=1
  fi
  if [ "$DST_CREATED" = 1 ]; then
    if [ "$KEEP" = 1 ]; then
      log "kept restored database $DST_DB"
    else
      psql_drill "$ADMIN_URL" -c "DROP DATABASE \"$DST_DB\" WITH (FORCE)" >/dev/null || status=1
    fi
  fi
  rm -rf -- "$DRILL_DIR" || status=1
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

SRC_URL=$(with_dbname "$DATABASE_URL" "$SRC_DB")
DST_URL=$(with_dbname "$DATABASE_URL" "$DST_DB")
STORAGE_SRC="$DRILL_DIR/source"
STORAGE_DST="$DRILL_DIR/restore"
mkdir "$STORAGE_SRC" "$STORAGE_DST"

count_query="select (select count(*) from workspaces)||'/'||(select count(*) from assets)||'/'||(select count(*) from audit_log)"

log "creating drill databases ($SRC_DB, $DST_DB)"
psql_drill "$ADMIN_URL" -c "CREATE DATABASE \"$SRC_DB\""
SRC_CREATED=1
psql_drill "$ADMIN_URL" -c "CREATE DATABASE \"$DST_DB\""
DST_CREATED=1
[ "$(psql_drill "$SRC_URL" -Atc 'select current_database()')" = "$SRC_DB" ] || die "unexpected drill source database"
[ "$(psql_drill "$DST_URL" -Atc 'select current_database()')" = "$DST_DB" ] || die "unexpected drill restore database"

log "migrating + seeding source"
DATABASE_URL="$SRC_URL" $MIGRATE_CMD
(
  unset SEED_ADMIN_EMAIL SEED_ADMIN_PASSWORD
  DATABASE_URL="$SRC_URL" $SEED_CMD
)

log "writing marker data + private file"
psql_drill "$SRC_URL" -c \
  "insert into workspaces (name, slug) values ('Drill WS', 'drill-ws');
   insert into assets (workspace_id, asset_tag, display_name)
     select id, 'DRILL-0001', 'Drill asset' from workspaces where slug = 'drill-ws';
   insert into audit_log (workspace_id, action, resource)
     select id, 'drill.marker', 'drill' from workspaces where slug = 'drill-ws';"
printf 'assetnest-drill-%s\n' "$STAMP" >"$STORAGE_SRC/evidence.txt"

EXPECTED=$(psql_drill "$SRC_URL" -Atc "$count_query")
log "source counts (workspaces/assets/audit_log): $EXPECTED"

log "backing up source"
DUMP=$(DATABASE_URL="$SRC_URL" BACKUP_DIR="$BACKUP_DIR" BACKUP_PREFIX="drill" STORAGE_ROOT="$STORAGE_SRC" sh "$DIR/backup.sh")
log "simulating data loss (dropping source)"
psql_drill "$ADMIN_URL" -c "DROP DATABASE \"$SRC_DB\" WITH (FORCE)"
SRC_CREATED=0

log "restoring into $DST_DB"
DATABASE_URL="$DST_URL" STORAGE_ROOT="$STORAGE_DST" sh "$DIR/restore.sh" "$DUMP" >/dev/null

ACTUAL=$(psql_drill "$DST_URL" -Atc "$count_query")
log "restored counts (workspaces/assets/audit_log): $ACTUAL"
[ "$EXPECTED" = "$ACTUAL" ] || die "row counts differ after restore (expected $EXPECTED, got $ACTUAL)"

MARKER=$(psql_drill "$DST_URL" -Atc "select asset_tag from assets where asset_tag = 'DRILL-0001'")
[ "$MARKER" = "DRILL-0001" ] || die "marker asset missing after restore"

cmp -s "$STORAGE_SRC/evidence.txt" "$STORAGE_DST/evidence.txt" || die "private-file archive did not round-trip"

log "restore drill PASSED (db counts and private file match)"
