const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const calculateFilePrice = require('../utils/calculateFilePrice');
const calculateInvoiceTotals = require('../utils/calculateInvoiceTotals');
const { reserveNextInvoiceNumber } = require('../utils/invoiceSequence');
const renderInvoicePdf = require('../utils/renderInvoicePdf');
const { getInvoiceTemplate } = require('./siteSettingController');
const { writeReferenceCommissionFlow, clearReferenceCommissionFlow } = require('../utils/referenceCommissionFlow');
const { recomputeInvoicePaidStatus } = require('../utils/invoicePaidRollup');

// Rejected claims stay billable — the operator wants them on the hospital's
// invoice with whatever amount they resolve to (often ₹0 when finalApproval is 0)
// so the bill reflects work done regardless of outcome. Only 'cancelled' claims
// (withdrawn entirely) are excluded from bulk billing.
const EXCLUDED_CLAIM_STATUSES = ['cancelled'];

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
const buildInvoiceLines = async (hospitalId, month, { adjustments = [], tdsRateId, gstRateOverride, claimIds, discount = 0, isDirectPatient = false } = {}) => {
  // For direct-patient invoices the claims have no hospital relation of
  // their own — `hospitalId` is the chosen *target* hospital (used for
  // billing services + template lookups). The claim query must skip the
  // hospitalId filter in that case; the caller is expected to pre-validate
  // the claim IDs all belong together (isDirectPatient=true, same month).
  const claimWhere = {
    ...(isDirectPatient ? {} : { hospitalId }),
    dateOfDischarge: { gte: month, lt: monthEnd(month) },
    isBilled: false,
    status: { notIn: EXCLUDED_CLAIM_STATUSES },
    ...(isDirectPatient ? { isDirectPatient: true } : {}),
  };
  if (Array.isArray(claimIds) && claimIds.length) {
    claimWhere.id = { in: claimIds };
  }

  // All four reads below are independent — fire them in parallel so the
  // controller pays one network roundtrip's latency instead of four. On the
  // common 50-claim invoice this trims ~30-40% off the buildInvoiceLines
  // wall-clock time.
  const [hospital, claims, priorOpen, tpl] = await Promise.all([
    prisma.hospital.findUnique({
      where: { id: hospitalId },
      include: { billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } } },
    }),
    prisma.claim.findMany({
      where: claimWhere,
      select: {
        id: true, patientName: true, ccnNo: true, hospitalFinalBill: true, finalApprovalAmount: true,
        filePrice: true, filePriceOverridden: true,
      },
    }),
    // Previous balance only counts dues from the SAME stream — regular
    // invoices ignore direct-patient dues and vice versa. The hospital on
    // a direct-patient invoice is purely a billing-template reference, not
    // a financial relationship.
    prisma.invoice.findMany({
      where: {
        hospitalId,
        status: { in: ['issued', 'partially_paid'] },
        isDirectPatient,
      },
      select: { amountPending: true },
    }),
    getInvoiceTemplate(),
  ]);
  if (!hospital) {
    const err = new Error('Hospital not found');
    err.status = 404;
    throw err;
  }

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

  const fixedServiceLines = fixedSvcRowsAll.map((s) => {
    const isOneTime = s.billingType === 'fixed_onetime';
    const isInsWise = Boolean(s.overLimitInsuranceWise);
    const insurerIds = Array.isArray(s.overLimitInsurerIds) ? s.overLimitInsurerIds : [];
    // For fixed_onetime + Insurance Wise: the configured amount is the
    // per-company fee (e.g. empanelment tie-up). Multiply by the number of
    // selected insurance companies. The same flag on fixed_monthly drives a
    // different feature (over-limit insurer filter), so we don't multiply.
    const companyCount = (isOneTime && isInsWise) ? insurerIds.length : 0;
    const perAmount = Number(s.fixedAmount) || 0;
    const amount = companyCount > 0 ? perAmount * companyCount : perAmount;
    const billingLabel = isOneTime ? 'One-time' : 'Monthly';
    const description = companyCount > 0
      ? `${s.serviceName} — ${billingLabel} (${companyCount} companies × ₹${perAmount.toLocaleString('en-IN')})`
      : `${s.serviceName} — ${billingLabel}`;
    return {
      lineType: 'service_fixed',
      description,
      amount,
      order: order++,
      claimId: null,
      billingServiceId: s.id,
      billingServiceNameId: fixedNameMap.get(s.serviceName) || null,
      meta: {
        billingType: s.billingType,
        ...(companyCount > 0 ? { perCompanyAmount: perAmount, companyCount } : {}),
      },
    };
  });

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

  // 4. Previous balance = Σ amountPending of issued|partially_paid prior
  //    invoices for this hospital. `priorOpen` was fetched in parallel above.
  const previousBalance = priorOpen.reduce((acc, r) => acc + (Number(r.amountPending) || 0), 0);

  // Resolve TDS + GST: per-invoice override wins, otherwise the site-wide
  // default from Settings → Tax & Numbering Defaults. The per-hospital
  // gstRate/tdsRate/tdsRateId columns were retired 2026-06-16 — both are
  // platform-wide now. `tpl` was fetched in parallel above.
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
    // Surface the resolved template so callers (create, issue) can reuse it
    // without a second getInvoiceTemplate roundtrip.
    template: tpl,
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
        isDirectPatient: true,
      },
    });

    const skipped = [];
    const hospitalClaims = [];
    const directPatientClaims = [];
    for (const c of allSelected) {
      if (c.isBilled) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'already billed' });
      } else if (EXCLUDED_CLAIM_STATUSES.includes(c.status)) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: c.status });
      } else if (!c.dateOfDischarge) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'no discharge date' });
      } else if (c.isDirectPatient) {
        // Direct-patient claims are billable, but only once the operator
        // picks a target hospital in the drawer. They flow into their own
        // grouping bucket below.
        directPatientClaims.push(c);
      } else if (!c.hospitalId) {
        skipped.push({ id: c.id, srNo: c.srNo, patientName: c.patientName, reason: 'no hospital' });
      } else {
        hospitalClaims.push(c);
      }
    }

    if (!hospitalClaims.length && !directPatientClaims.length) {
      return res.status(400).json({
        message: 'No billable claims in selection',
        skipped,
      });
    }

    // Group by hospitalId + month (UTC year-month) → list of claimIds.
    const groups = new Map();
    for (const c of hospitalClaims) {
      const d = new Date(c.dateOfDischarge);
      const monthKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
      const key = `${c.hospitalId}|${monthKey}`;
      if (!groups.has(key)) groups.set(key, { hospitalId: c.hospitalId, month: new Date(monthKey), claimIds: [] });
      groups.get(key).claimIds.push(c.id);
    }

    // Group direct-patient claims by month — they have no required hospital,
    // so the operator usually picks a target hospital in the UI. But direct-
    // patient claims can carry a hospitalId from claim creation; if every
    // claim in the group shares the same one, surface it as a suggestion so
    // the drawer can auto-resolve without prompting.
    const directGroups = new Map();
    for (const c of directPatientClaims) {
      const d = new Date(c.dateOfDischarge);
      const monthKey = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
      const key = `direct|${monthKey}`;
      if (!directGroups.has(key)) {
        directGroups.set(key, {
          month: new Date(monthKey),
          claimIds: [],
          hospitalIdHints: new Set(),
        });
      }
      const g = directGroups.get(key);
      g.claimIds.push(c.id);
      if (c.hospitalId) g.hospitalIdHints.add(c.hospitalId);
    }

    // Build a preview for each group (sequential — we hit Prisma per group anyway).
    const previews = [];
    for (const g of groups.values()) {
      const built = await buildInvoiceLines(g.hospitalId, g.month, { tdsRateId, gstRateOverride: gstRate, claimIds: g.claimIds });
      // Detect non-voided invoices that already exist for this (hospital,
      // month) so the UI can warn the operator before they try to commit.
      // Uniqueness is enforced via a partial unique index (status <> 'void'),
      // so this mirrors the same predicate via findFirst.
      const existing = await prisma.invoice.findFirst({
        where: { hospitalId: g.hospitalId, month: g.month, status: { not: 'void' } },
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

    // Emit a placeholder card per direct-patient month group. No lines /
    // totals yet — the UI must collect the target hospital from the
    // operator and POST /invoices/preview-direct-patient to fill them in.
    // `suggestedHospitalId` is set when every claim in the group already
    // carries the same hospitalId (from claim creation) so the drawer can
    // auto-resolve instead of prompting.
    for (const g of directGroups.values()) {
      const suggested = g.hospitalIdHints.size === 1
        ? [...g.hospitalIdHints][0]
        : null;
      previews.push({
        hospitalId: null,
        hospital: null,
        month: g.month,
        claimIds: g.claimIds,
        lines: [],
        totals: null,
        hasContent: false,
        existingInvoice: null,
        isDirectPatient: true,
        requiresHospitalPick: true,
        suggestedHospitalId: suggested,
      });
    }

    // Stable ordering: month asc, then hospital name asc. Direct-patient
    // cards (no hospital name) sort to the end of their month.
    previews.sort((a, b) => {
      const m = new Date(a.month) - new Date(b.month);
      if (m !== 0) return m;
      if (a.isDirectPatient !== b.isDirectPatient) return a.isDirectPatient ? 1 : -1;
      return (a.hospital?.name || '').localeCompare(b.hospital?.name || '');
    });

    res.json({ previews, skipped });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

// Build a preview for direct-patient claims against a chosen target hospital.
// Mirrors `preview` but takes the supplied hospital as the billing reference
// (slabs, GST/TDS, etc.) — the claims themselves carry no hospital relation.
exports.previewDirectPatient = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, claimIds, tdsRateId, gstRate, discount } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) {
      return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });
    }
    if (!Array.isArray(claimIds) || !claimIds.length) {
      return res.status(400).json({ message: 'claimIds (non-empty array) is required' });
    }
    const built = await buildInvoiceLines(hospitalId, month, {
      tdsRateId, gstRateOverride: gstRate, claimIds, discount, isDirectPatient: true,
    });
    res.json({
      hospitalId,
      hospital: toResponse(built.hospital),
      month,
      claimIds,
      lines: built.lines,
      totals: built.totals,
      hasContent: built.lines.length > 0,
      isDirectPatient: true,
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.create = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, notes, adjustments, tdsRateId, gstRate, claimIds, discount, manualItems, isDirectPatient } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });

    // Uniqueness is enforced via a partial unique index (status <> 'void'),
    // so findFirst with the same predicate stands in for findUnique here.
    // Direct-patient invoices live in a separate slot per hospital+month —
    // they don't conflict with a regular invoice for the same hospital+month.
    const isDirectPatientInvoice = !!isDirectPatient;
    const existing = await prisma.invoice.findFirst({
      where: { hospitalId, month, isDirectPatient: isDirectPatientInvoice, status: { not: 'void' } },
      include: invoiceInclude,
    });
    if (existing && existing.status !== 'draft') {
      return res.status(409).json({ message: `Invoice already ${existing.status} for this hospital and month`, invoice: toResponse(existing) });
    }

    // Normalise manualItems passed alongside create — these let an operator
    // bill a month that has no claims/fixed services (e.g. a one-off charge).
    const normalisedManual = (Array.isArray(manualItems) ? manualItems : [])
      .map((m) => ({
        description: String(m?.description || '').slice(0, 300).trim(),
        amount: Math.round(Number(m?.amount) || 0),
      }))
      .filter((m) => m.description);

    // If a draft already exists, the wizard either re-submitted or this is a
    // recovery save after an earlier partial commit. Hand back the existing
    // draft unless it's empty AND the wizard is sending manual items — in that
    // case, populate the empty draft so the operator's save isn't lost.
    if (existing && existing.status === 'draft') {
      const isEmpty = !(existing.lineItems || []).length;
      if (!(isEmpty && normalisedManual.length)) {
        return res.status(200).json(toResponse(existing));
      }
    }

    const built = await buildInvoiceLines(hospitalId, month, { adjustments, tdsRateId, gstRateOverride: gstRate, claimIds, discount, isDirectPatient: isDirectPatientInvoice });
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

    const persistedData = {
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
      isDirectPatient: isDirectPatientInvoice,
    };

    const invoice = await prisma.$transaction(async (tx) => {
      // Recovery path: populate the existing empty draft. Keep its existing
      // invoiceNumber (if any) — don't burn a new sequence slot.
      if (existing) {
        return tx.invoice.update({
          where: { id: existing.id },
          data: {
            ...persistedData,
            notes: notes || existing.notes || '',
            lineItems: { create: allLines },
          },
          include: invoiceInclude,
        });
      }
      // Reserve the next sequential invoice number on draft creation so the
      // operator sees a real number instead of "Draft-XXX". The configured
      // prefix in Site Settings drives the format — its trailing digits act
      // as a seed and each new invoice increments by 1 (see invoiceSequence).
      // Number is final and survives draft → issued; deleted drafts leave a
      // gap in the sequence, which matches typical Indian invoicing practice.
      // Template is reused from `built` so we don't pay a second roundtrip.
      const invoicePrefix = built.template?.invoice_number_prefix || 'FCC';
      const invoiceNumber = await reserveNextInvoiceNumber(tx, invoicePrefix);
      return tx.invoice.create({
        data: {
          hospitalId,
          month,
          status: 'draft',
          invoiceNumber,
          notes: notes || '',
          ...persistedData,
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

// Returns distinct hospitals that currently have at least one issued /
// partially-paid invoice with a non-zero pending balance. Used by the
// "Open Invoice Hospitals" quick-filter dropdown on the listing page.
// Aggregates count + sum of pending so the UI can show both per hospital
// without a second roundtrip.
exports.openHospitals = async (req, res) => {
  try {
    const grouped = await prisma.invoice.groupBy({
      by: ['hospitalId'],
      where: {
        status: { in: ['issued', 'partially_paid'] },
        amountPending: { gt: 0 },
      },
      _count: { _all: true },
      _sum: { amountPending: true },
    });
    const ids = grouped.map((g) => g.hospitalId).filter(Boolean);
    if (!ids.length) return res.json({ hospitals: [] });
    const hospitals = await prisma.hospital.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const byId = new Map(hospitals.map((h) => [h.id, h]));
    const out = grouped
      .map((g) => ({
        _id: g.hospitalId,
        name: byId.get(g.hospitalId)?.name || 'Unknown',
        openCount: g._count._all,
        totalPending: Math.round(g._sum.amountPending || 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({ hospitals: out });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.list = async (req, res) => {
  try {
    const { hospitalId, status, month, page, limit = 25, isDirectPatient } = req.query;
    const where = {};
    if (hospitalId) where.hospitalId = hospitalId;
    // Synthetic '__open' matches anything still owed: issued or partially
    // paid with a non-zero pending balance. Used by the "Hospitals with
    // Open Invoices" shortcut on the listing page.
    if (status === '__open') {
      where.status = { in: ['issued', 'partially_paid'] };
      where.amountPending = { gt: 0 };
    } else if (status) {
      where.status = status;
    }
    if (month) {
      const m = parseMonth(month);
      if (m) where.month = m;
    }
    // Direct-patient invoices live on their own stream — accept an explicit
    // filter ('true' | 'false') so the UI can show either side cleanly. If
    // omitted, both kinds are returned (existing behaviour for the all-
    // invoices listing).
    if (isDirectPatient === 'true') where.isDirectPatient = true;
    else if (isDirectPatient === 'false') where.isDirectPatient = false;
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
    if (invoice.status === 'void') return res.status(400).json({ message: 'Voided invoices cannot be edited' });

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

    const hasAnyChange =
      fullRebuild ||
      tdsChanged ||
      gstChanged ||
      discountChanged ||
      roundOff !== undefined ||
      notes !== undefined ||
      Array.isArray(lineEdits) ||
      Array.isArray(manualItems) ||
      Array.isArray(removedLineIds);
    if (!hasAnyChange) return res.json(toResponse(invoice));

    // --- Full rebuild path (adjustments[] sent) ---
    // Wipes line items and regenerates them from the source claims.
    // Used by the original wizard "Save Draft" flow that re-derives everything.
    if (fullRebuild) {
      const built = await buildInvoiceLines(invoice.hospitalId, invoice.month, { adjustments, tdsRateId: tdsResolvedId, gstRateOverride: gstResolved, discount: discountResolved });
      const updated = await prisma.$transaction(async (tx) => {
        await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(notes !== undefined ? { notes: String(notes || '') } : {}),
            ...(roundOff !== undefined ? { roundOff: Math.round(Number(roundOff) || 0) } : {}),
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
            lineItems: { create: built.lines },
          },
        });
        await recomputeInvoicePaidStatus(tx, invoice.id);
        return tx.invoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude });
      });
      return res.json(toResponse(updated));
    }

    // --- Incremental path: apply partial line edits + setting changes, then
    // recompute totals from the final line set. Replaces the old mutually
    // exclusive Path 1/Path 2 split where sending tdsRateId alongside a manual
    // item silently dropped the manual item.
    const validIds = new Set(invoice.lineItems.map((l) => l.id));
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Apply line-item operations first so the recompute at the end sees
      //    the final set of rows.
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

      // 2. Apply settings changes. TDS change pulls the new rate/section so
      //    recomputeInvoiceFromLines uses the updated value.
      const settingsData = {};
      if (notes !== undefined) settingsData.notes = String(notes || '');
      if (roundOff !== undefined) settingsData.roundOff = Math.round(Number(roundOff) || 0);
      if (gstChanged) settingsData.gstRate = gstResolved;
      if (discountChanged) settingsData.discount = discountResolved;
      if (tdsChanged) {
        const tds = await resolveTdsRate(tdsResolvedId, 0);
        settingsData.tdsRateId = tdsResolvedId;
        settingsData.tdsRate = tds.rate;
        settingsData.tdsName = tds.name;
        settingsData.tdsSection = tds.section;
      }
      if (Object.keys(settingsData).length) {
        await tx.invoice.update({ where: { id: invoice.id }, data: settingsData });
      }

      // 3. Always recompute totals from the final line set so gross/GST/TDS/
      //    grandTotal/amountPending stay consistent with what was persisted.
      await recomputeInvoiceFromLines(tx, invoice.id);
      // 4. Re-derive payment status (paid / partially_paid / issued) in case the
      //    grandTotal moved relative to amountPaid. draft and void are left alone.
      await recomputeInvoicePaidStatus(tx, invoice.id);
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
      // Recompute previousBalance at issue time (drift safety). Scope to
      // the same stream — regular invoices ignore direct-patient dues and
      // vice versa.
      const priorOpen = await tx.invoice.findMany({
        where: {
          hospitalId: invoice.hospitalId,
          isDirectPatient: invoice.isDirectPatient,
          status: { in: ['issued', 'partially_paid'] },
          id: { not: invoice.id },
        },
        select: { amountPending: true },
      });
      const previousBalance = priorOpen.reduce((acc, r) => acc + (Number(r.amountPending) || 0), 0);
      const grandTotal = (invoice.netTotal || 0) + previousBalance;

      // Drafts created via exports.create already hold a reserved
      // invoiceNumber. Reserve a fresh one only for legacy drafts that
      // pre-date that change (invoiceNumber === null).
      let invoiceNumber = invoice.invoiceNumber;
      if (!invoiceNumber) {
        const invoiceTemplate = await getInvoiceTemplate();
        const invoicePrefix = invoiceTemplate.invoice_number_prefix || 'FCC';
        invoiceNumber = await reserveNextInvoiceNumber(tx, invoicePrefix);
      }

      // Flip linked claims to 'billed' and record their prior status on the
      // line item so a void can roll the claim back to where it was.
      // The previous implementation awaited two updates per claim
      // sequentially — 100+ roundtrips for a 50-claim invoice. We now batch
      // each kind of write into a single Promise.all so the transaction
      // pipelines the operations on its connection. Updates that share a
      // shape (e.g. all `claim.status='billed'`) collapse further via
      // updateMany.
      if (claimIds.length) {
        const claims = await tx.claim.findMany({
          where: { id: { in: claimIds } },
          select: { id: true, status: true, filePriceOverridden: true },
        });

        // 1. Line-item meta updates carry per-row priorStatus, so they must
        //    remain per-row. Issue them in parallel.
        const lineMetaTasks = claims
          .map((c) => {
            const line = invoice.lineItems.find((l) => l.claimId === c.id);
            if (!line) return null;
            return tx.invoiceLineItem.update({
              where: { id: line.id },
              data: { meta: { ...(line.meta || {}), priorStatus: c.status } },
            });
          })
          .filter(Boolean);

        // 2. Claim status + isBilled is identical for every linked claim —
        //    collapse into one updateMany.
        const claimStatusTask = tx.claim.updateMany({
          where: { id: { in: claims.map((c) => c.id) } },
          data: { isBilled: true, status: 'billed' },
        });

        // 3. filePrice is per-row but only applies to non-overridden claims.
        //    Run those updates in parallel too.
        const filePriceTasks = claims
          .filter((c) => !c.filePriceOverridden)
          .map((c) => {
            const line = invoice.lineItems.find((l) => l.claimId === c.id);
            if (!line) return null;
            return tx.claim.update({
              where: { id: c.id },
              data: { filePrice: line.amount },
            });
          })
          .filter(Boolean);

        await Promise.all([claimStatusTask, ...lineMetaTasks, ...filePriceTasks]);
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
    // Drafts and void invoices are both safe to hard-delete: drafts have no
    // claim-side effects yet, and void has already rolled the claim statuses
    // back. Anything else (issued / partially_paid / paid) must be cancelled
    // (voided) first so the rollback runs.
    if (invoice.status !== 'draft' && invoice.status !== 'void') {
      return res.status(400).json({ message: 'Cancel the invoice before deleting it' });
    }
    if ((invoice.amountPaid || 0) > 0) {
      return res.status(400).json({ message: 'Cannot delete an invoice with recorded payments' });
    }
    await prisma.$transaction(async (tx) => {
      // Null out any cash/bank entries that still reference this invoice
      // (typically refunds linked to a void invoice) so we don't violate FKs.
      await tx.cashBankEntry.updateMany({
        where: { invoiceId: invoice.id },
        data: { invoiceId: null },
      });
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
      await tx.invoice.delete({ where: { id: invoice.id } });
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Bulk nuke — mirrors the Delete All Claims affordance. Any invoice still
// in 'issued' / 'partially_paid' / 'paid' is voided first (rolls back its
// claim statuses and clears the auto-commission expense), then everything
// is hard-deleted. Refuses if anything has recorded payments because that
// would orphan real cash/bank entries.
exports.removeAll = async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE_ALL') {
      return res.status(400).json({ message: 'Confirmation required' });
    }
    const invoices = await prisma.invoice.findMany({
      select: { id: true, status: true, amountPaid: true },
    });
    if (invoices.length === 0) {
      return res.json({ message: 'No invoices to delete', count: 0 });
    }
    const paid = invoices.filter((i) => (i.amountPaid || 0) > 0);
    if (paid.length > 0) {
      return res.status(400).json({
        message: `${paid.length} invoice(s) have recorded payments — record refunds or remove payments first`,
      });
    }
    const needsVoid = invoices.filter((i) => i.status !== 'draft' && i.status !== 'void');

    await prisma.$transaction(async (tx) => {
      // Roll back claim statuses + commission expenses for any non-draft,
      // non-void invoices, mirroring exports.void per-invoice logic.
      for (const inv of needsVoid) {
        const lineItems = await tx.invoiceLineItem.findMany({
          where: { invoiceId: inv.id, lineType: 'claim_tpa_desk', NOT: { claimId: null } },
          select: { claimId: true, meta: true },
        });
        for (const line of lineItems) {
          const priorStatus = line.meta?.priorStatus || 'settled';
          await tx.claim.update({
            where: { id: line.claimId },
            data: { isBilled: false, status: priorStatus },
          });
        }
        await clearReferenceCommissionFlow(tx, inv.id);
      }
      const ids = invoices.map((i) => i.id);
      await tx.cashBankEntry.updateMany({
        where: { invoiceId: { in: ids } },
        data: { invoiceId: null },
      });
      await tx.invoiceLineItem.deleteMany({ where: { invoiceId: { in: ids } } });
      await tx.invoice.deleteMany({ where: { id: { in: ids } } });
    });

    res.json({ message: `${invoices.length} invoice(s) deleted`, count: invoices.length });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Renders the *same* invoice PDF the issued/print flow uses, but for an
// in-progress draft from the Bulk Invoice wizard — nothing is persisted.
// Body shape: { hospitalId, month: 'YYYY-MM-01', lines: [{description, amount, lineType, claimId?}],
//               gstRate?, tdsRateId?, roundOff?, notes? }
exports.previewPdf = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, lines = [], gstRate, tdsRateId, roundOff, notes, discount, isDirectPatient } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month are required' });
    const isDirectPatientPreview = !!isDirectPatient;

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

    // Previous balance = open prior invoices for the hospital on the same
    // stream (regular vs direct-patient — they don't mix).
    const priorOpen = await prisma.invoice.findMany({
      where: {
        hospitalId,
        isDirectPatient: isDirectPatientPreview,
        status: { in: ['issued', 'partially_paid'] },
      },
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

    // Same claim hydration as the issued-invoice PDF endpoint so the preview
    // reflects the operator's chosen summary columns.
    const previewClaimIds = allLines
      .filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId)
      .map((l) => l.claimId);
    const previewClaims = previewClaimIds.length
      ? await prisma.claim.findMany({
          where: { id: { in: previewClaimIds } },
          include: {
            hospital:         { select: { id: true, name: true } },
            insuranceCompany: { select: { id: true, name: true } },
            tpa:              { select: { id: true, name: true } },
          },
        })
      : [];
    const previewClaimsById = new Map(previewClaims.map((c) => [c.id, c]));

    const buf = await renderInvoicePdf(fakeInvoice, hospital, template, { claimsById: previewClaimsById });
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

    // Pull the full claim records for every claim_tpa_desk line so the Claims
    // Summary table on page 2 can render any column the operator picked in
    // the column-picker modal.
    const claimIds = (invoice.lineItems || [])
      .filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId)
      .map((l) => l.claimId);
    const claims = claimIds.length
      ? await prisma.claim.findMany({
          where: { id: { in: claimIds } },
          include: {
            hospital:         { select: { id: true, name: true } },
            insuranceCompany: { select: { id: true, name: true } },
            tpa:              { select: { id: true, name: true } },
          },
        })
      : [];
    const claimsById = new Map(claims.map((c) => [c.id, c]));

    const buf = await renderInvoicePdf(invoice, invoice.hospital, template, { claimsById });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber || 'draft-' + invoice.id.slice(0, 8)}.pdf"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
