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
  const subtotalTpaDesk = Math.round(sum(tpaDeskLines));
  const subtotalServices = Math.round(sum(fixedServiceLines));
  const subtotalAdjust = Math.round(sum(adjustmentLines));
  const gross = subtotalTpaDesk + subtotalServices + subtotalAdjust;
  // Pre-tax discount: reduces the taxable value before GST/TDS. Clamped to
  // [0, gross] so a typo can't flip the invoice negative or add a phantom credit.
  const discountAmt = Math.min(Math.max(0, Math.round(Number(discount) || 0)), gross);
  const taxable = gross - discountAmt;
  const gstAmount = Math.round((taxable * (Number(gstRate) || 0)) / 100);
  // TDS is deducted on the GST-inclusive value (taxable + GST), not on the
  // bare SubTotal — when GST applies it must be summed in first.
  const tdsBase = taxable + gstAmount;
  const tdsAmount = Math.round((tdsBase * (Number(tdsRate) || 0)) / 100);
  const netTotal = taxable + gstAmount - tdsAmount;
  const prev = Math.round(Number(previousBalance) || 0);
  const grandTotal = netTotal + prev;
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
