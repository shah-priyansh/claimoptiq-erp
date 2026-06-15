#!/usr/bin/env bash
# Account-entry smoke. Exits non-zero on any failure.
# Run from repo root: bash backend/scripts/smoke-account-entry.sh
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

# Track created IDs for trap cleanup
CREATED_IDS=""
cleanup() {
  for id in $CREATED_IDS; do
    curl -sS -X DELETE "${H[@]}" "$API/account-entries/$id" > /dev/null 2>&1 || true
  done
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
say "Reject general entry with zero amounts"
BAD=$(curl -sS -X POST "${H[@]}" "$API/account-entries" -d '{"date":"2026-06-10","entryType":"general","debit":0,"credit":0}')
node -e "if(!/at least one of/i.test(process.argv[1])) process.exit(1)" "$BAD" || fail "expected rejection, got: $BAD"
pass "general w/ zero amounts rejected"

# ---------------------------------------------------------------------------
say "Reject contra w/ same from/to"
BAD2=$(curl -sS -X POST "${H[@]}" "$API/account-entries" -d '{"date":"2026-06-10","entryType":"contra","fromMode":"cash","toMode":"cash","amount":500}')
node -e "if(!/must be different/.test(process.argv[1])) process.exit(1)" "$BAD2" || fail "expected rejection, got: $BAD2"
pass "contra w/ same from/to rejected"

# ---------------------------------------------------------------------------
say "Reject contra w/ invalid mode"
BAD3=$(curl -sS -X POST "${H[@]}" "$API/account-entries" -d '{"date":"2026-06-10","entryType":"contra","fromMode":"crypto","toMode":"bank","amount":500}')
node -e "if(!/must be one of/.test(process.argv[1])) process.exit(1)" "$BAD3" || fail "expected rejection, got: $BAD3"
pass "contra w/ invalid mode rejected"

# ---------------------------------------------------------------------------
say "Read baseline balances"
BAL0=$(curl -fsS "${H[@]}" "$API/cash-bank/balances")
CASH0=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).cash))" "$BAL0")
BANK0=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).bank))" "$BAL0")
pass "baseline cash=$CASH0 bank=$BANK0"

# ---------------------------------------------------------------------------
say "Create a general entry (no balance impact)"
GEN=$(curl -fsS -X POST "${H[@]}" "$API/account-entries" -d '{"date":"2026-06-10","entryType":"general","debit":1000,"credit":0,"remarks":"smoke general"}')
GEN_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$GEN")
CREATED_IDS="$CREATED_IDS $GEN_ID"

BAL1=$(curl -fsS "${H[@]}" "$API/cash-bank/balances")
CASH1=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).cash))" "$BAL1")
BANK1=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).bank))" "$BAL1")
[[ "$CASH1" == "$CASH0" ]] || fail "general entry should not change cash balance, was $CASH0 now $CASH1"
[[ "$BANK1" == "$BANK0" ]] || fail "general entry should not change bank balance, was $BANK0 now $BANK1"
pass "general entry created; balances unchanged"

# ---------------------------------------------------------------------------
say "Create a contra: bank -> cash 800"
CTR=$(curl -fsS -X POST "${H[@]}" "$API/account-entries" -d '{"date":"2026-06-11","entryType":"contra","fromMode":"bank","toMode":"cash","amount":800,"remarks":"smoke contra"}')
CTR_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$CTR")
CREATED_IDS="$CREATED_IDS $CTR_ID"

BAL2=$(curl -fsS "${H[@]}" "$API/cash-bank/balances")
CASH2=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).cash))" "$BAL2")
BANK2=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).bank))" "$BAL2")
EXPECTED_CASH=$((CASH0 + 800))
EXPECTED_BANK=$((BANK0 - 800))
[[ "$CASH2" == "$EXPECTED_CASH" ]] || fail "after contra: expected cash $EXPECTED_CASH, got $CASH2"
[[ "$BANK2" == "$EXPECTED_BANK" ]] || fail "after contra: expected bank $EXPECTED_BANK, got $BANK2"
pass "contra moved 800 bank->cash (cash $CASH0->$CASH2, bank $BANK0->$BANK2)"

# ---------------------------------------------------------------------------
say "Total balance unchanged by contra (zero-sum)"
TOTAL0=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).total))" "$BAL0")
TOTAL2=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).total))" "$BAL2")
[[ "$TOTAL0" == "$TOTAL2" ]] || fail "contra should be zero-sum on total, was $TOTAL0 now $TOTAL2"
pass "total unchanged ($TOTAL0)"

# ---------------------------------------------------------------------------
say "Delete the contra — balances revert"
curl -fsS -X DELETE "${H[@]}" "$API/account-entries/$CTR_ID" > /dev/null
CREATED_IDS=$(echo "$CREATED_IDS" | sed "s/$CTR_ID//")
BAL3=$(curl -fsS "${H[@]}" "$API/cash-bank/balances")
CASH3=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).cash))" "$BAL3")
BANK3=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).bank))" "$BAL3")
[[ "$CASH3" == "$CASH0" ]] || fail "after contra delete: cash expected $CASH0, got $CASH3"
[[ "$BANK3" == "$BANK0" ]] || fail "after contra delete: bank expected $BANK0, got $BANK3"
pass "contra reverted (cash $CASH3, bank $BANK3)"

# ---------------------------------------------------------------------------
say "List + filter by entryType"
LIST=$(curl -fsS "${H[@]}" "$API/account-entries?entryType=general&from=2026-06-01&to=2026-06-30")
HAS_GEN=$(node -e "const a=JSON.parse(process.argv[1]).entries; process.stdout.write(a.some(e=>e._id===process.argv[2])?'1':'0')" "$LIST" "$GEN_ID")
[[ "$HAS_GEN" == "1" ]] || fail "filtered list missing general entry"
pass "filtered list works"

# ---------------------------------------------------------------------------
say "Summary endpoint"
SUM=$(curl -fsS "${H[@]}" "$API/account-entries/summary?from=2026-06-01&to=2026-06-30")
GD=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).generalDebit))" "$SUM")
[[ "$GD" -ge 1000 ]] || fail "summary generalDebit should include 1000, got $GD"
pass "summary OK (generalDebit ≥ 1000)"

printf '\n\033[1;32m✅ smoke passed\033[0m\n'
