const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const calculateFilePrice = require('../utils/calculateFilePrice');
const calculateInvoiceTotals = require('../utils/calculateInvoiceTotals');
const { reserveNextInvoiceNumber } = require('../utils/invoiceSequence');
const renderInvoicePdf = require('../utils/renderInvoicePdf');
const { getInvoiceTemplate } = require('./siteSettingController');
const { writeReferenceCommissionFlow, clearReferenceCommissionFlow } = require('../utils/referenceCommissionFlow');

const EXCLUDED_CLAIM_STATUSES = ['rejected', 'cancelled'];

const parseMonth = (input) => {
  if (!input) return null;
  const d = new Date(input);
  if (isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
};

const monthEnd = (month) => new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1));

const invoiceInclude = {
  hospital: { select: { id: true, name: true, address: true, city: true, state: true, pincode: true, phone: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  issuedBy: { select: { id: true, name: true, email: true } },
  tdsRateMaster: { select: { id: true, taxName: true, rate: true, section: true } },
  lineItems: { orderBy: { order: 'asc' } },
};

// Lean include for the invoice list view — drops `lineItems` (the main weight,
// 50+ TPA Desk rows per invoice), createdBy/issuedBy/tdsRateMaster, and pares
// `hospital` down to the columns the list table actually renders. Cuts the
// response payload by ~95% on heavy months.
const invoiceListInclude = {
  hospital: { select: { id: true, name: true } },
};

const resolveTdsRate = async (tdsRateId, fallbackRate) => {
  if (!tdsRateId) return { rate: fallbackRate || 0, name: '', section: '' };
  const r = await prisma.tdsRate.findUnique({ where: { id: tdsRateId } });
  if (!r) {
    const err = new Error('TDS rate not found');
    err.status = 400;
    throw err;
  }
  return { rate: r.rate || 0, name: r.taxName, section: r.section };
};

// Build the line items + totals for a (hospital, month) without persisting.
// Returns { lines, totals, hospital, claims }.
// When `claimIds` is supplied, the line set is restricted to those claims (still
// scoped by hospital + month) so the bulk "Generate Bill" flow can preview only
// the claims the user actually selected, not every unbilled claim in the month.
const buildInvoiceLines = async (hospitalId, month, { adjustments = [], tdsRateId, gstRateOverride, claimIds, discount = 0 } = {}) => {
  const hospital = await prisma.hospital.findUnique({
    where: { id: hospitalId },
    include: {
      billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
    },
  });
  if (!hospital) {
    const err = new Error('Hospital not found');
    err.status = 404;
    throw err;
  }

  const claimWhere = {
    hospitalId,
    dateOfDischarge: { gte: month, lt: monthEnd(month) },
    isBilled: false,
    status: { notIn: EXCLUDED_CLAIM_STATUSES },
  };
  if (Array.isArray(claimIds) && claimIds.length) {
    claimWhere.id = { in: claimIds };
  }

  const claims = await prisma.claim.findMany({
    where: claimWhere,
    select: {
      id: true, patientName: true, ccnNo: true, hospitalFinalBill: true, finalApprovalAmount: true,
      filePrice: true, filePriceOverridden: true,
    },
  });

  const services = (hospital.billingServices || []).filter((s) => s.isActive);

  // 1. TPA Desk per claim (slab/percentage). Map each line to the billing service used (if identifiable).
  const slabServices = services.filter((s) => s.billingType === 'per_claim_slab' || s.billingType === 'percentage');
  // Build a name → BillingServiceName id map (one query)
  const serviceNameRows = slabServices.length
    ? await prisma.billingServiceName.findMany({
        where: { name: { in: [...new Set(slabServices.map((s) => s.serviceName))] } },
        select: { id: true, name: true },
      })
    : [];
  const nameToGlobalId = new Map(serviceNameRows.map((r) => [r.name, r.id]));

  let order = 0;
  const tpaDeskLines = claims.map((c) => {
    const amount = c.filePriceOverridden
      ? c.filePrice
      : calculateFilePrice(services, c.hospitalFinalBill, c.finalApprovalAmount);
    // Pick the first matching slab service for line metadata (most setups have one)
    const svc = slabServices[0];
    return {
      lineType: 'claim_tpa_desk',
      description: `TPA Desk — ${c.patientName}${c.ccnNo ? ` (CCN ${c.ccnNo})` : ''}`,
      amount,
      order: order++,
      claimId: c.id,
      billingServiceId: svc?.id || null,
      billingServiceNameId: svc ? nameToGlobalId.get(svc.serviceName) || null : null,
      meta: { hospitalFinalBill: c.hospitalFinalBill, finalApprovalAmount: c.finalApprovalAmount, overridden: c.filePriceOverridden },
    };
  });

  // 2. Fixed services
  const fixedMonthly = services.filter((s) => s.billingType === 'fixed_monthly');
  const fixedOnetime = services.filter((s) => s.billingType === 'fixed_onetime');

  // Gate fixed_onetime: include only if no prior issued invoice has a line with this billingServiceId
  let onetimeIncluded = [];
  if (fixedOnetime.length) {
    const priorOnetimeRows = await prisma.invoiceLineItem.findMany({
      where: {
        billingServiceId: { in: fixedOnetime.map((s) => s.id) },
        invoice: { hospitalId, status: { in: ['issued', 'partially_paid', 'paid'] } },
      },
      select: { billingServiceId: true },
    });
    const usedIds = new Set(priorOnetimeRows.map((r) => r.billingServiceId));
    onetimeIncluded = fixedOnetime.filter((s) => !usedIds.has(s.id));
  }

  const fixedSvcRowsAll = [...fixedMonthly, ...onetimeIncluded];
  const fixedNameRows = fixedSvcRowsAll.length
    ? await prisma.billingServiceName.findMany({
        where: { name: { in: [...new Set(fixedSvcRowsAll.map((s) => s.serviceName))] } },
        select: { id: true, name: true },
      })
    : [];
  const fixedNameMap = new Map(fixedNameRows.map((r) => [r.name, r.id]));

  const fixedServiceLines = fixedSvcRowsAll.map((s) => ({
    lineType: 'service_fixed',
    description: `${s.serviceName} — ${s.billingType === 'fixed_monthly' ? 'Monthly' : 'One-time'}`,
    amount: Number(s.fixedAmount) || 0,
    order: order++,
    claimId: null,
    billingServiceId: s.id,
    billingServiceNameId: fixedNameMap.get(s.serviceName) || null,
    meta: { billingType: s.billingType },
  }));

  // 3. Adjustments (operator-supplied)
  const adjustmentLines = (Array.isArray(adjustments) ? adjustments : [])
    .filter((a) => a && a.description)
    .map((a) => ({
      lineType: 'adjustment',
      description: String(a.description).slice(0, 200),
      amount: Math.round(Number(a.amount) || 0),
      order: order++,
      claimId: null,
      billingServiceId: null,
      billingServiceNameId: null,
      meta: {},
    }));

  // 4. Previous balance = Σ amountPending of issued|partially_paid prior invoices for this hospital
  const priorOpen = await prisma.invoice.findMany({
    where: { hospitalId, status: { in: ['issued', 'partially_paid'] } },
    select: { amountPending: true },
  });
  const previousBalance = priorOpen.reduce((acc, r) => acc + (Number(r.amountPending) || 0), 0);

  // Resolve TDS + GST: per-invoice override wins, otherwise the site-wide
  // default from Settings → Tax & Numbering Defaults. The per-hospital
  // gstRate/tdsRate/tdsRateId columns were retired 2026-06-16 — both are
  // platform-wide now. One `getInvoiceTemplate()` call covers both lookups.
  const tpl = await getInvoiceTemplate();
  const effectiveTdsRateId = tdsRateId || tpl.invoice_default_tds_rate_id || null;
  const tds = effectiveTdsRateId
    ? await resolveTdsRate(effectiveTdsRateId, 0)
    : { rate: 0, name: '', section: '' };

  let effectiveGstRate = 0;
  if (gstRateOverride !== undefined && gstRateOverride !== null && gstRateOverride !== '') {
    effectiveGstRate = Number(gstRateOverride) || 0;
  } else {
    effectiveGstRate = Number(tpl.invoice_default_gst_rate) || 0;
  }

  const totals = calculateInvoiceTotals({
    tpaDeskLines,
    fixedServiceLines,
    adjustmentLines,
    gstRate: effectiveGstRate,
    tdsRate: tds.rate,
    previousBalance,
    discount,
  });

  return {
    hospital,
    claims,
    lines: [...tpaDeskLines, ...fixedServiceLines, ...adjustmentLines],
    totals: { ...totals, gstRate: effectiveGstRate, tdsRate: tds.rate, tdsName: tds.name, tdsSection: tds.section, tdsRateId: effectiveTdsRateId },
  };
};

exports.preview = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, adjustments, tdsRateId, gstRate, claimIds, discount } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });
    const built = await buildInvoiceLines(hospitalId, month, { adjustments, tdsRateId, gstRateOverride: gstRate, claimIds, discount });
    res.json({
      hospital: toResponse(built.hospital),
      month,
      lines: built.lines,
      totals: built.totals,
      hasContent: built.lines.length > 0,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

// Group selected claims by (hospital, dischargeMonth) and return one draft
// preview per group. Used by the "Generate Bill" flow on the Claims Report
// page so the operator can step through every hospital invoice that the
// selection produces before committing.
exports.previewBulk = async (req, res) => {
  try {
    const { claimIds, tdsRateId, gstRate } = req.body;
    if (!Array.isArray(claimIds) || !claimIds.length) {
      return res.status(400).json({ message: 'claimIds (non-empty array) is required' });
    }

    // Pull every selected claim WITHOUT the billable filter so we can tell
    // the user exactly which ones were skipped and why.
    const allSelected = await prisma.claim.findMany({
      where: { id: { in: claimIds } },
      select: {
        id: true, srNo: true, patientName: true, status: true,
        isBilled: true, hospitalId: true, dateOfDischarge: true,
      },
    });

    const skipped = [];
    const claims = [];
    for (const c of allSelected) {
      if (c.isBilled) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'already billed' });
      } else if (EXCLUDED_CLAIM_STATUSES.includes(c.status)) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: c.status });
      } else if (!c.hospitalId) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'no hospital' });
      } else if (!c.dateOfDischarge) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'no discharge date' });
      } else {
        claims.push(c);
      }
    }

    if (!claims.length) {
      return res.status(400).json({
        message: 'No billable claims in selection',
        skipped,
      });
    }

    // Group by hospitalId + month (UTC year-month) → list of claimIds.
    const groups = new Map();
    for (const c of claims) {
      const d = new Date(c.dateOfDischarge);
      const monthKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
      const key = `${c.hospitalId}|${monthKey}`;
      if (!groups.has(key)) groups.set(key, { hospitalId: c.hospitalId, month: new Date(monthKey), claimIds: [] });
      groups.get(key).claimIds.push(c.id);
    }

    // Build a preview for each group (sequential — we hit Prisma per group anyway).
    const previews = [];
    for (const g of groups.values()) {
      const built = await buildInvoiceLines(g.hospitalId, g.month, { tdsRateId, gstRateOverride: gstRate, claimIds: g.claimIds });
      // Detect drafts that already exist for this (hospital, month) so the UI
      // can warn the operator before they try to commit.
      const existing = await prisma.invoice.findUnique({
        where: { hospitalId_month: { hospitalId: g.hospitalId, month: g.month } },
        select: { id: true, status: true, invoiceNumber: true },
      });
      previews.push({
        hospitalId: g.hospitalId,
        hospital: toResponse(built.hospital),
        month: g.month,
        claimIds: g.claimIds,
        lines: built.lines,
        totals: built.totals,
        hasContent: built.lines.length > 0,
        existingInvoice: existing ? toResponse(existing) : null,
      });
    }

    // Stable ordering: month asc, then hospital name asc.
    previews.sort((a, b) => {
      const m = new Date(a.month) - new Date(b.month);
      if (m !== 0) return m;
      return (a.hospital?.name || '').localeCompare(b.hospital?.name || '');
    });

    res.json({ previews, skipped });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, notes, adjustments, tdsRateId, gstRate, claimIds, discount, manualItems } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });

    const existing = await prisma.invoice.findUnique({
      where: { hospitalId_month: { hospitalId, month } },
      include: invoiceInclude,
    });
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ message: `Invoice already ${existing.status} for this hospital and month`, invoice: toResponse(existing) });
    }
    if (existing && existing.status === 'draft') {
      return res.status(200).json(toResponse(existing));
    }

    const built = await buildInvoiceLines(hospitalId, month, { adjustments, tdsRateId, gstRateOverride: gstRate, claimIds, discount });
    // Normalise manualItems passed alongside create — these let an operator
    // bill a month that has no claims/fixed services (e.g. a one-off charge).
    const normalisedManual = (Array.isArray(manualItems) ? manualItems : [])
      .map((m) => ({
        description: String(m?.description || '').slice(0, 300).trim(),
        amount: Math.round(Number(m?.amount) || 0),
      }))
      .filter((m) => m.description);
    if (!built.lines.length && !normalisedManual.length) {
      return res.status(400).json({ message: 'No claims or fixed services found for this month. Add at least one manual item.' });
    }

    // Append manualItems to built.lines and recompute totals so the persisted
    // gross/netTotal account for them on first save (no PATCH round-trip needed).
    let baseOrder = built.lines.length;
    const manualLines = normalisedManual.map((m) => ({
      lineType: 'manual',
      description: m.description,
      amount: m.amount,
      order: baseOrder++,
      claimId: null,
      billingServiceId: null,
      billingServiceNameId: null,
      meta: { addedManually: true },
    }));
    const allLines = [...built.lines, ...manualLines];
    const finalTotals = manualLines.length
      ? calculateInvoiceTotals({
          tpaDeskLines: allLines.filter((l) => l.lineType === 'claim_tpa_desk' || l.lineType === 'service_percentage'),
          fixedServiceLines: allLines.filter((l) => l.lineType === 'service_fixed' || l.lineType === 'manual'),
          adjustmentLines: allLines.filter((l) => l.lineType === 'adjustment'),
          gstRate: built.totals.gstRate,
          tdsRate: built.totals.tdsRate,
          previousBalance: built.totals.previousBalance,
          discount,
        })
      : built.totals;

    const invoice = await prisma.$transaction(async (tx) => {
      return tx.invoice.create({
        data: {
          hospitalId,
          month,
          status: 'draft',
          notes: notes || '',
          gstRate: built.totals.gstRate,
          gstAmount: finalTotals.gstAmount,
          tdsRate: built.totals.tdsRate,
          tdsAmount: finalTotals.tdsAmount,
          tdsRateId: built.totals.tdsRateId,
          tdsName: built.totals.tdsName,
          tdsSection: built.totals.tdsSection,
          subtotalTpaDesk: finalTotals.subtotalTpaDesk,
          subtotalServices: finalTotals.subtotalServices,
          subtotalAdjust: finalTotals.subtotalAdjust,
          gross: finalTotals.gross,
          discount: finalTotals.discount,
          netTotal: finalTotals.netTotal,
          previousBalance: finalTotals.previousBalance,
          grandTotal: finalTotals.grandTotal,
          amountPending: finalTotals.amountPending,
          createdById: req.user?.id || null,
          lineItems: { create: allLines },
        },
        include: invoiceInclude,
      });
    });

    res.status(201).json(toResponse(invoice));
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.list = async (req, res) => {
  try {
    const { hospitalId, status, month, page, limit = 25 } = req.query;
    const where = {};
    if (hospitalId) where.hospitalId = hospitalId;
    if (status) where.status = status;
    if (month) {
      const m = parseMonth(month);
      if (m) where.month = m;
    }
    const take = Math.min(Number(limit) || 25, 100);
    const skip = page ? (Number(page) - 1) * take : 0;
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: invoiceListInclude,
        orderBy: [{ month: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json({
      invoices: toResponse(invoices),
      total,
      pages: Math.ceil(total / take),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(invoice));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Recompute and persist totals on an invoice from its current line items.
// Applies tdsRate, gstRate, discount, roundOff, previousBalance, amountPaid → grandTotal + amountPending.
const recomputeInvoiceFromLines = async (tx, invoiceId) => {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, hospitalId: true, gstRate: true, tdsRate: true, roundOff: true,
      amountPaid: true, previousBalance: true, discount: true,
      lineItems: { select: { lineType: true, amount: true } },
    },
  });
  if (!inv) return;
  const sumBy = (type) => inv.lineItems.filter((l) => l.lineType === type).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const tpa = sumBy('claim_tpa_desk') + sumBy('service_percentage');
  const services = sumBy('service_fixed') + sumBy('manual');
  const adjust = sumBy('adjustment');
  const gross = Math.round(tpa + services + adjust);
  // Clamp discount to [0, gross] — see calculateInvoiceTotals for rationale.
  const discount = Math.min(Math.max(0, Math.round(Number(inv.discount) || 0)), gross);
  const taxable = gross - discount;
  const gstAmount = Math.round((taxable * (inv.gstRate || 0)) / 100);
  // TDS base = taxable + GST (matches `calculateInvoiceTotals`).
  const tdsAmount = Math.round(((taxable + gstAmount) * (inv.tdsRate || 0)) / 100);
  const netTotal = taxable + gstAmount - tdsAmount;
  const grandTotal = netTotal + (inv.previousBalance || 0) + (inv.roundOff || 0);
  const amountPending = Math.round(grandTotal - (inv.amountPaid || 0));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalTpaDesk: Math.round(tpa),
      subtotalServices: Math.round(services),
      subtotalAdjust: Math.round(adjust),
      gross,
      discount,
      gstAmount,
      tdsAmount,
      netTotal,
      grandTotal,
      amountPending,
    },
  });
};

