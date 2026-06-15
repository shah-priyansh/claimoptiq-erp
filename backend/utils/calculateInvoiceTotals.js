const sum = (rows) => (rows || []).reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

const calculateInvoiceTotals = ({
  tpaDeskLines = [],
  fixedServiceLines = [],
  adjustmentLines = [],
  gstRate = 0,
  tdsRate = 0,
  previousBalance = 0,
}) => {
  const subtotalTpaDesk = Math.round(sum(tpaDeskLines));
  const subtotalServices = Math.round(sum(fixedServiceLines));
  const subtotalAdjust = Math.round(sum(adjustmentLines));
  const gross = subtotalTpaDesk + subtotalServices + subtotalAdjust;
  const gstAmount = Math.round((gross * (Number(gstRate) || 0)) / 100);
  const tdsAmount = Math.round((gross * (Number(tdsRate) || 0)) / 100);
  const netTotal = gross + gstAmount - tdsAmount;
  const prev = Math.round(Number(previousBalance) || 0);
  const grandTotal = netTotal + prev;
  return {
    subtotalTpaDesk,
    subtotalServices,
    subtotalAdjust,
    gross,
    gstAmount,
    tdsAmount,
    netTotal,
    previousBalance: prev,
    grandTotal,
    amountPending: grandTotal,
  };
};

module.exports = calculateInvoiceTotals;
