// Reducing-balance EMI schedule for a loan.
//   monthly rate r = annual% / 12 / 100
//   EMI = P·r·(1+r)^n / ((1+r)^n − 1)   (or P/n when r == 0)
// Each month: interest = outstanding·r, principal = EMI − interest. The final
// installment absorbs any rounding so the outstanding lands exactly on 0.
//
// Tenure 0 has two flavours:
//   • rate 0  → a lump-sum (bullet) loan: one installment for the full principal,
//     due on the start date, with no interest.
//   • rate > 0 → an OPEN (interest-bearing) loan: the principal stays outstanding
//     and interest accrues at the rate. No fixed schedule — interest collections
//     and principal repayments are recorded ad hoc (see loanController).
const round = (n) => Math.round(Number(n) || 0);

// An open loan carries interest but no tenure: principal is repaid on demand and
// interest is collected periodically. Distinguished from a plain bullet loan
// (tenure 0, no rate) purely by having a non-zero rate.
const isOpenLoan = (loan) =>
  Math.max(0, Math.round(Number(loan.tenureMonths) || 0)) === 0 && Number(loan.annualInterestRate) > 0;

// Simple monthly interest on the outstanding principal at the annual rate.
const monthlyInterest = (outstanding, annualRate) =>
  round((Number(outstanding) || 0) * (Number(annualRate) || 0) / 1200);

function buildSchedule({ principal, annualInterestRate, tenureMonths, startDate }) {
  const P = round(principal);
  const n = Math.max(0, Math.round(Number(tenureMonths) || 0));
  const rate = Number(annualInterestRate) || 0;
  const start = new Date(startDate);

  if (n === 0) {
    // Open interest loan: no pre-built schedule — movements are recorded ad hoc.
    if (rate > 0) return { emi: 0, rows: [] };
    // Plain lump-sum loan: a single installment for the full principal.
    return {
      emi: P,
      rows: [{
        installmentNo: 1,
        dueDate: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
        emiAmount: P,
        principalComponent: P,
        interestComponent: 0,
        outstandingAfter: 0,
      }],
    };
  }

  const r = rate / 12 / 100;
  const emi = r === 0
    ? Math.round(P / n)
    : Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

  const rows = [];
  let outstanding = P;
  for (let i = 1; i <= n; i++) {
    const interest = round(outstanding * r);
    let principalComp = emi - interest;
    if (i === n || principalComp > outstanding) principalComp = outstanding; // settle remainder on the last row
    const thisEmi = principalComp + interest;
    outstanding = round(outstanding - principalComp);
    const due = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
    rows.push({
      installmentNo: i,
      dueDate: due,
      emiAmount: round(thisEmi),
      principalComponent: round(principalComp),
      interestComponent: round(interest),
      outstandingAfter: Math.max(0, outstanding),
    });
    if (outstanding <= 0) break;
  }
  return { emi, rows };
}

// Outstanding principal = principal − Σ principal component of PAID installments.
const outstandingPrincipal = (loan) => {
  const paidPrincipal = (loan.installments || [])
    .filter((i) => i.status === 'paid')
    .reduce((s, i) => s + (i.principalComponent || 0), 0);
  return Math.max(0, round(loan.principal) - round(paidPrincipal));
};

module.exports = { buildSchedule, outstandingPrincipal, round, isOpenLoan, monthlyInterest };