exports.update = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { lineItems: true },
    });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ message: 'Only drafts can be edited' });

    const {
      notes, adjustments, tdsRateId, gstRate,
      lineEdits, manualItems, removedLineIds,
      roundOff, discount,
    } = req.body;

    const tdsChanged = tdsRateId !== undefined;
    const gstChanged = gstRate !== undefined;
    const discountChanged = discount !== undefined;
    const fullRebuild = Array.isArray(adjustments);
    const tdsResolvedId = tdsChanged ? (tdsRateId || null) : invoice.tdsRateId;
    const gstResolved = gstChanged ? (Math.max(0, Number(gstRate) || 0)) : invoice.gstRate;
    const discountResolved = discountChanged ? Math.max(0, Math.round(Number(discount) || 0)) : invoice.discount;
    const partialEdit =
      Array.isArray(lineEdits) ||
      Array.isArray(manualItems) ||
      Array.isArray(removedLineIds) ||
      roundOff !== undefined ||
      gstChanged ||
      discountChanged;

    // --- Path 1: a full rebuild (adjustments[] sent) ---
    // Keeps the existing behaviour for the original 'Save Draft' flow that
    // wipes the line items and regenerates them from the source claims.
    if (fullRebuild || tdsChanged || notes !== undefined) {
      const built = await buildInvoiceLines(invoice.hospitalId, invoice.month, { adjustments, tdsRateId: tdsResolvedId, gstRateOverride: gstResolved, discount: discountResolved });
      const updated = await prisma.$transaction(async (tx) => {
        if (fullRebuild) {
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
        }
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(notes !== undefined ? { notes: String(notes || '') } : {}),
            ...(roundOff !== undefined ? { roundOff: Math.round(Number(roundOff) || 0) } : {}),
            ...(discountChanged ? { discount: discountResolved } : {}),
            ...((fullRebuild || tdsChanged)
              ? {
                  subtotalTpaDesk: built.totals.subtotalTpaDesk,
                  subtotalServices: built.totals.subtotalServices,
                  subtotalAdjust: built.totals.subtotalAdjust,
                  gross: built.totals.gross,
                  discount: built.totals.discount,
                  gstRate: built.totals.gstRate,
                  gstAmount: built.totals.gstAmount,
                  tdsRate: built.totals.tdsRate,
                  tdsAmount: built.totals.tdsAmount,
                  tdsRateId: built.totals.tdsRateId,
                  tdsName: built.totals.tdsName,
                  tdsSection: built.totals.tdsSection,
                  netTotal: built.totals.netTotal,
                  previousBalance: built.totals.previousBalance,
                  grandTotal: built.totals.grandTotal,
                  amountPending: built.totals.grandTotal - (invoice.amountPaid || 0),
                  ...(fullRebuild ? { lineItems: { create: built.lines } } : {}),
                }
              : {}),
          },
        });
        // Round-off / discount makes the persisted grandTotal drift from built.totals;
        // recompute from the actual line items to keep it consistent.
        if ((roundOff !== undefined || gstChanged || discountChanged) && !fullRebuild && !tdsChanged) {
          await recomputeInvoiceFromLines(tx, invoice.id);
        }
        return tx.invoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude });
      });
      return res.json(toResponse(updated));
    }

    // --- Path 2: partial edits on existing line items + round-off + discount ---
    if (!partialEdit) return res.json(toResponse(invoice));

    const validIds = new Set(invoice.lineItems.map((l) => l.id));
    const updated = await prisma.$transaction(async (tx) => {
      if (Array.isArray(removedLineIds)) {
        const toRemove = removedLineIds.filter((id) => validIds.has(id));
        if (toRemove.length) await tx.invoiceLineItem.deleteMany({ where: { id: { in: toRemove } } });
      }
      if (Array.isArray(lineEdits)) {
        for (const edit of lineEdits) {
          if (!edit?.id || !validIds.has(edit.id)) continue;
          const data = {};
          if (edit.description !== undefined) data.description = String(edit.description).slice(0, 300);
          if (edit.amount !== undefined) {
            const n = Math.round(Number(edit.amount));
            if (Number.isFinite(n)) data.amount = n;
          }
          if (Object.keys(data).length) {
            await tx.invoiceLineItem.update({ where: { id: edit.id }, data });
          }
        }
      }
      if (Array.isArray(manualItems)) {
        const baseOrder = Math.max(0, ...invoice.lineItems.map((l) => l.order || 0));
        for (let i = 0; i < manualItems.length; i++) {
          const m = manualItems[i];
          if (!m) continue;
          const description = String(m.description || '').slice(0, 300).trim();
          const amount = Math.round(Number(m.amount) || 0);
          if (!description) continue;
          await tx.invoiceLineItem.create({
            data: {
              invoiceId: invoice.id,
              lineType: 'manual',
              description,
              amount,
              order: baseOrder + 1 + i,
              meta: { addedManually: true },
            },
          });
        }
      }
      if (roundOff !== undefined || gstChanged || discountChanged) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(roundOff !== undefined ? { roundOff: Math.round(Number(roundOff) || 0) } : {}),
            ...(gstChanged ? { gstRate: gstResolved } : {}),
            ...(discountChanged ? { discount: discountResolved } : {}),
          },
        });
      }
      await recomputeInvoiceFromLines(tx, invoice.id);
      return tx.invoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude });
    });
    res.json(toResponse(updated));
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.issue = async (req, res) => {
  try {
    const id = req.params.id;
    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        hospital: {
          include: {
            reference: { include: { applicableServices: true } },
          },
        },
        lineItems: true,
      },
    });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ message: `Cannot issue from status '${invoice.status}'` });

    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 15 * 24 * 60 * 60 * 1000);

    const claimIds = invoice.lineItems.filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId).map((l) => l.claimId);

    let commissionAutoFlow = { rowsCreated: 0, totalAmount: 0, skipped: true, reason: 'not run' };
    const result = await prisma.$transaction(async (tx) => {
      // Recompute previousBalance at issue time (drift safety)
      const priorOpen = await tx.invoice.findMany({
        where: {
          hospitalId: invoice.hospitalId,
          status: { in: ['issued', 'partially_paid'] },
          id: { not: invoice.id },
        },
        select: { amountPending: true },
      });
      const previousBalance = priorOpen.reduce((acc, r) => acc + (Number(r.amountPending) || 0), 0);
      const grandTotal = (invoice.netTotal || 0) + previousBalance;

      // Reserve invoice number atomically. Prefix is platform-wide now —
      // pulled from Site Settings → Invoice Template, not the hospital row.
      const invoiceTemplate = await getInvoiceTemplate();
      const invoicePrefix = (invoiceTemplate.invoice_number_prefix || 'FCC').toUpperCase().slice(0, 10) || 'FCC';
      const invoiceNumber = await reserveNextInvoiceNumber(tx, invoicePrefix, issuedAt);

      // Flip linked claims to 'billed' and record their prior status on the
      // line item so a void can roll the claim back to where it was.
      if (claimIds.length) {
        const claims = await tx.claim.findMany({
          where: { id: { in: claimIds } },
          select: { id: true, status: true, filePriceOverridden: true },
        });
        for (const c of claims) {
          const line = invoice.lineItems.find((l) => l.claimId === c.id);
          if (line) {
            await tx.invoiceLineItem.update({
              where: { id: line.id },
              data: { meta: { ...(line.meta || {}), priorStatus: c.status } },
            });
          }
          await tx.claim.update({
            where: { id: c.id },
            data: {
              isBilled: true,
              status: 'billed',
              ...(c.filePriceOverridden ? {} : { filePrice: line ? line.amount : undefined }),
            },
          });
        }
      }

      const updated = await tx.invoice.update({
        where: { id },
        data: {
          status: 'issued',
          invoiceNumber,
          issuedAt,
          dueDate,
          issuedById: req.user?.id || null,
          previousBalance,
          grandTotal,
          amountPending: grandTotal,
        },
        include: invoiceInclude,
      });

      // Reference commission auto-flow — runs in the same transaction.
      // The updated invoice object carries the issued invoiceNumber/issuedAt/issuedById
      // that the engine uses for the Expense notes + provenance.
      commissionAutoFlow = await writeReferenceCommissionFlow(tx, updated, invoice.hospital);

      return updated;
    });

    const payload = toResponse(result);
    payload.commissionAutoFlow = commissionAutoFlow;
    res.json(payload);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.void = async (req, res) => {
  try {
    const id = req.params.id;
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { lineItems: true } });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'issued') return res.status(400).json({ message: `Cannot void from status '${invoice.status}'` });
    if ((invoice.amountPaid || 0) > 0) return res.status(400).json({ message: 'Cannot void an invoice with payments. Record a refund instead.' });

    const claimLines = invoice.lineItems.filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId);
    const reason = String(req.body?.reason || '').slice(0, 500);

    let commissionAutoFlow = { rowsRemoved: 0 };
    const result = await prisma.$transaction(async (tx) => {
      // Restore each claim's prior status (saved on the line item meta at issue time).
      // Falls back to 'settled' for any line missing the meta (shouldn't happen post-fix).
      for (const line of claimLines) {
        const priorStatus = line.meta?.priorStatus || 'settled';
        await tx.claim.update({
          where: { id: line.claimId },
          data: { isBilled: false, status: priorStatus },
        });
      }
      // Remove any auto-flow expense rows tied to this invoice
      commissionAutoFlow = await clearReferenceCommissionFlow(tx, id);
      return tx.invoice.update({
        where: { id },
        data: {
          status: 'void',
          voidedAt: new Date(),
          voidReason: reason,
        },
        include: invoiceInclude,
      });
    });

    const payload = toResponse(result);
    payload.commissionAutoFlow = commissionAutoFlow;
    res.json(payload);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.remove = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ message: 'Only drafts can be deleted' });
    await prisma.invoice.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Renders the *same* invoice PDF the issued/print flow uses, but for an
