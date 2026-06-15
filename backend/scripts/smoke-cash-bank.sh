#!/usr/bin/env bash
# Cash/Bank smoke — creates a hospital + claim, issues invoice, records partials, asserts rollups.
# Exits non-zero on any failure.
# Run from repo root: bash backend/scripts/smoke-cash-bank.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
say "Setup invoice fixture (hospital + claim + issued invoice)"
SETUP=$(node -e '
const p = require("./config/prisma");
(async () => {
  const month = new Date(Date.UTC(2026, 5, 1));
  const hospital = await p.hospital.create({
    data: {
      name: "SMOKE CASHBANK HOSP " + Date.now(),
      gstRate: 0, tdsRate: 0, invoicePrefix: "FCC",
      billingServices: { create: [
        {
          serviceName: "TPA Desk", billingType: "per_claim_slab",
          calculationBasis: "final_approval", slabMode: "slab_wise",
          slabs: { create: [{ rangeStart: 0, rangeEnd: 0, price: 1000, order: 0 }] },
        },
      ]},
    },
  });
  const status = await p.claimStatus.findFirst({ where: { slug: "settled" } });
  const ic = await p.insuranceCompany.findFirst();
  const c = await p.claim.create({
    data: {
      hospitalId: hospital.id, patientName: "SMOKE Patient",
      claimType: "cashless", ccnNo: "SMK-CB-1",
      insuranceCompanyId: ic ? ic.id : null,
      month, dateOfAdmit: new Date(Date.UTC(2026, 5, 8)),
      dateOfDischarge: new Date(Date.UTC(2026, 5, 10)),
      status: status.slug, hospitalFinalBill: 30000, finalApprovalAmount: 25000, isBilled: false,
    },
  });
  console.log(JSON.stringify({ hospitalId: hospital.id, claimId: c.id }));
})().finally(() => p.$disconnect());
' 2>/dev/null | tail -1)

HOSP_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).hospitalId)" "$SETUP")
CLAIM_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).claimId)" "$SETUP")
[[ -n "$HOSP_ID" ]] || fail "fixture failed"

CLEANUP() {
  node -e '
const p = require("./config/prisma");
(async () => {
  const hospitalId = process.argv[1];
  await p.cashBankEntry.deleteMany({ where: { hospitalId } });
  const inv = await p.invoice.findMany({ where: { hospitalId } });
  for (const i of inv) await p.invoice.delete({ where: { id: i.id } });
  await p.claim.deleteMany({ where: { hospitalId } });
  await p.hospitalBillingServiceSlab.deleteMany({ where: { billingService: { hospitalId } } });
  await p.hospitalBillingService.deleteMany({ where: { hospitalId } });
  await p.hospital.delete({ where: { id: hospitalId } });
})().finally(() => p.$disconnect());
  ' "$HOSP_ID" 2>/dev/null || true
}
trap CLEANUP EXIT

pass "fixture: hospital $HOSP_ID, claim $CLAIM_ID"

# ---------------------------------------------------------------------------
say "Login + issue invoice"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

DRAFT=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-06-01\"}")
INV_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$DRAFT")
ISSUED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/issue")
INV_TOTAL=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).grandTotal))" "$ISSUED")
pass "invoice $INV_ID grandTotal=$INV_TOTAL"

# ---------------------------------------------------------------------------
say "Reject linking both invoiceId and expenseId"
BAD=$(curl -sS -X POST "${H[@]}" "$API/cash-bank" -d "{\"date\":\"2026-06-15\",\"direction\":\"in\",\"mode\":\"cash\",\"amount\":100,\"invoiceId\":\"$INV_ID\",\"expenseId\":\"00000000-0000-0000-0000-000000000000\"}")
node -e "if(!/at most one/.test(process.argv[1])) process.exit(1)" "$BAD" || fail "expected at-most-one rejection, got: $BAD"
pass "at-most-one guard enforced"

# ---------------------------------------------------------------------------
say "Reject negative amount"
NEG=$(curl -sS -X POST "${H[@]}" "$API/cash-bank" -d "{\"date\":\"2026-06-15\",\"direction\":\"in\",\"mode\":\"cash\",\"amount\":-50}")
node -e "if(!/positive/.test(process.argv[1])) process.exit(1)" "$NEG" || fail "expected negative-amount rejection, got: $NEG"
pass "negative-amount rejected"

