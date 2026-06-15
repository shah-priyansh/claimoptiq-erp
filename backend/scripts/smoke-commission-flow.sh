#!/usr/bin/env bash
# Phase 2.5 — Reference Commission Auto Flow smoke.
# Asserts: issue → matched line items create expense rows; unmatched are skipped;
# void wipes them; second issue is idempotent; hospital w/o reference is a no-op.
# Run from repo root: bash backend/scripts/smoke-commission-flow.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m[OK] %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
say "Setup: 2 billing-service-names, reference with 1 of them applicable, hospital w/ ref + 2 claims"
SETUP=$(node -e '
const p = require("./config/prisma");
(async () => {
  // Two billing-service-name catalog rows
  const svcMatched = await p.billingServiceName.create({ data: { name: "SMOKE TPA-MATCHED " + Date.now() } });
  const svcUnmatched = await p.billingServiceName.create({ data: { name: "SMOKE TPA-UNMATCHED " + Date.now() } });

  // Reference at 10% with only the matched service in its applicable list
  const ref = await p.reference.create({
    data: {
      name: "SMOKE Ref " + Date.now(),
      commissionRate: 10,
      applicableServices: { create: [{ billingServiceNameId: svcMatched.id }] },
    },
  });

  // Hospital wired to that reference, with the MATCHED service as its TPA Desk slab service
  const hospital = await p.hospital.create({
    data: {
      name: "SMOKE COMM HOSP " + Date.now(),
      referenceId: ref.id,
      gstRate: 0, tdsRate: 0, invoicePrefix: "FCC",
      billingServices: { create: [{
        serviceName: svcMatched.name,
        billingType: "per_claim_slab",
        calculationBasis: "final_approval",
        slabMode: "slab_wise",
        slabs: { create: [{ rangeStart: 0, rangeEnd: 0, price: 1500, order: 0 }] },
      }]},
    },
  });

  // Two settled discharged claims in June 2026
  const status = await p.claimStatus.findFirst({ where: { slug: "settled" } });
  const ic = await p.insuranceCompany.findFirst();
  const mkClaim = (n) => p.claim.create({ data: {
    hospitalId: hospital.id, patientName: "COMM Patient " + n, claimType: "cashless", ccnNo: "CCM" + n,
    insuranceCompanyId: ic ? ic.id : null,
    month: new Date(Date.UTC(2026, 5, 1)),
    dateOfAdmit: new Date(Date.UTC(2026, 5, 5 + n)), dateOfDischarge: new Date(Date.UTC(2026, 5, 8 + n)),
    status: status.slug, hospitalFinalBill: 30000, finalApprovalAmount: 25000, isBilled: false,
  }});
  const c1 = await mkClaim(1);
  const c2 = await mkClaim(2);

  console.log(JSON.stringify({
    hospitalId: hospital.id, refId: ref.id,
    svcMatchedId: svcMatched.id, svcUnmatchedId: svcUnmatched.id,
    claims: [c1.id, c2.id],
  }));
})().finally(() => p.$disconnect());
' 2>/dev/null | tail -1)

HOSP_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).hospitalId)" "$SETUP")
REF_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).refId)" "$SETUP")
SVC_MATCHED_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).svcMatchedId)" "$SETUP")
SVC_UNMATCHED_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).svcUnmatchedId)" "$SETUP")
[[ -n "$HOSP_ID" ]] || fail "fixture failed"

cleanup() {
  node -e '
const p = require("./config/prisma");
(async () => {
  const hospitalId = process.argv[1];
  const refId = process.argv[2];
  const svc1 = process.argv[3], svc2 = process.argv[4];
  // wipe expenses created by the engine
  await p.expense.deleteMany({ where: { sourceType: "invoice_commission", sourceId: { in: (await p.invoice.findMany({ where: { hospitalId }, select: { id: true }})).map(i=>i.id) } } });
  await p.cashBankEntry.deleteMany({ where: { hospitalId } });
  const inv = await p.invoice.findMany({ where: { hospitalId } });
  for (const i of inv) await p.invoice.delete({ where: { id: i.id } });
  await p.claim.deleteMany({ where: { hospitalId } });
  await p.hospitalBillingServiceSlab.deleteMany({ where: { billingService: { hospitalId } } });
  await p.hospitalBillingService.deleteMany({ where: { hospitalId } });
  await p.hospital.delete({ where: { id: hospitalId } });
  await p.referenceApplicableService.deleteMany({ where: { referenceId: refId } });
  await p.reference.delete({ where: { id: refId } });
  await p.billingServiceName.delete({ where: { id: svc1 } });
  await p.billingServiceName.delete({ where: { id: svc2 } });
})().finally(() => p.$disconnect());
  ' "$HOSP_ID" "$REF_ID" "$SVC_MATCHED_ID" "$SVC_UNMATCHED_ID" 2>/dev/null || true
}
trap cleanup EXIT
pass "fixture: hospital=$HOSP_ID ref=$REF_ID 10%"

# ---------------------------------------------------------------------------
say "Login"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

# ---------------------------------------------------------------------------
say "Create + issue invoice"
DRAFT=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-06-01\"}")
INV_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$DRAFT")
ISSUED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/issue")
INV_NUM=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).invoiceNumber)" "$ISSUED")
ROWS=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionAutoFlow.rowsCreated))" "$ISSUED")
AMT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionAutoFlow.totalAmount))" "$ISSUED")
# Expected: 2 TPA Desk lines x ₹1500 each, 10% commission = ₹150 each = 2 rows / ₹300 total
[[ "$ROWS" == "2" ]] || fail "expected 2 commission rows, got $ROWS"
[[ "$AMT" == "300" ]] || fail "expected total commission ₹300, got ₹$AMT"
pass "issued $INV_NUM with $ROWS commission rows totalling ₹$AMT"

