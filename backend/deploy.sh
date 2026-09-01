#!/usr/bin/env bash
#
# One-shot production deploy for the ClaimOptiq backend.
#
# Fixes the recurring "Invalid prisma.user.findFirst() ... Unknown field
# `reference` on model `User`" (and any future schema drift) by guaranteeing the
# steps a deploy needs, IN ORDER, and then doing the one that's easy to forget:
#
#   1. latest code   2. deps   3. DB migrated   4. Prisma Client regenerated
#   5. RESTART the Node process  ← a running server keeps the OLD client in
#      memory, so `prisma generate` alone never fixes a live server. This is why
#      /api/settings worked (doesn't touch the reference relation) while
#      /api/auth/login 500'd (it does): the process was never restarted.
#
# Usage (from the backend dir on the server):
#   ./deploy.sh
#
# Optional env vars:
#   SKIP_PULL=1              # skip `git pull` (if code is deployed some other way)
#   PM2_APP=claimoptiq       # pm2 app/id to restart (default: all)
#   APP_SERVICE=claimoptiq   # systemd unit name, if you don't use pm2

set -euo pipefail
cd "$(dirname "$0")"

echo "▶ ClaimOptiq backend deploy — $(pwd)"

# 1. Latest code
if [ "${SKIP_PULL:-0}" != "1" ]; then
  echo "▶ [1/5] git pull"
  git pull --ff-only
else
  echo "▶ [1/5] git pull skipped (SKIP_PULL=1)"
fi

# 2. Dependencies
echo "▶ [2/5] npm install"
npm install --no-audit --no-fund

# 3. Apply migrations (idempotent; the correct production command)
echo "▶ [3/5] prisma migrate deploy"
npx prisma migrate deploy

# 4. Regenerate the Prisma Client from the current schema
echo "▶ [4/5] prisma generate"
npx prisma generate

# 4b. Verify the freshly generated client actually knows the new field. If this
#     fails, the schema on disk is stale (bad pull / wrong branch) — stop BEFORE
#     restarting so we don't relaunch into the same broken state.
echo "▶ verifying generated client is current ..."
node -e "const {Prisma}=require('@prisma/client'); if(!Prisma.UserScalarFieldEnum || !Prisma.UserScalarFieldEnum.referenceId){console.error('✗ generated client is MISSING User.referenceId — the schema on disk is stale. Fix git branch/pull, then re-run.');process.exit(1);} console.log('✓ client has User.referenceId');"

# 5. Restart the running process so it loads the new client
echo "▶ [5/5] restart app"
if command -v pm2 >/dev/null 2>&1; then
  TARGET="${PM2_APP:-all}"
  pm2 restart "$TARGET" --update-env
  pm2 save >/dev/null 2>&1 || true
  echo "✓ pm2 restarted ($TARGET)"
elif [ -n "${APP_SERVICE:-}" ]; then
  sudo systemctl restart "$APP_SERVICE"
  echo "✓ systemd restarted ($APP_SERVICE)"
else
  echo "⚠ No pm2 found and APP_SERVICE not set — RESTART THE BACKEND MANUALLY now."
  echo "  e.g.  pm2 restart all   |   sudo systemctl restart <your-service>"
  exit 1
fi

echo "✅ Deploy complete — login should work now."
