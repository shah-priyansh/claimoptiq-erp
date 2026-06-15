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
  hospital: { select: { id: true, name: true, address: true, city: true, state: true, pincode: true, phone: true, gstRate: true, tdsRate: true, invoicePrefix: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  issuedBy: { select: { id: true, name: true, email: true } },
  tdsRateMaster: { select: { id: true, taxName: true, rate: true, section: true } },
  lineItems: { orderBy: { order: 'asc' } },
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
const buildInvoiceLines = async (hospitalId, month, { adjustments = [], tdsRateId, gstRateOverride } = {}) => {
  const hospital = await prisma.hospital.findUnique({
    where: { id: hospitalId },
    include: {
      billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
      tdsRateMaster: { select: { id: true, taxName: true, rate: true, section: true, isActive: true } },
    },
  });
  if (!hospital) {
    const err = new Error('Hospital not found');
    err.status = 404;
    throw err;
  }

  const claims = await prisma.claim.findMany({
    where: {
      hospitalId,
      dateOfDischarge: { gte: month, lt: monthEnd(month) },
      isBilled: false,
      status: { notIn: EXCLUDED_CLAIM_STATUSES },
    },
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

  // Resolve TDS: per-invoice override wins, else the hospital's default master row,
  // else the legacy hospital.tdsRate float.
  const effectiveTdsRateId = tdsRateId || hospital.tdsRateId || null;
  const tds = effectiveTdsRateId
    ? await resolveTdsRate(effectiveTdsRateId, hospital.tdsRate)
    : { rate: hospital.tdsRate || 0, name: '', section: '' };

  // Resolve GST: explicit per-invoice override (operator typed it) wins, then
  // the site-wide default from Settings → Invoice Template (the 'master'), then
  // the legacy per-hospital gstRate field as a last resort, else 0.
  // The site default sits ABOVE hospital.gstRate so that updating the master
  // setting propagates to every new invoice without per-hospital cleanup.
  let effectiveGstRate = 0;
  if (gstRateOverride !== undefined && gstRateOverride !== null && gstRateOverride !== '') {
    effectiveGstRate = Number(gstRateOverride) || 0;
  } else {
    const tpl = await getInvoiceTemplate();
    const siteDefault = Number(tpl.invoice_default_gst_rate) || 0;
    if (siteDefault > 0) {
      effectiveGstRate = siteDefault;
    } else if (hospital.gstRate) {
      effectiveGstRate = Number(hospital.gstRate) || 0;
    }
  }

  const totals = calculateInvoiceTotals({
    tpaDeskLines,
    fixedServiceLines,
    adjustmentLines,
    gstRate: effectiveGstRate,
    tdsRate: tds.rate,
    previousBalance,
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
    const { hospitalId, month: rawMonth, adjustments, tdsRateId, gstRate } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });
    const built = await buildInvoiceLines(hospitalId, month, { adjustments, tdsRateId, gstRateOverride: gstRate });
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

exports.create = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, notes, adjustments, tdsRateId, gstRate } = req.body;
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

    const built = await buildInvoiceLines(hospitalId, month, { adjustments, tdsRateId, gstRateOverride: gstRate });
    if (!built.lines.length) {
      return res.status(400).json({ message: 'No claims or fixed services found for this month. Nothing to invoice.' });
    }

    const invoice = await prisma.$transaction(async (tx) => {
      return tx.invoice.create({
        data: {
          hospitalId,
          month,
          status: 'draft',
          notes: notes || '',
          gstRate: built.totals.gstRate,
          gstAmount: built.totals.gstAmount,
          tdsRate: built.totals.tdsRate,
          tdsAmount: built.totals.tdsAmount,
          tdsRateId: built.totals.tdsRateId,
          tdsName: built.totals.tdsName,
          tdsSection: built.totals.tdsSection,
          subtotalTpaDesk: built.totals.subtotalTpaDesk,
          subtotalServices: built.totals.subtotalServices,
          subtotalAdjust: built.totals.subtotalAdjust,
          gross: built.totals.gross,
          netTotal: built.totals.netTotal,
          previousBalance: built.totals.previousBalance,
          grandTotal: built.totals.grandTotal,
          amountPending: built.totals.amountPending,
          createdById: req.user?.id || null,
          lineItems: { create: built.lines },
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
        include: invoiceInclude,
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
// Applies tdsRate, gstRate, roundOff, previousBalance, amountPaid → grandTotal + amountPending.
const recomputeInvoiceFromLines = async (tx, invoiceId) => {
  const inv = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, hospitalId: true, gstRate: true, tdsRate: true, roundOff: true,
      amountPaid: true, previousBalance: true,
      lineItems: { select: { lineType: true, amount: true } },
    },
  });
  if (!inv) return;
  const sumBy = (type) => inv.lineItems.filter((l) => l.lineType === type).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const tpa = sumBy('claim_tpa_desk') + sumBy('service_percentage');
  const services = sumBy('service_fixed') + sumBy('manual');
  const adjust = sumBy('adjustment');
  const gross = Math.round(tpa + services + adjust);
  const gstAmount = Math.round((gross * (inv.gstRate || 0)) / 100);
  const tdsAmount = Math.round((gross * (inv.tdsRate || 0)) / 100);
  const netTotal = gross + gstAmount - tdsAmount;
  const grandTotal = netTotal + (inv.previousBalance || 0) + (inv.roundOff || 0);
  const amountPending = Math.round(grandTotal - (inv.amountPaid || 0));
  await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      subtotalTpaDesk: Math.round(tpa),
      subtotalServices: Math.round(services),
      subtotalAdjust: Math.round(adjust),
      gross,
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
      roundOff,
    } = req.body;

    const tdsChanged = tdsRateId !== undefined;
    const gstChanged = gstRate !== undefined;
    const fullRebuild = Array.isArray(adjustments);
    const tdsResolvedId = tdsChanged ? (tdsRateId || null) : invoice.tdsRateId;
    const gstResolved = gstChanged ? (Math.max(0, Number(gstRate) || 0)) : invoice.gstRate;
    const partialEdit =
      Array.isArray(lineEdits) ||
      Array.isArray(manualItems) ||
      Array.isArray(removedLineIds) ||
      roundOff !== undefined ||
      gstChanged;

    // --- Path 1: a full rebuild (adjustments[] sent) ---
    // Keeps the existing behaviour for the original 'Save Draft' flow that
    // wipes the line items and regenerates them from the source claims.
    if (fullRebuild || tdsChanged || notes !== undefined) {
      const built = await buildInvoiceLines(invoice.hospitalId, invoice.month, { adjustments, tdsRateId: tdsResolvedId, gstRateOverride: gstResolved });
      const updated = await prisma.$transaction(async (tx) => {
        if (fullRebuild) {
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
        }
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(notes !== undefined ? { notes: String(notes || '') } : {}),
            ...(roundOff !== undefined ? { roundOff: Math.round(Number(roundOff) || 0) } : {}),
            ...((fullRebuild || tdsChanged)
              ? {
                  subtotalTpaDesk: built.totals.subtotalTpaDesk,
                  subtotalServices: built.totals.subtotalServices,
                  subtotalAdjust: built.totals.subtotalAdjust,
                  gross: built.totals.gross,
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
        // Round-off makes the persisted grandTotal drift from built.totals; recompute
        // from the actual line items to keep it consistent.
        if ((roundOff !== undefined || gstChanged) && !fullRebuild && !tdsChanged) {
          await recomputeInvoiceFromLines(tx, invoice.id);
        }
        return tx.invoice.findUnique({ where: { id: invoice.id }, include: invoiceInclude });
      });
      return res.json(toResponse(updated));
    }

    // --- Path 2: partial edits on existing line items + round-off ---
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
      if (roundOff !== undefined || gstChanged) {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(roundOff !== undefined ? { roundOff: Math.round(Number(roundOff) || 0) } : {}),
            ...(gstChanged ? { gstRate: gstResolved } : {}),
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

      // Reserve invoice number atomically
      const invoiceNumber = await reserveNextInvoiceNumber(tx, invoice.hospital.invoicePrefix || 'FCC', issuedAt);

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
