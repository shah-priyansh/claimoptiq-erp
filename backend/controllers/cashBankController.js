const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { recomputeInvoicePaidStatus } = require('../utils/invoicePaidRollup');

const VALID_DIRECTIONS = ['in', 'out'];
const VALID_MODES = ['cash', 'bank', 'upi'];

const cashBankInclude = {
  invoice: { select: { id: true, invoiceNumber: true, hospital: { select: { id: true, name: true } } } },
  expense: { select: { id: true, amount: true, notes: true, category: { select: { id: true, label: true, slug: true } } } },
  hospital: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, bankName: true, accountNumber: true, ifsc: true } },
  createdBy: { select: { id: true, name: true } },
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

// Build the persisted shape from a request body. Throws { status, message } for client errors.
const buildEntryData = async (body) => {
  const date = parseDate(body.date);
  if (!date) throw { status: 400, message: 'Valid date is required' };
  const direction = String(body.direction || '').trim();
  if (!VALID_DIRECTIONS.includes(direction)) throw { status: 400, message: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` };
  const mode = String(body.mode || '').trim();
  if (!VALID_MODES.includes(mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(', ')}` };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw { status: 400, message: 'amount must be a positive number (use opposite direction to reverse)' };
  }

  const invoiceId = body.invoiceId || null;
  const expenseId = body.expenseId || null;
  if (invoiceId && expenseId) {
    throw { status: 400, message: 'An entry can link to at most one of invoiceId / expenseId' };
  }

  let hospitalId = body.hospitalId || null;

  // Denormalize hospitalId from the invoice when invoice is the link target.
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { hospitalId: true, status: true } });
    if (!inv) throw { status: 400, message: 'Invoice not found' };
    if (inv.status === 'draft') throw { status: 400, message: 'Cannot record payment against a draft invoice. Issue it first.' };
    if (inv.status === 'void') throw { status: 400, message: 'Cannot record payment against a voided invoice.' };
    hospitalId = inv.hospitalId;
  }
  if (expenseId) {
    const exp = await prisma.expense.findUnique({ where: { id: expenseId }, select: { id: true } });
    if (!exp) throw { status: 400, message: 'Expense not found' };
  }

  // Bank/UPI entries must reference a specific configured bank account so
  // per-account balances stay correct. We accept it directly OR fall back
  // to the default account when the client doesn't pick one.
  let bankAccountId = body.bankAccountId || null;
  if (mode === 'bank' || mode === 'upi') {
    if (!bankAccountId) {
      const def = await prisma.bankAccount.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
      bankAccountId = def?.id || null;
    }
    if (!bankAccountId) {
      throw { status: 400, message: 'Bank / UPI entries need a bank account. Add one in Site Settings → Bank Accounts.' };
    }
    const acct = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, isActive: true } });
    if (!acct) throw { status: 400, message: 'Bank account not found' };
    if (!acct.isActive) throw { status: 400, message: 'Bank account is inactive' };
  } else {
    // Cash entries never carry a bank account.
    bankAccountId = null;
  }

  return {
    date,
    direction,
    mode,
    amount: Math.round(amount),
    notes: String(body.notes || '').slice(0, 1000),
    invoiceId,
    expenseId,
    hospitalId,
    bankAccountId,
    utrNumber: String(body.utrNumber || '').slice(0, 60),
    chequeNumber: String(body.chequeNumber || '').slice(0, 60),
  };
};