# ---------------------------------------------------------------------------
say "Record partial payment 1 via convenience endpoint"
P1=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/payments" -d "{\"date\":\"2026-06-15\",\"mode\":\"bank\",\"amount\":400,\"utrNumber\":\"UTR123\"}")
P1_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$P1")
INV_AFTER=$(curl -fsS "${H[@]}" "$API/invoices/$INV_ID")
STATUS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$INV_AFTER")
PAID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).amountPaid))" "$INV_AFTER")
[[ "$STATUS" == "partially_paid" ]] || fail "expected partially_paid after 400/1000, got $STATUS"
[[ "$PAID" == "400" ]] || fail "expected amountPaid=400, got $PAID"
pass "partial 1 → partially_paid (paid=$PAID)"

# ---------------------------------------------------------------------------
say "Record partial payment 2 (rest)"
REMAINDER=$((INV_TOTAL - 400))
P2=$(curl -fsS -X POST "${H[@]}" "$API/cash-bank" -d "{\"date\":\"2026-06-20\",\"direction\":\"in\",\"mode\":\"upi\",\"amount\":$REMAINDER,\"invoiceId\":\"$INV_ID\"}")
INV_AFTER=$(curl -fsS "${H[@]}" "$API/invoices/$INV_ID")
STATUS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$INV_AFTER")
PENDING=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).amountPending))" "$INV_AFTER")
[[ "$STATUS" == "paid" ]] || fail "expected paid after full, got $STATUS"
[[ "$PENDING" == "0" ]] || fail "expected pending=0, got $PENDING"
pass "fully paid (pending=0)"

# ---------------------------------------------------------------------------
say "Delete partial 1 — invoice rolls back to partially_paid"
curl -fsS -X DELETE "${H[@]}" "$API/cash-bank/$P1_ID" > /dev/null
INV_AFTER=$(curl -fsS "${H[@]}" "$API/invoices/$INV_ID")
STATUS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$INV_AFTER")
PAID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).amountPaid))" "$INV_AFTER")
[[ "$STATUS" == "partially_paid" ]] || fail "expected rollback to partially_paid, got $STATUS"
[[ "$PAID" == "$REMAINDER" ]] || fail "expected paid=$REMAINDER after delete, got $PAID"
pass "rollback to partially_paid (paid=$PAID)"

# ---------------------------------------------------------------------------
say "Balances endpoint"
BAL=$(curl -fsS "${H[@]}" "$API/cash-bank/balances")
TOTAL=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).total))" "$BAL")
[[ "$TOTAL" =~ ^-?[0-9]+$ ]] || fail "balances total non-numeric: $BAL"
pass "balances endpoint OK (total=$TOTAL)"

# ---------------------------------------------------------------------------
say "Summary endpoint with date range"
SUM=$(curl -fsS "${H[@]}" "$API/cash-bank/summary?from=2026-06-01&to=2026-06-30")
NET=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).net))" "$SUM")
[[ "$NET" =~ ^-?[0-9]+$ ]] || fail "summary net non-numeric: $SUM"
pass "summary endpoint OK (june net=$NET)"

# ---------------------------------------------------------------------------
say "Reject payment on draft / void invoice"
DRAFT2=$(curl -sS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-07-01\"}")
DRAFT_RESP=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).message||\"no message\")" "$DRAFT2" 2>/dev/null || echo "")
# If creating fails because no new claims in July, that's fine. If it succeeds, try to pay it as a draft.
DRAFT2_ID=$(node -e "const o=JSON.parse(process.argv[1]); process.stdout.write(o._id||\"\")" "$DRAFT2" 2>/dev/null || echo "")
if [[ -n "$DRAFT2_ID" ]]; then
  BAD2=$(curl -sS -X POST "${H[@]}" "$API/cash-bank" -d "{\"date\":\"2026-07-15\",\"direction\":\"in\",\"mode\":\"cash\",\"amount\":100,\"invoiceId\":\"$DRAFT2_ID\"}")
  node -e "if(!/draft/.test(process.argv[1])) process.exit(1)" "$BAD2" || fail "expected draft rejection, got: $BAD2"
  pass "draft-invoice payment blocked"
else
  pass "skipped — no draft invoice could be created (no Jul claims)"
fi

printf '\n\033[1;32m✅ smoke passed\033[0m\n'
