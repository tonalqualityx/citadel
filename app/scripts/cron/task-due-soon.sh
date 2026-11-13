#!/usr/bin/env bash
# Runs the day-before notice (POST /api/cron/task-due-soon). Idempotent, so it may run every hour.
# Needs CITADEL_URL (no trailing slash) and CRON_SECRET in the environment; it reads no files.
set -euo pipefail
: "${CITADEL_URL:?set CITADEL_URL to the Citadel base address}"
: "${CRON_SECRET:?set CRON_SECRET to the app's CRON_SECRET}"
exec curl -fsS --max-time 120 -X POST -H "x-cron-secret: ${CRON_SECRET}" "${CITADEL_URL}/api/cron/task-due-soon"
