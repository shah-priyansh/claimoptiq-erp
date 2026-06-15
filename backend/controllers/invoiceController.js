const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const calculateFilePrice = require('../utils/calculateFilePrice');
const calculateInvoiceTotals = require('../utils/calculateInvoiceTotals');
const { reserveNextInvoiceNumber } = require('../utils/invoiceSequence');
const renderInvoicePdf = require('../utils/renderInvoicePdf');

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
  lineItems: { orderBy: { order: 'asc' } },
};

// Build the line items + totals for a (hospital, month) without persisting.
// Returns { lines, totals, hospital, claims }.
const buildInvoiceLines = async (hospitalId, month, { adjustments = [] } = {}) => {
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

  const totals = calculateInvoiceTotals({
    tpaDeskLines,
    fixedServiceLines,
    adjustmentLines,
    gstRate: hospital.gstRate || 0,
    tdsRate: hospital.tdsRate || 0,
    previousBalance,
  });

  return {
    hospital,
    claims,
    lines: [...tpaDeskLines, ...fixedServiceLines, ...adjustmentLines],
    totals: { ...totals, gstRate: hospital.gstRate || 0, tdsRate: hospital.tdsRate || 0 },
  };
};

exports.preview = async (req, res) => {
  try {
    const { hospitalId, month: rawMonth, adjustments } = req.body;
    const month = parseMonth(rawMonth);
    if (!hospitalId || !month) return res.status(400).json({ message: 'hospitalId and month (YYYY-MM-01) are required' });
    const built = await buildInvoiceLines(hospitalId, month, { adjustments });
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
    const { hospitalId, month: rawMonth, notes, adjustments } = req.body;
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

    const built = await buildInvoiceLines(hospitalId, month, { adjustments });
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

exports.update = async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ message: 'Only drafts can be edited' });

    const { notes, adjustments } = req.body;

    // If adjustments provided, rebuild the whole invoice (drift-safe).
    if (Array.isArray(adjustments) || notes !== undefined) {
      const built = await buildInvoiceLines(invoice.hospitalId, invoice.month, { adjustments });
      const updated = await prisma.$transaction(async (tx) => {
        if (Array.isArray(adjustments)) {
          await tx.invoiceLineItem.deleteMany({ where: { invoiceId: invoice.id } });
        }
        return tx.invoice.update({
          where: { id: invoice.id },
          data: {
            ...(notes !== undefined ? { notes: String(notes || '') } : {}),
            ...(Array.isArray(adjustments)
              ? {
                  subtotalTpaDesk: built.totals.subtotalTpaDesk,
                  subtotalServices: built.totals.subtotalServices,
                  subtotalAdjust: built.totals.subtotalAdjust,
                  gross: built.totals.gross,
                  gstRate: built.totals.gstRate,
                  gstAmount: built.totals.gstAmount,
                  tdsRate: built.totals.tdsRate,
                  tdsAmount: built.totals.tdsAmount,
                  netTotal: built.totals.netTotal,
                  previousBalance: built.totals.previousBalance,
                  grandTotal: built.totals.grandTotal,
                  amountPending: built.totals.grandTotal - (invoice.amountPaid || 0),
                  lineItems: { create: built.lines },
                }
              : {}),
          },
          include: invoiceInclude,
        });
      });
      return res.json(toResponse(updated));
    }

    res.json(toResponse(invoice));
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ message: error.message || 'Server error' });
  }
};

exports.issue = async (req, res) => {
  try {
    const id = req.params.id;
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { hospital: true, lineItems: true } });
    if (!invoice) return res.status(404).json({ message: 'Not found' });
    if (invoice.status !== 'draft') return res.status(400).json({ message: `Cannot issue from status '${invoice.status}'` });

    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 15 * 24 * 60 * 60 * 1000);

    const claimIds = invoice.lineItems.filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId).map((l) => l.claimId);

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

      // Flip linked claims
      if (claimIds.length) {
        const claims = await tx.claim.findMany({ where: { id: { in: claimIds } }, select: { id: true, filePriceOverridden: true } });
        for (const c of claims) {
          const line = invoice.lineItems.find((l) => l.claimId === c.id);
          await tx.claim.update({
            where: { id: c.id },
            data: {
              isBilled: true,
              ...(c.filePriceOverridden ? {} : { filePrice: line ? line.amount : undefined }),
            },
          });
        }
      }

      return tx.invoice.update({
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
    });

    res.json(toResponse(result));
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

    const claimIds = invoice.lineItems.filter((l) => l.lineType === 'claim_tpa_desk' && l.claimId).map((l) => l.claimId);
    const reason = String(req.body?.reason || '').slice(0, 500);

    const result = await prisma.$transaction(async (tx) => {
      if (claimIds.length) {
        await tx.claim.updateMany({ where: { id: { in: claimIds } }, data: { isBilled: false } });
      }
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

    res.json(toResponse(result));
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
    const buf = await renderInvoicePdf(invoice, invoice.hospital);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${invoice.invoiceNumber || 'draft-' + invoice.id.slice(0, 8)}.pdf"`);
    res.send(buf);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
