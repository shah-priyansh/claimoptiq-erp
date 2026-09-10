const { round2 } = require('./money');

const sum = (rows) => (rows || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

const calculateInvoiceTotals = ({
  tpaDeskLines = [],
  fixedServiceLines = [],
  adjustmentLines = [],
  gstRate = 0,
  tdsRate = 0,
  previousBalance = 0,
  discount = 0,
}) => {
  const subtotalTpaDesk = round2(sum(tpaDeskLines));
  const subtotalServices = round2(sum(fixedServiceLines));
  const subtotalAdjust = round2(sum(adjustmentLines));
  const gross = round2(subtotalTpaDesk + subtotalServices + subtotalAdjust);
  // Pre-tax discount: reduces the taxable value before GST/TDS. Clamped to
  // [0, gross] so a typo can't flip the invoice negative or add a phantom credit.
  const discountAmt = Math.min(Math.max(0, round2(Number(discount) || 0)), gross);
  const taxable = round2(gross - discountAmt);
  const gstAmount = round2((taxable * (Number(gstRate) || 0)) / 100);
  // TDS is deducted on the GST-inclusive value (taxable + GST), not on the
  // bare SubTotal — when GST applies it must be summed in first.
  const tdsBase = round2(taxable + gstAmount);
  const tdsAmount = round2((tdsBase * (Number(tdsRate) || 0)) / 100);
  const netTotal = round2(taxable + gstAmount - tdsAmount);
  const prev = round2(Number(previousBalance) || 0);
  const grandTotal = round2(netTotal + prev);
  return {
    subtotalTpaDesk,
    subtotalServices,
    subtotalAdjust,
    gross,
    discount: discountAmt,
    gstAmount,
    tdsAmount,
    netTotal,
    previousBalance: prev,
    grandTotal,
    amountPending: grandTotal,
  };
};

module.exports = calculateInvoiceTotals;
