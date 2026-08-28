// Reducing-balance EMI schedule for a loan.
//   monthly rate r = annual% / 12 / 100
//   EMI = P·r·(1+r)^n / ((1+r)^n − 1)   (or P/n when r == 0)
// Each month: interest = outstanding·r, principal = EMI − interest. The final
// installment absorbs any rounding so the outstanding lands exactly on 0.
const round = (n) => Math.round(Number(n) || 0);

function buildSchedule({ principal, annualInterestRate, tenureMonths, startDate }) {
  const P = round(principal);
  const n = Math.max(1, Math.round(Number(tenureMonths) || 0));
  const r = (Number(annualInterestRate) || 0) / 12 / 100;
  const emi = r === 0
    ? Math.round(P / n)
    : Math.round((P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1));

  const rows = [];
  let outstanding = P;
  const start = new Date(startDate);
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

module.exports = { buildSchedule, outstandingPrincipal, round };