exports.list = async (req, res) => {
  try {
    const { from, to, direction, mode, hospitalId, invoiceId, expenseId, q, page, limit = 25 } = req.query;
    const where = {};
    if (direction) where.direction = direction;
    if (mode) where.mode = mode;
    if (hospitalId) where.hospitalId = hospitalId;
    if (invoiceId) where.invoiceId = invoiceId;
    if (expenseId) where.expenseId = expenseId;
    const fromD = parseDate(from);
    const toD = parseDate(to);
    if (fromD || toD) {
      where.date = {};
      if (fromD) where.date.gte = fromD;
      if (toD) {
        const inclusive = new Date(toD);
        inclusive.setUTCHours(23, 59, 59, 999);
        where.date.lte = inclusive;
      }
    }
    if (q && q.trim()) {
      where.OR = [
        { notes: { contains: q.trim(), mode: 'insensitive' } },
        { utrNumber: { contains: q.trim(), mode: 'insensitive' } },
        { chequeNumber: { contains: q.trim(), mode: 'insensitive' } },
      ];
    }

    const take = Math.min(Number(limit) || 25, 200);
    const skip = page ? (Number(page) - 1) * take : 0;
    const [items, total] = await Promise.all([
      prisma.cashBankEntry.findMany({
        where, include: cashBankInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip, take,
      }),
      prisma.cashBankEntry.count({ where }),
    ]);
    res.json({ entries: toResponse(items), total, pages: Math.ceil(total / take) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Current running balance per mode:
//   balance(mode) = Σ CashBankEntry IN to that mode
//                 − Σ CashBankEntry OUT from that mode
//                 + Σ AccountEntry contra toMode == this mode
//                 − Σ AccountEntry contra fromMode == this mode
exports.balances = async (req, res) => {
  try {
    const [cashBankGrouped, contraTo, contraFrom] = await Promise.all([
      prisma.cashBankEntry.groupBy({ by: ['mode', 'direction'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['toMode'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['fromMode'], _sum: { amount: true } }),
    ]);
    const out = { cash: 0, bank: 0, upi: 0 };
    for (const row of cashBankGrouped) {
      const sign = row.direction === 'in' ? 1 : -1;
      out[row.mode] = (out[row.mode] || 0) + sign * (row._sum.amount || 0);
    }
    for (const row of contraTo) {
      if (row.toMode && out[row.toMode] !== undefined) out[row.toMode] += row._sum.amount || 0;
    }
    for (const row of contraFrom) {
      if (row.fromMode && out[row.fromMode] !== undefined) out[row.fromMode] -= row._sum.amount || 0;
    }
    out.total = out.cash + out.bank + out.upi;
    res.json({
      cash: Math.round(out.cash),
      bank: Math.round(out.bank),
      upi:  Math.round(out.upi),
      total: Math.round(out.total),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// In/out totals per mode for a date range. Used by Reports (2.6).
exports.summary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    const fromD = parseDate(from);
    const toD = parseDate(to);
    if (fromD || toD) {
      where.date = {};
      if (fromD) where.date.gte = fromD;
      if (toD) {
        const inclusive = new Date(toD);
        inclusive.setUTCHours(23, 59, 59, 999);
        where.date.lte = inclusive;
      }
    }
    const grouped = await prisma.cashBankEntry.groupBy({
      where, by: ['mode', 'direction'], _sum: { amount: true },
    });
    const shape = (mode) => ({ in: 0, out: 0 });
    const out = { cash: shape(), bank: shape(), upi: shape() };
    for (const row of grouped) {
      if (!out[row.mode]) continue;
      out[row.mode][row.direction] = Math.round(row._sum.amount || 0);
    }
    const totalIn = out.cash.in + out.bank.in + out.upi.in;
    const totalOut = out.cash.out + out.bank.out + out.upi.out;
    res.json({ ...out, totalIn, totalOut, net: totalIn - totalOut });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id }, include: cashBankInclude });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await buildEntryData(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.cashBankEntry.create({
        data: { ...data, createdById: req.user?.id || null },
        include: cashBankInclude,
      });
      if (data.invoiceId) await recomputeInvoicePaidStatus(tx, data.invoiceId);
      return created;
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const merged = await buildEntryData({
      date: req.body.date ?? existing.date,
      direction: req.body.direction ?? existing.direction,
      mode: req.body.mode ?? existing.mode,
      amount: req.body.amount ?? existing.amount,
      notes: req.body.notes ?? existing.notes,
      invoiceId: req.body.invoiceId !== undefined ? req.body.invoiceId : existing.invoiceId,
      expenseId: req.body.expenseId !== undefined ? req.body.expenseId : existing.expenseId,
      hospitalId: req.body.hospitalId !== undefined ? req.body.hospitalId : existing.hospitalId,
      bankAccountId: req.body.bankAccountId !== undefined ? req.body.bankAccountId : existing.bankAccountId,
      utrNumber: req.body.utrNumber ?? existing.utrNumber,
      chequeNumber: req.body.chequeNumber ?? existing.chequeNumber,
    });

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.cashBankEntry.update({ where: { id: req.params.id }, data: merged, include: cashBankInclude });
      // Recompute both the old and new invoice (if either changed)
      const oldInv = existing.invoiceId;
      const newInv = merged.invoiceId;
      if (oldInv && oldInv !== newInv) await recomputeInvoicePaidStatus(tx, oldInv);
      if (newInv) await recomputeInvoicePaidStatus(tx, newInv);
      return updated;
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    await prisma.$transaction(async (tx) => {
      await tx.cashBankEntry.delete({ where: { id: req.params.id } });
      if (existing.invoiceId) await recomputeInvoicePaidStatus(tx, existing.invoiceId);
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// POST /api/invoices/:id/payments — convenience wrapper for the invoice detail UI.
exports.recordInvoicePayment = async (req, res) => {
  try {
    req.body.invoiceId = req.params.id;
    req.body.direction = 'in';
    return exports.create(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
