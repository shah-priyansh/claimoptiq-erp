#!/usr/bin/env bash
# Phase 2.6 — Reports smoke. Seeds a hospital + reference + 2 months of invoices + expenses,
# then asserts each report returns the expected totals.
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Test@123}"

say() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m[FAIL] %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m[OK] %s\033[0m\n' "$*"; }

cd "$(dirname "$0")/.."

say "Setup fixtures: hospital + reference + 2 issued invoices + 2 expense rows in May/June"
SETUP=$(node -e '
const p = require("./config/prisma");
(async () => {
  const svc = await p.billingServiceName.create({ data: { name: "SMK RPT SVC " + Date.now() } });
  const ref = await p.reference.create({ data: {
    name: "SMK RPT Ref " + Date.now(), commissionRate: 10,
    applicableServices: { create: [{ billingServiceNameId: svc.id }] },
  }});
  const hospital = await p.hospital.create({ data: {
    name: "SMK RPT HOSP " + Date.now(), referenceId: ref.id,
    gstRate: 0, tdsRate: 0, invoicePrefix: "FCC",
    billingServices: { create: [{
      serviceName: svc.name, billingType: "per_claim_slab",
      calculationBasis: "final_approval", slabMode: "slab_wise",
      slabs: { create: [{ rangeStart: 0, rangeEnd: 0, price: 1000, order: 0 }] },
    }]},
  }});

  const status = await p.claimStatus.findFirst({ where: { slug: "settled" } });
  const ic = await p.insuranceCompany.findFirst();

  // May claim + June claim (UTC months 4 and 5)
  const may = new Date(Date.UTC(2026, 4, 1));
  const jun = new Date(Date.UTC(2026, 5, 1));
  await p.claim.create({ data: {
    hospitalId: hospital.id, patientName: "SMK May Patient", claimType: "cashless", ccnNo: "RPT-MAY",
    insuranceCompanyId: ic ? ic.id : null,
    month: may, dateOfAdmit: new Date(Date.UTC(2026, 4, 10)), dateOfDischarge: new Date(Date.UTC(2026, 4, 12)),
    status: status.slug, hospitalFinalBill: 30000, finalApprovalAmount: 25000, isBilled: false,
  }});
  await p.claim.create({ data: {
    hospitalId: hospital.id, patientName: "SMK Jun Patient", claimType: "cashless", ccnNo: "RPT-JUN",
    insuranceCompanyId: ic ? ic.id : null,
    month: jun, dateOfAdmit: new Date(Date.UTC(2026, 5, 10)), dateOfDischarge: new Date(Date.UTC(2026, 5, 12)),
    status: status.slug, hospitalFinalBill: 30000, finalApprovalAmount: 25000, isBilled: false,
  }});

  console.log(JSON.stringify({ hospitalId: hospital.id, refId: ref.id, svcId: svc.id }));
})().finally(() => p.$disconnect());
' 2>/dev/null | tail -1)

HOSP_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).hospitalId)" "$SETUP")
REF_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).refId)" "$SETUP")
SVC_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).svcId)" "$SETUP")

cleanup() {
  node -e '
const p = require("./config/prisma");
(async () => {
  const hospitalId = process.argv[1], refId = process.argv[2], svcId = process.argv[3];
  // Manual office expense the smoke creates is identified by its notes string.
  await p.expense.deleteMany({ where: { notes: "RPT smoke office" } });
  const inv = await p.invoice.findMany({ where: { hospitalId }, select: { id: true } });
  await p.expense.deleteMany({ where: { sourceType: "invoice_commission", sourceId: { in: inv.map(i=>i.id) } } });
  await p.cashBankEntry.deleteMany({ where: { hospitalId } });
  for (const i of inv) await p.invoice.delete({ where: { id: i.id } });
  await p.claim.deleteMany({ where: { hospitalId } });
  await p.hospitalBillingServiceSlab.deleteMany({ where: { billingService: { hospitalId } } });
  await p.hospitalBillingService.deleteMany({ where: { hospitalId } });
  await p.hospital.delete({ where: { id: hospitalId } });
  await p.referenceApplicableService.deleteMany({ where: { referenceId: refId } });
  await p.reference.delete({ where: { id: refId } });
  await p.billingServiceName.delete({ where: { id: svcId } });
})().finally(() => p.$disconnect());
  ' "$HOSP_ID" "$REF_ID" "$SVC_ID" 2>/dev/null || true
}
trap cleanup EXIT
pass "fixture: hospital=$HOSP_ID ref=$REF_ID svc=$SVC_ID"

# ---------------------------------------------------------------------------
say "Login"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"identifier\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

# ---------------------------------------------------------------------------
say "Issue both invoices (May, then June)"
MAY_DRAFT=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-05-01\"}")
MAY_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$MAY_DRAFT")
curl -fsS -X POST "${H[@]}" "$API/invoices/$MAY_ID/issue" > /dev/null

JUN_DRAFT=$(curl -fsS -X POST "${H[@]}" "$API/invoices" -d "{\"hospitalId\":\"$HOSP_ID\",\"month\":\"2026-06-01\"}")
JUN_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$JUN_DRAFT")
curl -fsS -X POST "${H[@]}" "$API/invoices/$JUN_ID/issue" > /dev/null

