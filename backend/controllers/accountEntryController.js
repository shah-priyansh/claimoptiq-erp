const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const VALID_MODES = ['cash', 'bank', 'upi'];
const VALID_TYPES = ['general', 'contra'];

const include = {
  createdBy: { select: { id: true, name: true } },
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

// Validate & normalize a request body into the persisted shape.
// Throws { status, message } on user error.
const buildEntryData = (body) => {
  const date = parseDate(body.date);
  if (!date) throw { status: 400, message: 'Valid date is required' };

  const entryType = String(body.entryType || '').trim();
  if (!VALID_TYPES.includes(entryType)) {
    throw { status: 400, message: `entryType must be one of: ${VALID_TYPES.join(', ')}` };
  }

  const data = {
    date,
    entryType,
    remarks: String(body.remarks || '').slice(0, 1000),
    debit: 0,
    credit: 0,
    fromMode: null,
    toMode: null,
    amount: 0,
  };

  if (entryType === 'general') {
    const debit = Number(body.debit) || 0;
    const credit = Number(body.credit) || 0;
    if (debit < 0 || credit < 0) throw { status: 400, message: 'Debit/Credit must be non-negative (use the opposite column for reversals)' };
    if (debit === 0 && credit === 0) throw { status: 400, message: 'At least one of Debit/Credit must be greater than zero' };
    data.debit = Math.round(debit);
    data.credit = Math.round(credit);
  } else {
    // contra
    const amount = Number(body.amount) || 0;
    if (amount <= 0) throw { status: 400, message: 'Contra amount must be positive' };
    const fromMode = String(body.fromMode || '').trim();
    const toMode = String(body.toMode || '').trim();
    if (!VALID_MODES.includes(fromMode) || !VALID_MODES.includes(toMode)) {
      throw { status: 400, message: `fromMode/toMode must be one of: ${VALID_MODES.join(', ')}` };
    }
    if (fromMode === toMode) throw { status: 400, message: 'fromMode and toMode must be different' };
    data.fromMode = fromMode;
    data.toMode = toMode;
    data.amount = Math.round(amount);
  }

  return data;
};

exports.list = async (req, res) => {
  try {
    const { from, to, entryType, q, page, limit = 25 } = req.query;
    const where = {};
    if (entryType) where.entryType = entryType;
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
    if (q && q.trim()) where.remarks = { contains: q.trim(), mode: 'insensitive' };

    const take = Math.min(Number(limit) || 25, 200);
    const skip = page ? (Number(page) - 1) * take : 0;
    const [items, total] = await Promise.all([
      prisma.accountEntry.findMany({ where, include, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take }),
      prisma.accountEntry.count({ where }),
    ]);
    res.json({ entries: toResponse(items), total, pages: Math.ceil(total / take) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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
    const [general, contraCount] = await Promise.all([
      prisma.accountEntry.aggregate({ where: { ...where, entryType: 'general' }, _sum: { debit: true, credit: true } }),
      prisma.accountEntry.count({ where: { ...where, entryType: 'contra' } }),
    ]);
    res.json({
      generalDebit: Math.round(general._sum.debit || 0),
      generalCredit: Math.round(general._sum.credit || 0),
      contraCount,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.accountEntry.findUnique({ where: { id: req.params.id }, include });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = buildEntryData(req.body);
    const item = await prisma.accountEntry.create({
      data: { ...data, createdById: req.user?.id || null },
      include,
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.accountEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = buildEntryData({
      date: req.body.date ?? existing.date,
      entryType: req.body.entryType ?? existing.entryType,
      remarks: req.body.remarks ?? existing.remarks,
      debit: req.body.debit ?? existing.debit,
      credit: req.body.credit ?? existing.credit,
      fromMode: req.body.fromMode !== undefined ? req.body.fromMode : existing.fromMode,
      toMode: req.body.toMode !== undefined ? req.body.toMode : existing.toMode,
      amount: req.body.amount ?? existing.amount,
    });

    const item = await prisma.accountEntry.update({ where: { id: req.params.id }, data, include });
    res.json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.accountEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
