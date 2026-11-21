#!/bin/sh
# AssetNest database + private-file restore. DESTRUCTIVE on the target database.
#
#   DATABASE_URL   required  target postgres connection string
#   BACKUP_DIR     optional  default ./var/backups (used to find the latest dump)
#   STORAGE_ROOT   required when restoring a storage archive
#
# Usage:
#   sh infrastructure/scripts/restore.sh [dump-file] [storage-archive]
#
# With no arguments the newest *.dump in BACKUP_DIR is used. A companion
# archive next to the dump is picked up automatically unless a path is given.
set -eu
umask 077
DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=lib.sh
. "$DIR/lib.sh"

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-./var/backups}
DUMP=${1:-}
STORAGE=${2:-}

if [ -z "$DUMP" ]; then
  for candidate in "$BACKUP_DIR"/*.dump; do
    [ -f "$candidate" ] || continue
    if [ -z "$DUMP" ] || [ "$candidate" -nt "$DUMP" ]; then
      DUMP=$candidate
    fi
  done
fi
[ -n "$DUMP" ] && [ -f "$DUMP" ] || die "no dump found — pass a path or set BACKUP_DIR"

need pg_restore
need psql
pg_restore --list -- "$DUMP" >/dev/null || die "dump is not a readable archive"

if [ -z "$STORAGE" ]; then
  COMPANION="${DUMP%.dump}-storage.tar.gz"
  MANIFEST="${DUMP%.dump}.manifest.txt"
  if [ -f "$COMPANION" ]; then
    STORAGE=$COMPANION
  elif [ -n "${STORAGE_ROOT:-}" ] || { [ -f "$MANIFEST" ] && grep -q '^storage=.' "$MANIFEST"; }; then
    die "matching storage archive is missing — pass its path explicitly"
  fi
fi

if [ -n "$STORAGE" ]; then
  need tar
  [ -f "$STORAGE" ] || die "storage archive is missing"
  [ -n "${STORAGE_ROOT:-}" ] || die "STORAGE_ROOT must be set to restore private files"
  mkdir -p -- "$STORAGE_ROOT"
  [ -d "$STORAGE_ROOT" ] && [ -w "$STORAGE_ROOT" ] || die "STORAGE_ROOT is not writable"
  tar -tzf "$STORAGE" >/dev/null || die "storage archive is unreadable"
fi

log "restoring database from $DUMP"
pg_restore --single-transaction --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" -- "$DUMP"

log "post-restore row counts:"
psql "$DATABASE_URL" --no-psqlrc --set ON_ERROR_STOP=1 -Atc \
  "select 'users='||(select count(*) from users)||' workspaces='||(select count(*) from workspaces)||' assets='||(select count(*) from assets)"

if [ -n "$STORAGE" ]; then
  log "restoring private files from $STORAGE into $STORAGE_ROOT"
  tar -xzf "$STORAGE" -C "$STORAGE_ROOT"
fi

log "restore complete"