# ---------------------------------------------------------------------------
say "Verify the expense rows are actually in the DB w/ correct attrs"
DB=$(node -e '
const p = require("./config/prisma");
p.expense.findMany({ where: { sourceType: "invoice_commission", sourceId: process.argv[1] }, include: { category: true, reference: true } })
  .then(rows => console.log(JSON.stringify({
    count: rows.length,
    total: rows.reduce((a,r)=>a+r.amount,0),
    allRefCommissionCat: rows.every(r => r.category.slug === "reference_commission"),
    allLinkedToRef: rows.every(r => r.referenceId === process.argv[2]),
  })))
  .finally(() => p.$disconnect());
' "$INV_ID" "$REF_ID" 2>/dev/null | tail -1)
CNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).count))" "$DB")
TOT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).total))" "$DB")
[[ "$CNT" == "2" ]] || fail "DB: expected 2 rows, got $CNT"
[[ "$TOT" == "300" ]] || fail "DB: expected ₹300, got ₹$TOT"
ALL_CAT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).allRefCommissionCat))" "$DB")
ALL_REF=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).allLinkedToRef))" "$DB")
[[ "$ALL_CAT" == "true" ]] || fail "DB: rows not all in reference_commission category"
[[ "$ALL_REF" == "true" ]] || fail "DB: rows not all linked to the reference"
pass "DB rows verified (count=$CNT total=$TOT category=reference_commission ref linked)"

# ---------------------------------------------------------------------------
say "Auto rows are blocked from edit/delete via the standard expenses endpoint"
EXPS=$(curl -fsS "${H[@]}" "$API/expenses?categoryId=$(node -e '
const p = require("./config/prisma");
p.expenseCategory.findUnique({ where: { slug: "reference_commission" } }).then(c => process.stdout.write(c.id)).finally(() => p.$disconnect());
' 2>/dev/null | tail -1)&referenceId=$REF_ID")
SAMPLE=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).expenses[0]._id)" "$EXPS")
BLOCKED=$(curl -sS -X PATCH "${H[@]}" "$API/expenses/$SAMPLE" -d '{"amount":1}')
node -e "if(!/Auto-generated/.test(process.argv[1])) process.exit(1)" "$BLOCKED" || fail "auto-row edit should be blocked, got: $BLOCKED"
pass "auto-row protection holds"

# ---------------------------------------------------------------------------
say "Void the invoice → commission rows wiped"
VOIDED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$INV_ID/void" -d '{"reason":"commission-flow smoke"}')
REMOVED=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionAutoFlow.rowsRemoved))" "$VOIDED")
[[ "$REMOVED" == "2" ]] || fail "void should remove 2 commission rows, got $REMOVED"

LEFT=$(node -e '
const p = require("./config/prisma");
p.expense.count({ where: { sourceType: "invoice_commission", sourceId: process.argv[1] } }).then(c => process.stdout.write(String(c))).finally(() => p.$disconnect());
' "$INV_ID" 2>/dev/null | tail -1)
[[ "$LEFT" == "0" ]] || fail "after void: expected 0 rows, got $LEFT"
pass "void wiped commission rows (removed=$REMOVED, remaining=0)"

# ---------------------------------------------------------------------------
say "No-reference hospital: engine no-ops"
NOREF=$(node -e '
const p = require("./config/prisma");
(async () => {
  const h = await p.hospital.create({ data: {
    name: "SMOKE NOREF HOSP " + Date.now(), gstRate: 0, tdsRate: 0, invoicePrefix: "FCC",
    billingServices: { create: [{
      serviceName: "TPA Desk", billingType: "per_claim_slab",
      calculationBasis: "final_approval", slabMode: "slab_wise",
      slabs: { create: [{ rangeStart: 0, rangeEnd: 0, price: 800, order: 0 }] },
    }]},
  }});
  const st = await p.claimStatus.findFirst({ where: { slug: "settled" } });
  const ic = await p.insuranceCompany.findFirst();
  await p.claim.create({ data: {
    hospitalId: h.id, patientName: "NOREF Patient", claimType: "cashless", ccnNo: "NRF1",
    insuranceCompanyId: ic ? ic.id : null,
    month: new Date(Date.UTC(2026, 5, 1)),
    dateOfAdmit: new Date(Date.UTC(2026, 5, 8)), dateOfDischarge: new Date(Date.UTC(2026, 5, 10)),
    status: st.slug, hospitalFinalBill: 20000, finalApprovalAmount: 18000, isBilled: false,
  }});
  console.log(h.id);
})().finally(() => p.$disconnect());
' 2>/dev/null | tail -1)

NOREF_DRAFT=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$NOREF\",\"month\":\"2026-06-01\"}")
NOREF_INV=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$NOREF_DRAFT")
NOREF_ISSUED=$(curl -fsS -X POST "${H[@]}" "$API/invoices/$NOREF_INV/issue")
NR_SKIPPED=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionAutoFlow.skipped))" "$NOREF_ISSUED")
NR_REASON=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).commissionAutoFlow.reason || \"\")" "$NOREF_ISSUED")
[[ "$NR_SKIPPED" == "true" ]] || fail "expected skipped=true on no-ref hospital, got $NR_SKIPPED"
[[ "$NR_REASON" == "no reference" ]] || fail "expected reason 'no reference', got: $NR_REASON"
pass "no-reference hospital no-ops (skipped=true reason='$NR_REASON')"

# Cleanup the second hospital
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
' "$NOREF" 2>/dev/null > /dev/null

printf '\n\033[1;32mSMOKE PASSED\033[0m\n'