// in-progress draft from the Bulk Invoice wizard — nothing is persisted.
// Body shape: { hospitalId, month: 'YYYY-MM-01', lines: [{description, amount, lineType, claimId?}],
//               gstRate?, tdsRateId?, roundOff?, notes? }
exports.previewPdf = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, lines = [], gstRate, tdsRateId, roundOff, notes, discount } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month are required' });

    const hospital = await prisma.hospital.findUnique({
      where: { id: hospitalId },
      select: {
        id: true, name: true, address: true, city: true, state: true, pincode: true, phone: true,
      },
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });

    // GST + TDS resolution mirrors buildInvoiceLines: per-invoice override
    // wins, otherwise the site-wide defaults.
    const tpl = await getInvoiceTemplate();
    let effectiveGstRate = 0;
    if (gstRate !== undefined && gstRate !== null && gstRate !== '') {
      effectiveGstRate = Number(gstRate) || 0;
    } else {
      effectiveGstRate = Number(tpl.invoice_default_gst_rate) || 0;
    }

    const effectiveTdsRateId = tdsRateId || tpl.invoice_default_tds_rate_id || null;
    const tds = effectiveTdsRateId
      ? await resolveTdsRate(effectiveTdsRateId, 0)
      : { rate: 0, name: '', section: '' };

    // Previous balance = open prior invoices for the hospital.
    const priorOpen = await prisma.invoice.findMany({
      where: { hospitalId, status: { in: ['issued', 'partially_paid'] } },
      select: { amountPending: true },
    });
    const previousBalance = priorOpen.reduce((acc, r) => acc + (Number(r.amountPending) || 0), 0);

    const normalize = (l, idx) => ({
      lineType: l.lineType || 'manual',
      description: l.description || '',
      amount: Math.round(Number(l.amount) || 0),
      order: idx,
      claimId: l.claimId || null,
    });
    const allLines = lines.map(normalize);
    const tpaDeskLines = allLines.filter((l) => l.lineType === 'claim_tpa_desk' || l.lineType === 'service_percentage');
    const fixedServiceLines = allLines.filter((l) => l.lineType === 'service_fixed' || l.lineType === 'manual');
    const adjustmentLines = allLines.filter((l) => l.lineType === 'adjustment');

    const totals = calculateInvoiceTotals({
      tpaDeskLines, fixedServiceLines, adjustmentLines,
      gstRate: effectiveGstRate, tdsRate: tds.rate, previousBalance,
      discount,
    });

    const roundOffI = Math.round(Number(roundOff) || 0);
    const grandTotalWithRound = totals.grandTotal + roundOffI;
    const amountPending = grandTotalWithRound;

    // Shape an in-memory invoice object that matches what renderInvoicePdf reads.
    const fakeInvoice = {
      id: 'preview',
      invoiceNumber: null,
      status: 'draft',
      hospitalId,
      hospital,
      month,
      createdAt: new Date(),
      issuedAt: null,
      dueDate: null,
      notes: notes || '',
      gstRate: effectiveGstRate,
      gstAmount: totals.gstAmount,
      tdsRate: tds.rate,
      tdsAmount: totals.tdsAmount,
      tdsName: tds.name,
      tdsSection: tds.section,
      subtotalTpaDesk: totals.subtotalTpaDesk,
      subtotalServices: totals.subtotalServices,
      subtotalAdjust: totals.subtotalAdjust,
      gross: totals.gross,
      discount: totals.discount,
      netTotal: totals.netTotal,
      previousBalance: totals.previousBalance,
      roundOff: roundOffI,
      grandTotal: grandTotalWithRound,
      amountPaid: 0,
      amountPending,
      lineItems: allLines,
    };

    const template = await getInvoiceTemplate();
    const buf = await renderInvoicePdf(fakeInvoice, hospital, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="preview-${hospital.name.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ message: error.message || 'Server error' });
  }
};

exports.pdf = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: invoiceInclude,
    });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    const template = await getInvoiceTemplate();
    const buf = await renderInvoicePdf(invoice, invoice.hospital, template);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber || 'draft-' + invoice.id.slice(0, 8)}.pdf"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
