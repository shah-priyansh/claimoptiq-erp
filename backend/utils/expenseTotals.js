// Expense tax/adjustment math — the single source of truth shared by the expense
// controller, the cash/bank payment clamp and the party ledger so an expense's
// "net payable" is computed identically everywhere.
//
// `amount` is the pre-tax line subtotal (what P&L / reports use). On top of it:
//   discount reduces the base, GST is added, TDS is withheld, round-off adjusts.
//   GST / TDS are both charged on the post-discount taxable base (standard
//   Indian purchase-bill convention).
//
//   taxable     = amount − discount
//   gstAmount   = taxable × gstRate%
//   tdsAmount   = taxable × tdsRate%
//   netPayable  = taxable + gstAmount + roundOff − tdsAmount
//
// Every tax column defaults to 0, so a legacy / auto-created / imported expense
// (all zeros) collapses to netPayable == amount — no backfill needed.
const { round2 } = require('./money');

const clampRate = (r) => Math.max(0, Math.min(100, Number(r) || 0));

// Net amount owed to the vendor (drives balance + cash-out), from the stored
// per-expense columns. Reads the already-computed amounts, not the rates.
const payableOf = (e = {}) => round2(
  (Number(e.amount) || 0)
  - (Number(e.discount) || 0)
  + (Number(e.gstAmount) || 0)
  + (Number(e.roundOff) || 0)
  - (Number(e.tdsAmount) || 0)
);

// Columns to persist on an expense, derived from the pre-tax subtotal and the
// raw rate / discount / round-off inputs. Returns `grandTotal` (the net payable)
// alongside the stored fields for convenience; it is not itself a column.
const computeExpenseTax = (subtotal, input = {}) => {
  const base = round2(Number(subtotal) || 0);
  const gstRate = clampRate(input.gstRate);
  const tdsRate = clampRate(input.tdsRate);
  // Discount is a flat ₹ amount, capped at the (non-negative) subtotal so it can
  // never exceed the bill. Round-off is a free ± adjustment.
  const discount = Math.max(0, Math.min(Math.max(0, base), round2(Number(input.discount) || 0)));
  const roundOff = round2(Number(input.roundOff) || 0);
  const taxable = round2(base - discount);
  const gstAmount = round2((taxable * gstRate) / 100);
  const tdsAmount = round2((taxable * tdsRate) / 100);
  const fields = { discount, gstRate, gstAmount, tdsRate, tdsAmount, roundOff };
  return { ...fields, grandTotal: payableOf({ amount: base, ...fields }) };
};

module.exports = { payableOf, computeExpenseTax };
