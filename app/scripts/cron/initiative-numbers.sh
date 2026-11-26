#!/usr/bin/env bash
# Runs the nightly initiative number read (POST /api/cron/initiative-numbers). Idempotent per UTC day, so a second run reads nothing twice.
# Needs CITADEL_URL (no trailing slash) and CRON_SECRET in the environment; it reads no files.
# Nightly cron line:
#   15 1 * * *  CITADEL_URL=https://<citadel host> CRON_SECRET=<the app's CRON_SECRET> /path/to/app/scripts/cron/initiative-numbers.sh
set -euo pipefail
: "${CITADEL_URL:?set CITADEL_URL to the Citadel base address}"
: "${CRON_SECRET:?set CRON_SECRET to the app CRON_SECRET}"
exec curl -fsS --max-time 120 -X POST -H "x-cron-secret: ${CRON_SECRET}" "${CITADEL_URL}/api/cron/initiative-numbers"
