// Recompute amountPaid/amountPending/status on an invoice from its cash/bank entries.
// Run inside a transaction (`tx`) — the caller is mid-mutation and needs the rollup
// to land in the same atomic boundary.
//
// Status transitions:
//   paid                                       when amountPaid >= grandTotal
//   partially_paid                             when amountPaid > 0
//   issued                                     otherwise  (never reverts to 'draft')
//   void/draft                                 left untouched — those statuses own themselves
const recomputeInvoicePaidStatus = async (tx, invoiceId) => {
  if (!invoiceId) return null;
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, grandTotal: true },
  });
  if (!invoice) return null;

  // Sum only 'in' entries against this invoice
  const agg = await tx.cashBankEntry.aggregate({
    where: { invoiceId, direction: 'in' },
    _sum: { amount: true },
  });
  const amountPaid = Math.round(agg._sum.amount || 0);
  const amountPending = Math.round((invoice.grandTotal || 0) - amountPaid);

  let status = invoice.status;
  if (status !== 'void' && status !== 'draft') {
    if (amountPaid >= (invoice.grandTotal || 0) && (invoice.grandTotal || 0) > 0) status = 'paid';
    else if (amountPaid > 0) status = 'partially_paid';
    else status = 'issued';
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaid, amountPending, status },
  });
  return { amountPaid, amountPending, status };
};

module.exports = { recomputeInvoicePaidStatus };
