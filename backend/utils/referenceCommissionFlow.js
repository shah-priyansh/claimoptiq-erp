// Phase 2.5 — Reference Commission Auto Flow.
//
// When an invoice is issued, look up the hospital's linked Reference and,
// for every line item whose billingServiceNameId is in the reference's
// applicableServices list, write an Expense row with
//   sourceType='invoice_commission', sourceLineId=lineItem.id
// (the @@unique([sourceType, sourceLineId]) index on Expense gives free
// idempotency).
//
// Reads the reference rate + applicable services LIVE at issue time and
// snapshots the computed amount into Expense. Rate/service changes later
// do not mutate already-written rows.
//
// Both functions must be called inside a $transaction `tx`.

const SUPPORTED_LINE_TYPES = new Set(['claim_tpa_desk', 'service_fixed', 'service_percentage']);
const SOURCE_TYPE = 'invoice_commission';

// Pure: given an invoice and the hospital's reference (with applicableServices),
// produce the rows that should be written. No side effects.
const computeCommissionRows = (invoice, reference) => {
  if (!reference || !reference.isActive) return { rows: [], skipped: true, reason: reference ? 'reference inactive' : 'no reference' };
  const rate = Number(reference.commissionRate) || 0;
  if (rate <= 0) return { rows: [], skipped: true, reason: 'commission rate is zero' };

  const applicable = new Set((reference.applicableServices || []).map((s) => s.billingServiceNameId).filter(Boolean));
  if (applicable.size === 0) return { rows: [], skipped: true, reason: 'no applicable services configured' };

  const rows = [];
  for (const line of invoice.lineItems || []) {
    if (!SUPPORTED_LINE_TYPES.has(line.lineType)) continue;
    if (!line.billingServiceNameId) continue;
    if (!applicable.has(line.billingServiceNameId)) continue;
    const amount = Math.round((Number(line.amount) || 0) * rate / 100);
    if (amount <= 0) continue;
    rows.push({
      lineId: line.id,
      amount,
      description: line.description,
    });
  }
  return { rows, skipped: false, reason: null };
};

const writeReferenceCommissionFlow = async (tx, invoice, hospital) => {
  const reference = hospital?.reference;
  if (!hospital?.referenceId || !reference) {
    return { rowsCreated: 0, totalAmount: 0, skipped: true, reason: 'no reference' };
  }
  const { rows, skipped, reason } = computeCommissionRows(invoice, reference);
  if (skipped) return { rowsCreated: 0, totalAmount: 0, skipped: true, reason };
  if (!rows.length) return { rowsCreated: 0, totalAmount: 0, skipped: false, reason: null };

  const category = await tx.expenseCategory.findUnique({ where: { slug: 'reference_commission' } });
  if (!category) {
    // Fail loud — system seed is broken if this is missing.
    const err = new Error('expense category "reference_commission" not found — re-run seed');
    err.status = 500;
    throw err;
  }

  const issuedAt = invoice.issuedAt || new Date();
  let rowsCreated = 0;
  let totalAmount = 0;
  for (const row of rows) {
    try {
      await tx.expense.create({
        data: {
          date: issuedAt,
          categoryId: category.id,
          amount: row.amount,
          notes: `Auto: ${reference.name} on ${row.description} (Invoice ${invoice.invoiceNumber || 'draft'})`,
          referenceId: hospital.referenceId,
          sourceType: SOURCE_TYPE,
          sourceId: invoice.id,
          sourceLineId: row.lineId,
          createdById: invoice.issuedById || null,
        },
      });
      rowsCreated += 1;
      totalAmount += row.amount;
    } catch (err) {
      // The @@unique([sourceType, sourceLineId]) gives us idempotency for free.
      // P2002 = unique-constraint violation → the row was already written.
      if (err.code !== 'P2002') throw err;
    }
  }
  return { rowsCreated, totalAmount, skipped: false, reason: null };
};

// Called from invoice void. Removes any auto-rows the engine previously wrote.
// Returns the count of rows removed.
const clearReferenceCommissionFlow = async (tx, invoiceId) => {
  const result = await tx.expense.deleteMany({
    where: { sourceType: SOURCE_TYPE, sourceId: invoiceId },
  });
  return { rowsRemoved: result.count };
};

module.exports = {
  computeCommissionRows,
  writeReferenceCommissionFlow,
  clearReferenceCommissionFlow,
  SOURCE_TYPE,
};
