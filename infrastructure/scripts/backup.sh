#!/bin/sh
# AssetNest database + private-file backup.
#
#   DATABASE_URL     required  postgres connection string
#   BACKUP_DIR       optional  default ./var/backups
#   BACKUP_PREFIX    optional  default assetnest
#   RETENTION_DAYS   optional  default 30 (0 keeps everything)
#   STORAGE_ROOT     optional  when set, archived alongside the dump
#
# Produces:
#   $BACKUP_DIR/<prefix>-<utc>-<id>.dump
#   $BACKUP_DIR/<prefix>-<utc>-<id>-storage.tar.gz   (only when STORAGE_ROOT is set)
#   $BACKUP_DIR/<prefix>-<utc>-<id>.manifest.txt
#
# Prints the dump path on stdout so callers can chain it into restore.sh.
set -eu
umask 077
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$DIR/lib.sh"

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-./var/backups}
PREFIX=${BACKUP_PREFIX:-assetnest}
RETENTION_DAYS=${RETENTION_DAYS:-30}
STAMP=$(utc_stamp)

case "$PREFIX" in
  *[!a-zA-Z0-9_-]*) die "BACKUP_PREFIX may contain only letters, digits, underscores and hyphens" ;;
esac
case "$RETENTION_DAYS" in
  *[!0-9]*) die "RETENTION_DAYS must be a nonnegative integer" ;;
esac

need pg_dump
need pg_restore
need psql
mkdir -p "$BACKUP_DIR"
BACKUP_DIR=$(CDPATH='' cd -- "$BACKUP_DIR" && pwd -P)
if [ -n "${STORAGE_ROOT:-}" ]; then
  [ -d "$STORAGE_ROOT" ] || die "STORAGE_ROOT is not a directory"
  STORAGE_ROOT=$(CDPATH='' cd -- "$STORAGE_ROOT" && pwd -P)
  case "$BACKUP_DIR/" in
    "${STORAGE_ROOT%/}/"*) die "BACKUP_DIR must be outside STORAGE_ROOT" ;;
  esac
  need tar
fi

STAGING=$(mktemp -d "$BACKUP_DIR/.${PREFIX}-${STAMP}-XXXXXXXX")
NAME=${STAGING##*/.}
DUMP="$BACKUP_DIR/$NAME.dump"
MANIFEST="$BACKUP_DIR/$NAME.manifest.txt"
STORAGE=""
cleanup() {
  if [ ! -f "$DUMP" ]; then
    rm -f -- "$MANIFEST"
    if [ -n "$STORAGE" ]; then
      rm -f -- "$STORAGE"
    fi
  fi
  rm -rf -- "$STAGING"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

log "creating database dump $DUMP"
pg_dump --format=custom --no-owner --no-privileges --file="$STAGING/database.dump" "$DATABASE_URL"
[ -s "$STAGING/database.dump" ] || die "pg_dump produced an empty file"
pg_restore --list "$STAGING/database.dump" >/dev/null || die "pg_dump output is not a readable archive"

if [ -n "${STORAGE_ROOT:-}" ]; then
  STORAGE="$BACKUP_DIR/$NAME-storage.tar.gz"
  log "archiving private files $STORAGE_ROOT -> $STORAGE"
  tar -czf "$STAGING/storage.tar.gz" -C "$STORAGE_ROOT" .
  tar -tzf "$STAGING/storage.tar.gz" >/dev/null
fi

COUNTS=$(
  psql "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 -Atc \
    "select 'users='||(select count(*) from users)||' workspaces='||(select count(*) from workspaces)||' assets='||(select count(*) from assets)" \
    || { log "could not read database counts for the manifest"; echo "counts=unavailable"; }
)
{
  echo "timestamp=$STAMP"
  echo "dump=$DUMP"
  echo "storage=$STORAGE"
  echo "git_sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "$COUNTS"
} >"$STAGING/manifest.txt"

# Publish the dump last so automatic restore only discovers completed sets.
if [ -n "$STORAGE" ]; then
  mv -- "$STAGING/storage.tar.gz" "$STORAGE"
fi
mv -- "$STAGING/manifest.txt" "$MANIFEST"
mv -- "$STAGING/database.dump" "$DUMP"

if [ "$RETENTION_DAYS" -gt 0 ] 2>/dev/null; then
  log "pruning backups older than $RETENTION_DAYS days"
  stamp='[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z'
  name="$PREFIX-$stamp-????????"
  find "$BACKUP_DIR" -maxdepth 1 -type f \( -name "$name.dump" -o -name "$PREFIX-$stamp.dump" \) -mtime +"$RETENTION_DAYS" \
    -exec sh -c 'for dump do rm -f -- "$dump" "${dump%.dump}-storage.tar.gz" "${dump%.dump}.manifest.txt" || exit; done' sh {} +
fi

printf '%s\n' "$DUMP"
