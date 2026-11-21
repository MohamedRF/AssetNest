#!/bin/sh
# Shared helpers for AssetNest backup/restore scripts. POSIX sh; no bashisms.
set -eu

log() { printf '[assetnest-backup] %s\n' "$*" >&2; }
die() { printf '[assetnest-backup] ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

utc_stamp() { date -u +%Y%m%dT%H%M%SZ; }

# Replace the database path while keeping TLS and other connection options.
with_dbname() {
  _url=$1
  _db=$2
  _base=${_url%%\?*}
  case "$_base" in
    postgres://*|postgresql://*) ;;
    *) die "the drill requires a PostgreSQL connection URL" ;;
  esac
  _scheme=${_base%%://*}
  _authority=${_base#*://}
  _authority=${_authority%%/*}
  _query=${_url#"$_base"}
  _options=${_query#\?}
  while [ -n "$_options" ]; do
    _option=${_options%%&*}
    case "${_option%%=*}" in
      dbname|database|*%*) die "the drill URL cannot override the database path" ;;
    esac
    [ "$_option" != "$_options" ] || break
    _options=${_options#*&}
  done
  printf '%s://%s/%s%s' "$_scheme" "$_authority" "$_db" "$_query"
}
