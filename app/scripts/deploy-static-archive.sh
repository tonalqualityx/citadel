#!/usr/bin/env bash
# Keeps the previous two builds' .next/static chunks servable after a deploy, so a browser tab
# (or a cached HTML document) from an older build still finds its chunks instead of a 404.
#
#   deploy-static-archive.sh archive   BEFORE the old .next is deleted: copy the build's OWN static
#                                      files into $APP_DIR/.next-archive/<build id>/static, keep 2.
#   deploy-static-archive.sh merge     AFTER the new .next is in place, BEFORE pm2 restart: copy the
#                                      archived static files into the new .next/static, never
#                                      overwriting a file the new build already has.
#
# Absolute paths only. The only deletion is pruning directories directly inside the archive
# folder this script creates ($APP_DIR/.next-archive).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/citadel/app}"
KEEP="${KEEP:-2}"
ARCH="$APP_DIR/.next-archive"
STATIC="$APP_DIR/.next/static"
OWN_LIST="$APP_DIR/.next/own-static-files.txt"

case "${1:-}" in
  archive)
    if [ ! -d "$STATIC" ] || [ ! -f "$APP_DIR/.next/BUILD_ID" ]; then
      echo "archive: no previous build at $APP_DIR/.next, nothing to keep"; exit 0
    fi
    id="$(tr -d '[:space:]' < "$APP_DIR/.next/BUILD_ID")"
    case "$id" in ''|*[!A-Za-z0-9._-]*) echo "archive: odd build id '$id', skipping"; exit 0;; esac
    mkdir -p "$ARCH/$id/static"
    if [ -f "$OWN_LIST" ]; then
      tar -C "$STATIC" -cf - -T "$OWN_LIST" | tar -C "$ARCH/$id/static" -xf -
    else
      tar -C "$STATIC" -cf - . | tar -C "$ARCH/$id/static" -xf -
    fi
    touch "$ARCH/$id"
    echo "archive: kept build $id"
    # prune: newest $KEEP stay
    n=0
    for d in $(ls -1t "$ARCH"); do
      n=$((n+1))
      if [ "$n" -gt "$KEEP" ]; then
        case "$d" in ''|*[!A-Za-z0-9._-]*) continue;; esac
        [ -d "$ARCH/$d" ] && rm -rf "$ARCH/$d" && echo "archive: pruned $d"
      fi
    done
    ;;
  merge)
    [ -d "$STATIC" ] || { echo "merge: $STATIC missing" >&2; exit 1; }
    # record the new build's own files first, so a later archive never re-archives merged ones
    (cd "$STATIC" && find . -type f | sed 's|^\./||') > "$OWN_LIST"
    if [ -d "$ARCH" ]; then
      for d in "$ARCH"/*/; do
        [ -d "${d}static" ] || continue
        cp -an "${d}static/." "$STATIC/"
        echo "merge: merged $(basename "$d")"
      done
    fi
    ;;
  *) echo "usage: $0 archive|merge" >&2; exit 2;;
esac
