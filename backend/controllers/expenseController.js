const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const expenseInclude = {
  category: { select: { id: true, slug: true, label: true, isSystem: true } },
  reference: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

const pickFields = (body) => {
  const data = {};
  if (body.date !== undefined) {
    const d = parseDate(body.date);
    if (!d) {
      const err = new Error('Invalid date');
      err.status = 400;
      throw err;
    }
    data.date = d;
  }
  if (body.categoryId !== undefined) data.categoryId = String(body.categoryId);
  if (body.amount !== undefined) {
    const n = Number(body.amount);
    if (!Number.isFinite(n)) {
      const err = new Error('Amount must be a number (negatives allowed for reversals)');
      err.status = 400;
      throw err;
    }
    data.amount = Math.round(n);
  }
  if (body.notes !== undefined) data.notes = String(body.notes || '').slice(0, 1000);
  if (body.partyName !== undefined) data.partyName = String(body.partyName || '').slice(0, 200);
  if (body.referenceId !== undefined) data.referenceId = body.referenceId || null;
  return data;
};

exports.list = async (req, res) => {
  try {
    const { categoryId, referenceId, from, to, q, page, limit = 25 } = req.query;
    const where = {};
    if (categoryId) where.categoryId = categoryId;
    if (referenceId) where.referenceId = referenceId;
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
    if (q && q.trim()) where.notes = { contains: q.trim(), mode: 'insensitive' };

    const take = Math.min(Number(limit) || 25, 200);
    const skip = page ? (Number(page) - 1) * take : 0;
    const [items, total, agg] = await Promise.all([
      prisma.expense.findMany({ where, include: expenseInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    res.json({
      expenses: toResponse(items),
      total,
      pages: Math.ceil(total / take),
      sumAmount: Math.round(agg._sum.amount || 0),
    });
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
    const [categories, grouped] = await Promise.all([
      prisma.expenseCategory.findMany({ orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      prisma.expense.groupBy({ where, by: ['categoryId'], _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const byCat = new Map(grouped.map((g) => [g.categoryId, g]));
    const rows = categories.map((c) => {
      const g = byCat.get(c.id);
      return {
        _id: c.id,
        slug: c.slug,
        label: c.label,
        isSystem: c.isSystem,
        amount: Math.round(g?._sum.amount || 0),
        count: g?._count._all || 0,
      };
    });
    const grandTotal = rows.reduce((acc, r) => acc + r.amount, 0);
    res.json({ rows, grandTotal });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.expense.findUnique({ where: { id: req.params.id }, include: expenseInclude });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.date || !data.categoryId || data.amount === undefined) {
      return res.status(400).json({ message: 'date, categoryId, and amount are required' });
    }

    const category = await prisma.expenseCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) return res.status(400).json({ message: 'Category not found' });
    if (!category.isActive) return res.status(400).json({ message: 'Category is inactive' });

    const item = await prisma.expense.create({
      data: { ...data, createdById: req.user?.id || null },
      include: expenseInclude,
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const data = pickFields(req.body);
    const item = await prisma.expense.update({
      where: { id: req.params.id },
      data: { ...data, updatedById: req.user?.id || null },
      include: expenseInclude,
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
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