# Backdate the May invoice's issuedAt + the auto-commission expense date so they
# fall in May for the report aggregations. issuedAt defaults to "now" in the issue
# handler — fine for production, but reports group by issuedAt month.
node -e '
const p = require("./config/prisma");
(async () => {
  const mayId = process.argv[1];
  const may = new Date(Date.UTC(2026, 4, 15));
  await p.invoice.update({ where: { id: mayId }, data: { issuedAt: may } });
  await p.expense.updateMany({ where: { sourceType: "invoice_commission", sourceId: mayId }, data: { date: may } });
})().finally(() => p.$disconnect());
' "$MAY_ID" 2>/dev/null > /dev/null
pass "both invoices issued; May backdated for cross-month aggregation"

# ---------------------------------------------------------------------------
say "Add a manual Office expense (June)"
OFFICE_CAT=$(node -e '
const p = require("./config/prisma");
p.expenseCategory.findUnique({ where: { slug: "office" } }).then(c => process.stdout.write(c.id)).finally(() => p.$disconnect());
' 2>/dev/null | tail -1)
EXP=$(curl -fsS -X POST "${H[@]}" "$API/expenses" -d "{\"date\":\"2026-06-15\",\"categoryId\":\"$OFFICE_CAT\",\"amount\":500,\"notes\":\"RPT smoke office\"}")
EXP_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id)" "$EXP")
pass "manual office expense ₹500 created"

# ---------------------------------------------------------------------------
say "Reports — sales by month"
SALES=$(curl -fsS "${H[@]}" "$API/reports/sales?from=2026-05-01&to=2026-06-30&groupBy=month&hospitalId=$HOSP_ID")
TOTAL_SALES=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.sales))" "$SALES")
ROW_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.rowCount))" "$SALES")
# Sales: 2 invoices x net 1000 = 2000, split across May + June
[[ "$TOTAL_SALES" == "2000" ]] || fail "expected sales 2000, got $TOTAL_SALES"
[[ "$ROW_COUNT" == "2" ]] || fail "expected 2 month rows, got $ROW_COUNT"
pass "sales total ₹2000 across 2 months"

# ---------------------------------------------------------------------------
say "Reports — sales by hospital"
SBH=$(curl -fsS "${H[@]}" "$API/reports/sales?from=2026-05-01&to=2026-06-30&groupBy=hospital&hospitalId=$HOSP_ID")
HOSP_TOTAL=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.sales))" "$SBH")
[[ "$HOSP_TOTAL" == "2000" ]] || fail "expected hospital sales 2000, got $HOSP_TOTAL"
pass "hospital-wise sales OK"

# ---------------------------------------------------------------------------
say "Reports — expenses by category"
EXP_REP=$(curl -fsS "${H[@]}" "$API/reports/expenses?from=2026-05-01&to=2026-06-30&groupBy=category")
EXP_TOTAL=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.expense))" "$EXP_REP")
# 2 auto-commission rows @ 100 each (10% of 1000) + 500 office = 700
[[ "$EXP_TOTAL" == "700" ]] || fail "expected expense total 700, got $EXP_TOTAL"
pass "expense total ₹700 across categories"

# ---------------------------------------------------------------------------
say "Reports — profit by month"
PROFIT=$(curl -fsS "${H[@]}" "$API/reports/profit?from=2026-05-01&to=2026-06-30")
P_SALES=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.sales))" "$PROFIT")
P_EXP=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.expense))" "$PROFIT")
P_NET=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.profit))" "$PROFIT")
[[ "$P_SALES" == "2000" ]] || fail "profit.sales expected 2000, got $P_SALES"
[[ "$P_EXP" == "700" ]] || fail "profit.expense expected 700, got $P_EXP"
[[ "$P_NET" == "1300" ]] || fail "profit.net expected 1300, got $P_NET"
pass "profit: sales 2000 - expense 700 = 1300"

# ---------------------------------------------------------------------------
say "Reports — references"
REFRPT=$(curl -fsS "${H[@]}" "$API/reports/references?from=2026-05-01&to=2026-06-30&referenceId=$REF_ID")
BUS=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.businessGiven))" "$REFRPT")
PAID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.commissionPaid))" "$REFRPT")
[[ "$BUS" == "2000" ]] || fail "ref business expected 2000, got $BUS"
[[ "$PAID" == "200" ]] || fail "ref commission paid expected 200, got $PAID"
pass "reference: business 2000, commission paid 200"

# ---------------------------------------------------------------------------
say "Reports — cash/bank by mode (no entries → empty rows but endpoint live)"
CB=$(curl -fsS "${H[@]}" "$API/reports/cash-bank?groupBy=mode&from=2026-05-01&to=2026-06-30")
RC=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).totals.rowCount))" "$CB")
[[ "$RC" =~ ^[0-9]+$ ]] || fail "cash-bank rowCount missing: $CB"
pass "cash-bank endpoint live (rowCount=$RC)"

# ---------------------------------------------------------------------------
say "Reports — dashboard tiles"
DASH=$(curl -fsS "${H[@]}" "$API/reports/dashboard")
HAS_THIS_MONTH=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).thisMonth ? '1' : '0')" "$DASH")
HAS_CASH=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).cashBank ? '1' : '0')" "$DASH")
[[ "$HAS_THIS_MONTH" == "1" ]] || fail "dashboard.thisMonth missing"
[[ "$HAS_CASH" == "1" ]] || fail "dashboard.cashBank missing"
pass "dashboard endpoint live with all sections"

# Cleanup the manual expense (the rest is wiped by trap)
curl -sS -X DELETE "${H[@]}" "$API/expenses/$EXP_ID" > /dev/null 2>&1 || true

printf '\n\033[1;32mSMOKE PASSED\033[0m\n'
