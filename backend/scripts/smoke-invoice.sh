#!/usr/bin/env bash
# Invoice smoke test. Exits non-zero on any failure.
# Run from repo root: bash backend/scripts/smoke-invoice.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
say "Setup test fixtures (hospital + claims) via Prisma"
SETUP=$(node -e '
const p = require("./config/prisma");
(async () => {
  const month = new Date(Date.UTC(2026, 5, 1)); // 2026-06
  const hospital = await p.hospital.create({
    data: {
      name: "SMOKE INVOICE HOSP " + Date.now(),
      gstRate: 18, tdsRate: 10, invoicePrefix: "FCC",
      billingServices: {
        create: [
          {
            serviceName: "TPA Desk",
            billingType: "per_claim_slab",
            calculationBasis: "final_approval",
            slabMode: "slab_wise",
            slabs: { create: [
              { rangeStart: 0, rangeEnd: 50000, price: 1000, order: 0 },
              { rangeStart: 50001, rangeEnd: 100000, price: 1500, order: 1 },
              { rangeStart: 100001, rangeEnd: 0, price: 2000, order: 2 },
            ]},
          },
          {
            serviceName: "NABH",
            billingType: "fixed_monthly",
            fixedAmount: 5000,
          },
        ],
      },
    },
  });
  // Find a status slug not in excluded list - prefer "settled"
  const status = await p.claimStatus.findFirst({ where: { slug: { not: { in: ["rejected","cancelled"] } } } });
  const dischargeDate = new Date(Date.UTC(2026, 5, 10));
  const ic = await p.insuranceCompany.findFirst();
  const c1 = await p.claim.create({
    data: {
      hospitalId: hospital.id,
      patientName: "SMOKE Patient A",
      claimType: "cashless",
      ccnNo: "SMK001",
      insuranceCompanyId: ic ? ic.id : null,
      month: month,
      dateOfAdmit: new Date(Date.UTC(2026, 5, 8)),
      dateOfDischarge: dischargeDate,
      status: status.slug,
      hospitalFinalBill: 45000,
      finalApprovalAmount: 40000,
      isBilled: false,
    },
  });
  const c2 = await p.claim.create({
    data: {
      hospitalId: hospital.id,
      patientName: "SMOKE Patient B",
      claimType: "cashless",
      ccnNo: "SMK002",
      insuranceCompanyId: ic ? ic.id : null,
      month: month,
      dateOfAdmit: new Date(Date.UTC(2026, 5, 12)),
      dateOfDischarge: new Date(Date.UTC(2026, 5, 14)),
      status: status.slug,
      hospitalFinalBill: 80000,
      finalApprovalAmount: 75000,
      isBilled: false,
    },
  });
  console.log(JSON.stringify({ hospitalId: hospital.id, claimIds: [c1.id, c2.id] }));
})().finally(() => p.$disconnect());
' 2>/dev/null | tail -1)

HOSP_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).hospitalId)" "$SETUP")
CLAIM_IDS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).claimIds.join(','))" "$SETUP")
[[ -n "$HOSP_ID" ]] || fail "fixture setup failed: $SETUP"
pass "hospital $HOSP_ID with 2 claims"

CLEANUP() {
  node -e '
const p = require("./config/prisma");
(async () => {
  const hospitalId = process.argv[1];
  const invoices = await p.invoice.findMany({ where: { hospitalId }, select: { id: true } });
  for (const i of invoices) await p.invoice.delete({ where: { id: i.id } });
  await p.claim.deleteMany({ where: { hospitalId } });
  await p.hospitalBillingServiceSlab.deleteMany({ where: { billingService: { hospitalId } } });
  await p.hospitalBillingService.deleteMany({ where: { hospitalId } });
  await p.hospital.delete({ where: { id: hospitalId } });
})().finally(() => p.$disconnect());
  ' "$HOSP_ID" 2>/dev/null || true
}
trap CLEANUP EXIT

# ---------------------------------------------------------------------------
say "Login"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

