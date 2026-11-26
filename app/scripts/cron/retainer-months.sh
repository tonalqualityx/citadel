#!/usr/bin/env bash
# Runs the daily retainer month cycle (POST /api/cron/retainer-months): drafts next month from the 25th, drafts a missing current month, lets an
# unconfirmed plan stand after the 1st, and closes past months. Idempotent: every step is keyed on (charter, month), so a second run changes nothing.
# Needs CITADEL_URL (no trailing slash) and CRON_SECRET in the environment; it reads no files.
# Daily cron line:
#   20 1 * * *  CITADEL_URL=https://<citadel host> CRON_SECRET=<the app's CRON_SECRET> /path/to/app/scripts/cron/retainer-months.sh
set -euo pipefail
: "${CITADEL_URL:?set CITADEL_URL to the Citadel base address}"
: "${CRON_SECRET:?set CRON_SECRET to the app CRON_SECRET}"
exec curl -fsS --max-time 120 -X POST -H "x-cron-secret: ${CRON_SECRET}" "${CITADEL_URL}/api/cron/retainer-months"
