import { createInvoiceAPI, updateInvoiceAPI, issueInvoiceAPI } from '../../services/api';

export const formatINR = (n) =>
  '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export const monthLabel = (m) => {
  if (!m) return '-';
  const d = new Date(m);
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

// 'TPA Desk — RAJESH PATEL (CCN-0001)' → 'TPA Desk'
// Group rows by the prefix before ' — ' or ' - ' so 50 per-claim lines
// collapse into one expandable group per billing service.
export const baseServiceName = (desc) => {
  if (!desc) return 'Other';
  const m = String(desc).split(/\s+[—-]\s+/);
  return (m[0] || desc).trim();
};

export const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk',
  service_fixed: 'Fixed',
  service_percentage: 'Variable',
  adjustment: 'Adjustment',
  manual: 'Manual',
};

export const TYPE_PILL = (t) =>
  t === 'claim_tpa_desk' ? 'bg-primary-50 text-primary-700' :
  t === 'service_fixed' ? 'bg-amber-50 text-amber-700' :
  t === 'adjustment' ? 'bg-purple-50 text-purple-700' :
  t === 'manual' ? 'bg-emerald-50 text-emerald-700' :
  'bg-gray-100 text-gray-600';

// Recompute live totals from edited rows + draft settings. When the operator
// overrides TDS via the per-draft dropdown, `overrideTds` carries the picked
// master row so the live totals reflect the new rate without waiting for a
// server re-preview.
export const computeTotals = (editLines, settings, previewTotals, overrideTds) => {
  if (!previewTotals) return null;
  const sumBy = (types) => editLines.filter((r) => types.includes(r.lineType))
    .reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const tpa = sumBy(['claim_tpa_desk', 'service_percentage']);
  const services = sumBy(['service_fixed', 'manual']);
  const adjust = sumBy(['adjustment']);
  const gross = Math.round(tpa + services + adjust);
  const discount = Math.min(Math.max(0, Math.round(Number(settings.discount) || 0)), gross);
  const taxable = gross - discount;
  const effectiveGst = settings.gstRate === '' ? (previewTotals.gstRate || 0) : (Number(settings.gstRate) || 0);
  const gstAmount = Math.round((taxable * effectiveGst) / 100);
  const effectiveTdsRate = overrideTds ? (overrideTds.rate || 0) : (previewTotals.tdsRate || 0);
  const effectiveTdsSection = overrideTds ? (overrideTds.section || '') : (previewTotals.tdsSection || '');
  // TDS base = Taxable + GST (matches backend `calculateInvoiceTotals`).
  const tdsAmount = Math.round(((taxable + gstAmount) * effectiveTdsRate) / 100);
  const netTotal = taxable + gstAmount - tdsAmount;
  const roundOff = Math.round(Number(settings.roundOff) || 0);
  const previousBalance = previewTotals.previousBalance || 0;
  const grandTotal = netTotal + previousBalance + roundOff;
  return {
    tpa: Math.round(tpa), services: Math.round(services), adjust: Math.round(adjust),
    gross, discount, taxable, gstAmount, tdsAmount, netTotal, roundOff, previousBalance, grandTotal,
    effectiveGst, tdsRate: effectiveTdsRate, tdsSection: effectiveTdsSection,
  };
};

// Create one invoice + reconcile edits. Single POST when possible: manual
// items go in the create call, and the create response already carries
// lineItems with IDs (no extra GET round-trip). When `autoIssue` is true
// the freshly-created draft is immediately issued (gets an invoiceNumber
// and flips status to 'issued') so the caller never has to open the draft
// to issue it.
export const commitDraft = async (draft, { autoIssue = false } = {}) => {
  const monthIso = new Date(draft.month).toISOString().slice(0, 10);
  const monthArg = monthIso.slice(0, 7) + '-01';
  const manualItemsForCreate = draft.editLines
    .filter((row) => row._isManual)
    .map((row) => ({ description: row.description || '', amount: Number(row.amount) || 0 }))
    .filter((m) => (m.description || '').trim());

  const { data: created } = await createInvoiceAPI({
    hospitalId: draft.hospitalId,
    month: monthArg,
    notes: draft.settings.notes || '',
    ...(draft.settings.gstRate !== '' ? { gstRate: Number(draft.settings.gstRate) || 0 } : {}),
    ...(draft.settings.tdsRateId ? { tdsRateId: draft.settings.tdsRateId } : {}),
    claimIds: draft.claimIds,
    ...(manualItemsForCreate.length ? { manualItems: manualItemsForCreate } : {}),
    ...(draft.isDirectPatient ? { isDirectPatient: true } : {}),
  });

  const lineEdits = [];
  const removedLineIds = [];
  if ((draft.previewLines || []).length) {
    const origDescByOrder = draft.previewLines.map((l) => l.description);
    const builtServerLines = (created.lineItems || []).filter((l) => l.lineType !== 'manual');
    const idsByDesc = new Map();
    builtServerLines.forEach((s) => {
      const key = s.description;
      if (!idsByDesc.has(key)) idsByDesc.set(key, []);
      idsByDesc.get(key).push(s._id || s.id);
    });

    draft.editLines.forEach((row) => {
      if (row._isManual) return;
      const origDesc = origDescByOrder.shift();
      const queue = idsByDesc.get(origDesc);
      const id = queue?.shift();
      if (!id) return;
      const newDesc = row.description || '';
      const newAmt = Math.round(Number(row.amount) || 0);
      const origAmt = Math.round(Number((draft.previewLines.find((l) => l.description === origDesc) || {}).amount) || 0);
      if (newDesc !== origDesc || newAmt !== origAmt) {
        lineEdits.push({ id, description: newDesc, amount: newAmt });
      }
    });

    idsByDesc.forEach((queue) => queue.forEach((id) => removedLineIds.push(id)));
  }

  const patchPayload = {};
  if (lineEdits.length) patchPayload.lineEdits = lineEdits;
  if (removedLineIds.length) patchPayload.removedLineIds = removedLineIds;
  if (Number(draft.settings.roundOff) !== 0) patchPayload.roundOff = Math.round(Number(draft.settings.roundOff) || 0);
  if (Number(draft.settings.discount) > 0) patchPayload.discount = Math.max(0, Math.round(Number(draft.settings.discount) || 0));

  if (Object.keys(patchPayload).length) {
    await updateInvoiceAPI(created._id, patchPayload);
  }

  if (autoIssue && created.status === 'draft') {
    const { data: issued } = await issueInvoiceAPI(created._id);
    return issued;
  }

  return created;
};