# ---------------------------------------------------------------------------
say "Preview invoice for 2026-06"
PREVIEW=$(curl -fsS -X POST "${H[@]}" "$API/invoices/preview" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-06-01\"}")
LINE_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).lines.length))" "$PREVIEW")
GROSS=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.gross))" "$PREVIEW")
# Expect: 2 TPA-desk lines + 1 fixed_monthly = 3 lines.
[[ "$LINE_COUNT" == "3" ]] || fail "expected 3 lines, got $LINE_COUNT: $PREVIEW"
[[ "$GROSS" != "0" ]] || fail "expected gross > 0, got $GROSS"
pass "preview: 3 lines, gross=$GROSS"

# ---------------------------------------------------------------------------
say "Create draft"
CREATED=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-06-01\",\"notes\":\"smoke test\"}")
INV_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id||'')" "$CREATED")
STATUS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$CREATED")
[[ -n "$INV_ID" ]] || fail "create returned no id: $CREATED"
[[ "$STATUS" == "draft" ]] || fail "expected draft, got $STATUS"
pass "draft $INV_ID created"

# ---------------------------------------------------------------------------
say "PATCH adjustments"
PATCHED=$(curl -fsS -X PATCH "${H[@]}" "$API/invoices/$INV_ID" -d '{"adjustments":[{"description":"Goodwill discount","amount":-200}]}')
ADJUST_SUM=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).subtotalAdjust))" "$PATCHED")
[[ "$ADJUST_SUM" == "-200" ]] || fail "expected adjust -200, got $ADJUST_SUM"
pass "adjustments applied (subtotalAdjust=-200)"

# ---------------------------------------------------------------------------
say "Issue invoice"
ISSUED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/issue")
INV_NUM=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).invoiceNumber||'')" "$ISSUED")
ISSUED_STATUS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$ISSUED")
[[ "$ISSUED_STATUS" == "issued" ]] || fail "expected issued, got $ISSUED_STATUS"
[[ "$INV_NUM" =~ ^FCC/[0-9]{4}-[0-9]{2}/[0-9]{4}$ ]] || fail "invoiceNumber format wrong: '$INV_NUM'"
pass "issued as $INV_NUM"

# ---------------------------------------------------------------------------
say "Verify linked claims isBilled=true"
BILLED=$(node -e '
const p = require("./config/prisma");
p.claim.count({ where: { id: { in: process.argv[1].split(",") }, isBilled: true } }).then(n => { process.stdout.write(String(n)); }).finally(() => p.$disconnect());
' "$CLAIM_IDS" 2>/dev/null | tail -1)
[[ "$BILLED" == "2" ]] || fail "expected 2 isBilled=true claims, got $BILLED"
pass "both claims flagged isBilled"

# ---------------------------------------------------------------------------
say "Download PDF"
PDF_SIZE=$(curl -fsS "${H[@]}" "$API/invoices/$INV_ID/pdf" -o /tmp/smoke-invoice.pdf -w '%{size_download}')
[[ "$PDF_SIZE" -gt 1000 ]] || fail "PDF too small: $PDF_SIZE bytes"
pass "PDF generated ($PDF_SIZE bytes)"

# ---------------------------------------------------------------------------
say "Void invoice"
VOIDED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/void" -d '{"reason":"smoke test"}')
VS=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).status)" "$VOIDED")
[[ "$VS" == "void" ]] || fail "expected void, got $VS"
pass "voided"

# Verify isBilled reset
UNBILLED=$(node -e '
const p = require("./config/prisma");
p.claim.count({ where: { id: { in: process.argv[1].split(",") }, isBilled: false } }).then(n => { process.stdout.write(String(n)); }).finally(() => p.$disconnect());
' "$CLAIM_IDS" 2>/dev/null | tail -1)
[[ "$UNBILLED" == "2" ]] || fail "expected 2 isBilled=false claims after void, got $UNBILLED"
pass "claims isBilled reset after void"

# ---------------------------------------------------------------------------
say "List filter status=void includes our invoice"
LIST=$(curl -fsS "${H[@]}" "$API/invoices?status=void&hospitalId=$HOSP_ID")
FOUND=$(node -e "const a=JSON.parse(process.argv[1]).invoices; process.stdout.write(a.some(i=>i._id===process.argv[2])?'1':'0')" "$LIST" "$INV_ID")
[[ "$FOUND" == "1" ]] || fail "void invoice not in list"
pass "list filter works"

rm -f /tmp/smoke-invoice.pdf
printf '\n\033[1;32m✅ smoke passed\033[0m\n'
