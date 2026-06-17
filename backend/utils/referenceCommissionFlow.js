// Reference Commission Auto Flow.
//
// When an invoice is issued, look up the hospital's linked Reference and, for
// every applicableServices entry whose billingServiceNameId matches an invoice
// line item, write Expense rows according to that entry's commissionType and
// commissionValue. Idempotent via the @@unique([sourceType, sourceLineId])
// index on Expense — line id encodes one expense row.
//
// Commission types:
//   percentage : value % of the matching line's amount, one Expense per line
//   fixed      : flat `value`, one Expense per applicable-service entry per
//                invoice (rolled up across all matching lines)
//   per_claim  : `value` × count of matching TPA-Desk lines on this invoice
//   one_time   : `value`, only on the first ever invoice for this
//                (reference, billingServiceName) combo

const SUPPORTED_LINE_TYPES = new Set(['claim_tpa_desk', 'service_fixed', 'service_percentage']);
const SOURCE_TYPE = 'invoice_commission';

// Pure-ish: given an invoice, the hospital's reference (with applicableServices),
// and a lookup of whether each (referenceId, billingServiceNameId) pair has
// produced a one_time expense before, build the rows to insert.
//
// onetimeAlreadyUsed: Set<billingServiceNameId> of pairs that already have a
//   prior one_time expense — those rows are skipped.
//
// Each returned row uses `lineId` as the dedupe key (matches the existing
// Expense.sourceLineId unique constraint). Non-line-bound rows (fixed,
// per_claim, one_time) synthesise a stable key: `${invoice.id}:${entryId}`.
const computeCommissionRows = (invoice, reference, onetimeAlreadyUsed = new Set()) => {
  if (!reference || !reference.isActive) {
    return { rows: [], skipped: true, reason: reference ? 'reference inactive' : 'no reference' };
  }
  const entries = (reference.applicableServices || []).filter((s) => s.billingServiceNameId);
  if (entries.length === 0) {
    return { rows: [], skipped: true, reason: 'no applicable services configured' };
  }

  // Bucket lines by billingServiceNameId so we can apply fixed/per_claim/
  // one_time once per applicable-service entry.
  const linesByNameId = new Map();
  for (const line of invoice.lineItems || []) {
    if (!SUPPORTED_LINE_TYPES.has(line.lineType)) continue;
    if (!line.billingServiceNameId) continue;
    if (!linesByNameId.has(line.billingServiceNameId)) linesByNameId.set(line.billingServiceNameId, []);
    linesByNameId.get(line.billingServiceNameId).push(line);
  }

  const rows = [];
  for (const entry of entries) {
    const matching = linesByNameId.get(entry.billingServiceNameId);
    if (!matching || !matching.length) continue;
    const value = Number(entry.commissionValue) || 0;
    if (value <= 0) continue;
    const type = entry.commissionType || 'percentage';

    if (type === 'percentage') {
      for (const line of matching) {
        const amount = Math.round((Number(line.amount) || 0) * value / 100);
        if (amount <= 0) continue;
        rows.push({
          dedupeKey: line.id,
          amount,
          description: `${line.description} (${value}%)`,
        });
      }
      continue;
    }

    if (type === 'fixed') {
      const amount = Math.round(value);
      if (amount <= 0) continue;
      rows.push({
        dedupeKey: `${invoice.id}:fixed:${entry.id}`,
        amount,
        description: `${entry.billingServiceName?.name || 'Service'} — Fixed`,
      });
      continue;
    }

    if (type === 'per_claim') {
      // Only TPA Desk lines count as "claims"; service_fixed / service_percentage
      // don't represent individual claims.
      const claimCount = matching.filter((l) => l.lineType === 'claim_tpa_desk').length;
      if (claimCount <= 0) continue;
      const amount = Math.round(value * claimCount);
      if (amount <= 0) continue;
      rows.push({
        dedupeKey: `${invoice.id}:per_claim:${entry.id}`,
        amount,
        description: `${entry.billingServiceName?.name || 'Service'} — ${claimCount} claim${claimCount === 1 ? '' : 's'} × ₹${value}`,
      });
      continue;
    }

    if (type === 'one_time') {
      if (onetimeAlreadyUsed.has(entry.billingServiceNameId)) continue;
      const amount = Math.round(value);
      if (amount <= 0) continue;
      rows.push({
        dedupeKey: `${invoice.id}:one_time:${entry.id}`,
        amount,
        description: `${entry.billingServiceName?.name || 'Service'} — One-time`,
      });
      continue;
    }
  }

  return { rows, skipped: false, reason: null };
};

const writeReferenceCommissionFlow = async (tx, invoice, hospital) => {
  const reference = hospital?.reference;
  if (!hospital?.referenceId || !reference) {
    return { rowsCreated: 0, totalAmount: 0, skipped: true, reason: 'no reference' };
  }
  // For one_time entries, find any prior Expense already written for this
  // (reference, billingServiceName) pair on a *different* invoice so we don't
  // double-bill the one-time fee. Issuing the same invoice twice is a no-op
  // because of the (sourceType, sourceLineId) unique constraint below.
  const onetimeEntries = (reference.applicableServices || []).filter((s) => s.commissionType === 'one_time');
  const onetimeAlreadyUsed = new Set();
  for (const entry of onetimeEntries) {
    const anyPrior = await tx.expense.findFirst({
      where: {
        referenceId: hospital.referenceId,
        sourceType: SOURCE_TYPE,
        sourceLineId: { endsWith: `:one_time:${entry.id}` },
        NOT: { sourceId: invoice.id },
      },
      select: { id: true },
    });
    if (anyPrior) onetimeAlreadyUsed.add(entry.billingServiceNameId);
  }

  const { rows, skipped, reason } = computeCommissionRows(invoice, reference, onetimeAlreadyUsed);
  if (skipped) return { rowsCreated: 0, totalAmount: 0, skipped: true, reason };
  if (!rows.length) return { rowsCreated: 0, totalAmount: 0, skipped: false, reason: null };

  const category = await tx.expenseCategory.findUnique({ where: { slug: 'reference_commission' } });
  if (!category) {
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
          sourceLineId: row.dedupeKey,
          createdById: invoice.issuedById || null,
        },
      });
      rowsCreated += 1;
      totalAmount += row.amount;
    } catch (err) {
      // P2002 = unique-constraint violation on (sourceType, sourceLineId)
      // → idempotency hit, row already written.
      if (err.code !== 'P2002') throw err;
    }
  }
  return { rowsCreated, totalAmount, skipped: false, reason: null };
};

// Called from invoice void. Removes any auto-rows the engine previously wrote.
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
