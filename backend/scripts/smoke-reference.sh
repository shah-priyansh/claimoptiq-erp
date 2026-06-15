#!/usr/bin/env bash
# Reference master smoke test. Exits non-zero on any failure.
# Run with: bash backend/scripts/smoke-reference.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

say "Login as super_admin"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

say "Pick two billing-service-name ids"
BSN=$(curl -fsS "${H[@]}" "$API/billing-service-names")
ID1=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write((a[0]&&a[0]._id)||'')" "$BSN")
ID2=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write((a[1]&&a[1]._id)||'')" "$BSN")
[[ -n "$ID1" && -n "$ID2" ]] || fail "need at least 2 billing service names seeded; add them in Settings → Billing Service Names first"
pass "applicable services: $ID1, $ID2"

say "Create Reference"
CREATED=$(curl -fsS -X POST "${H[@]}" "$API/references" -d "{
  \"name\":\"Smoke Test Ref\",
  \"mobile\":\"9876543210\",
  \"address\":\"Surat\",
  \"commissionRate\":5,
  \"applicableServiceIds\":[\"$ID1\",\"$ID2\"]
}")
REF_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id||'')" "$CREATED")
[[ -n "$REF_ID" ]] || fail "create returned no id; got: $CREATED"
SVC_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).applicableServices.length))" "$CREATED")
[[ "$SVC_COUNT" == "2" ]] || fail "expected 2 applicable services, got $SVC_COUNT"
pass "created $REF_ID with 2 services"

say "List references"
LIST=$(curl -fsS "${H[@]}" "$API/references")
node -e "const a=JSON.parse(process.argv[1]); if(!a.some(r=>r._id===process.argv[2])) process.exit(1)" "$LIST" "$REF_ID" || fail "list does not contain new reference"
pass "list contains it"

say "Replace applicable services to one"
UPDATED=$(curl -fsS -X PUT "${H[@]}" "$API/references/$REF_ID" -d "{
  \"commissionRate\":7,
  \"applicableServiceIds\":[\"$ID1\"]
}")
NEW_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).applicableServices.length))" "$UPDATED")
[[ "$NEW_COUNT" == "1" ]] || fail "expected 1 service after replace, got $NEW_COUNT"
NEW_RATE=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionRate))" "$UPDATED")
[[ "$NEW_RATE" == "7" ]] || fail "expected rate 7, got $NEW_RATE"
pass "updated rate and services"

say "Attach to a hospital, verify soft-delete branch"
HOSP_LIST=$(curl -fsS "${H[@]}" "$API/hospitals")
HOSP_ID=$(node -e "const a=JSON.parse(process.argv[1]); const x=Array.isArray(a)?a:a.hospitals; process.stdout.write((x[0]&&x[0]._id)||'')" "$HOSP_LIST")
[[ -n "$HOSP_ID" ]] || fail "no hospitals exist"
curl -fsS -X PUT "${H[@]}" "$API/hospitals/$HOSP_ID" -d "{\"referenceId\":\"$REF_ID\"}" > /dev/null
DEL=$(curl -fsS -X DELETE "${H[@]}" "$API/references/$REF_ID")
node -e "const j=JSON.parse(process.argv[1]); if(!/Deactivated/.test(j.message)) process.exit(1)" "$DEL" || fail "expected soft-delete message, got: $DEL"
pass "soft-delete branch triggered while linked"

say "Detach + hard-delete branch"
curl -fsS -X PUT "${H[@]}" "$API/hospitals/$HOSP_ID" -d "{\"referenceId\":null}" > /dev/null
HARD=$(curl -fsS -X DELETE "${H[@]}" "$API/references/$REF_ID")
node -e "const j=JSON.parse(process.argv[1]); if(j.message!=='Deleted') process.exit(1)" "$HARD" || fail "expected hard-delete, got: $HARD"
pass "hard-delete branch triggered"

printf '\n\033[1;32m✅ smoke passed\033[0m\n'
