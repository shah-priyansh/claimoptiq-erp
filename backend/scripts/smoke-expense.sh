#!/usr/bin/env bash
# Expense module smoke. Exits non-zero on any failure.
# Run from repo root: bash backend/scripts/smoke-expense.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
say "Login"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

# ---------------------------------------------------------------------------
say "List system categories"
CATS=$(curl -fsS "${H[@]}" "$API/expense-categories")
SYS=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).filter(c=>c.isSystem).length))" "$CATS")
[[ "$SYS" == "4" ]] || fail "expected 4 system categories, got $SYS"
SALARY_ID=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write(a.find(c=>c.slug==='salary')._id)" "$CATS")
COMM_ID=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write(a.find(c=>c.slug==='reference_commission')._id)" "$CATS")
OFFICE_ID=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write(a.find(c=>c.slug==='office')._id)" "$CATS")
TRAVEL_ID=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write(a.find(c=>c.slug==='travel')._id)" "$CATS")
pass "categories: salary=$SALARY_ID, comm=$COMM_ID, office=$OFFICE_ID, travel=$TRAVEL_ID"

# ---------------------------------------------------------------------------
say "Reject deleting a system category"
RESP=$(curl -sS -X DELETE "${H[@]}" "$API/expense-categories/$SALARY_ID")
CODE=$(node -e "process.stdout.write(/System categories cannot be deleted/.test(process.argv[1])?'1':'0')" "$RESP")
[[ "$CODE" == "1" ]] || fail "expected system delete to be blocked, got: $RESP"
pass "system delete blocked"

# ---------------------------------------------------------------------------
say "Create one expense per category"
mk() {
  local CID="$1" AMT="$2" NOTE="$3"
  curl -fsS -X POST "${H[@]}" "$API/expenses" -d "{\"date\":\"2026-06-10\",\"categoryId\":\"$CID\",\"amount\":$AMT,\"notes\":\"$NOTE\"}"
}
E1=$(mk "$SALARY_ID" 25000 "smoke salary")
E2=$(mk "$COMM_ID"   3000  "smoke commission manual")
E3=$(mk "$OFFICE_ID" 1500  "smoke office stationery")
E4=$(mk "$TRAVEL_ID" 800   "smoke travel cab")
E1_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$E1")
E2_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$E2")
[[ -n "$E1_ID" && -n "$E2_ID" ]] || fail "create failed: $E1 | $E2"
pass "4 expenses created"

cleanup() {
  for ID in "$E1_ID" "$E2_ID" "$E3_ID_VAR" "$E4_ID_VAR"; do
    [[ -n "${ID:-}" ]] && curl -sS -X DELETE "${H[@]}" "$API/expenses/$ID" > /dev/null || true
  done
}
E3_ID_VAR=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$E3")
E4_ID_VAR=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$E4")
trap cleanup EXIT

# ---------------------------------------------------------------------------
say "List filter by category"
COMM_LIST=$(curl -fsS "${H[@]}" "$API/expenses?categoryId=$COMM_ID&from=2026-06-01&to=2026-06-30")
COUNT=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write(String(a.expenses.filter(e=>e._id===process.argv[2]).length))" "$COMM_LIST" "$E2_ID")
[[ "$COUNT" == "1" ]] || fail "filter missed the commission expense"
pass "filtered list works"

# ---------------------------------------------------------------------------
say "Update expense (notes + amount)"
UPDATED=$(curl -fsS -X PATCH "${H[@]}" "$API/expenses/$E1_ID" -d '{"amount":26000,"notes":"smoke salary revised"}')
AMT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).amount))" "$UPDATED")
[[ "$AMT" == "26000" ]] || fail "update did not stick, got amount=$AMT"
pass "update applied"

# ---------------------------------------------------------------------------
say "Auto-row protection — simulate via DB"
AUTO_ID=$(node -e '
const p = require("./config/prisma");
p.expense.create({
  data: {
    date: new Date(), categoryId: process.argv[1], amount: 500,
    notes: "smoke auto", sourceType: "invoice_commission", sourceId: "smoke-inv", sourceLineId: "smoke-line-" + Date.now(),
  },
}).then(e => process.stdout.write(e.id)).finally(() => p.$disconnect());
' "$COMM_ID" 2>/dev/null | tail -1)
[[ -n "$AUTO_ID" ]] || fail "could not create auto-row fixture"

UPD_AUTO=$(curl -sS -X PATCH "${H[@]}" "$API/expenses/$AUTO_ID" -d '{"amount":1}')
BLOCKED=$(node -e "process.stdout.write(/Auto-generated/.test(process.argv[1])?'1':'0')" "$UPD_AUTO")
[[ "$BLOCKED" == "1" ]] || fail "auto-row edit should be blocked, got: $UPD_AUTO"
DEL_AUTO=$(curl -sS -X DELETE "${H[@]}" "$API/expenses/$AUTO_ID")
BLOCKED2=$(node -e "process.stdout.write(/Auto-generated/.test(process.argv[1])?'1':'0')" "$DEL_AUTO")
[[ "$BLOCKED2" == "1" ]] || fail "auto-row delete should be blocked, got: $DEL_AUTO"
pass "auto-row edit + delete blocked"

# Cleanup the auto-row via DB
node -e '
const p = require("./config/prisma");
p.expense.delete({ where: { id: process.argv[1] } }).finally(() => p.$disconnect());
' "$AUTO_ID" 2>/dev/null > /dev/null

# ---------------------------------------------------------------------------
say "Summary endpoint groups by category"
SUM=$(curl -fsS "${H[@]}" "$API/expenses/summary?from=2026-06-01&to=2026-06-30")
SALARY_TOTAL=$(node -e "const r=JSON.parse(process.argv[1]).rows; process.stdout.write(String(r.find(x=>x.slug==='salary').amount))" "$SUM")
[[ "$SALARY_TOTAL" == "26000" ]] || fail "summary salary expected 26000, got $SALARY_TOTAL"
GRAND=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).grandTotal))" "$SUM")
[[ "$GRAND" == "31300" ]] || fail "summary grand total expected 31300, got $GRAND"
pass "summary OK (salary 26000 / grand 31300)"

# ---------------------------------------------------------------------------
say "Add a custom (non-system) category, rename, then delete"
CUSTOM=$(curl -fsS -X POST "${H[@]}" "$API/expense-categories" -d '{"label":"Bank Charges"}')
CUSTOM_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$CUSTOM")
[[ -n "$CUSTOM_ID" ]] || fail "create custom category failed: $CUSTOM"
RENAMED=$(curl -fsS -X PATCH "${H[@]}" "$API/expense-categories/$CUSTOM_ID" -d '{"label":"Bank Charges & Fees"}')
NEWLABEL=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).label)" "$RENAMED")
[[ "$NEWLABEL" == "Bank Charges & Fees" ]] || fail "rename failed: $RENAMED"
DEL=$(curl -fsS -X DELETE "${H[@]}" "$API/expense-categories/$CUSTOM_ID")
node -e "const j=JSON.parse(process.argv[1]); if(j.message!=='Deleted') process.exit(1)" "$DEL" || fail "custom delete failed: $DEL"
pass "custom category CRUD ok"

printf '\n\033[1;32m✅ smoke passed\033[0m\n'
