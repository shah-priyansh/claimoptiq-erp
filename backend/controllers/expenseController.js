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

const norm = (s) => String(s || '').trim().toLowerCase();

// Loose date parser for bulk import — accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
// and Excel serial numbers. Returns a UTC-midnight Date or null. The frontend
// already coerces spreadsheet date cells to YYYY-MM-DD, but CSV text and manual
// entries can arrive in day-first formats, so mirror that tolerance here.
const parseImportDate = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) ? null : d;
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    let day = +a, month = +b;
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    if (!day || !month || day > 31 || month > 12) return null;
    const d = new Date(Date.UTC(+yy, month - 1, day));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== month - 1) ? null : d;
  }
  const d = new Date(s);
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
    const { categoryId, referenceId, from, to, q, page, limit = 25, merge } = req.query;
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

    // Monthly-merged view — collapses every Expense in the filter scope into
    // one synthetic row per (referenceId, calendar-month). Used by the
    // Reference Commission category on the Expenses page so dozens of
    // per-invoice rows for the same reference roll up to a single line item.
    if (merge === 'monthly') {
      const allItems = await prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: [{ date: 'desc' }],
      });
      const buckets = new Map();
      for (const exp of allItems) {
        const d = new Date(exp.date);
        const yyyymm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const refKey = exp.referenceId || 'none';
        const key = `${refKey}:${exp.categoryId}:${yyyymm}`;
        if (!buckets.has(key)) {
          const anchor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
          buckets.set(key, {
            id: key,
            date: anchor,
            categoryId: exp.categoryId,
            category: exp.category,
            referenceId: exp.referenceId,
            reference: exp.reference,
            amount: 0,
            notes: '',
            partyName: '',
            sourceType: exp.sourceType || null,
            sourceId: null,
            sourceLineId: null,
            createdAt: exp.createdAt,
            updatedAt: exp.updatedAt,
            mergedCount: 0,
          });
        }
        const b = buckets.get(key);
        b.amount += Number(exp.amount) || 0;
        b.mergedCount += 1;
      }
      const merged = [...buckets.values()]
        .map((b) => ({
          ...b,
          amount: Math.round(b.amount),
          notes: `${b.mergedCount} entr${b.mergedCount === 1 ? 'y' : 'ies'} merged`,
        }))
        .sort((a, b) => b.date - a.date);
      const start = page ? (Number(page) - 1) * take : 0;
      return res.json({
        expenses: toResponse(merged.slice(start, start + take)),
        total: merged.length,
        pages: Math.ceil(merged.length / take),
        sumAmount: Math.round(merged.reduce((s, m) => s + m.amount, 0)),
        merged: true,
      });
    }

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

// Bulk import — each valid row creates a new Expense (append-only; no dedupe,
// since expenses are transactional, not unique masters). Category is resolved by
// label or slug, Reference by name; both case-insensitive. Invalid rows are
// reported per-row and skipped so a single bad row never blocks the rest.
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const [categories, references] = await Promise.all([
      prisma.expenseCategory.findMany({ select: { id: true, slug: true, label: true, isActive: true } }),
      prisma.reference.findMany({ select: { id: true, name: true } }),
    ]);
    const catMap = new Map();
    for (const c of categories) {
      catMap.set(norm(c.label), c);
      if (!catMap.has(norm(c.slug))) catMap.set(norm(c.slug), c);
    }
    const refMap = new Map();
    for (const r of references) {
      const k = norm(r.name);
      if (k && !refMap.has(k)) refMap.set(k, r);
    }

    const created = [];
    const errors = [];
    const toCreate = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2; // header is row 1 in the source file
      const rowErrors = [];

      const catRaw = String(row.category ?? '').trim();
      let category = null;
      if (!catRaw) rowErrors.push('Category is required');
      else {
        category = catMap.get(norm(catRaw));
        if (!category) rowErrors.push(`Category not found: "${catRaw}"`);
        else if (!category.isActive) rowErrors.push(`Category is inactive: "${category.label}"`);
      }

      const dateVal = parseImportDate(row.date);
      if (!dateVal) rowErrors.push(row.date ? `Date invalid: "${row.date}"` : 'Date is required');

      const amtRaw = row.amount;
      const amt = Number(String(amtRaw ?? '').replace(/,/g, '').trim());
      if (amtRaw === undefined || amtRaw === null || String(amtRaw).trim() === '') rowErrors.push('Amount is required');
      else if (!Number.isFinite(amt)) rowErrors.push(`Amount must be a number: "${amtRaw}"`);

      let referenceId = null;
      const refRaw = String(row.reference ?? row.referenceBy ?? '').trim();
      if (refRaw) {
        const ref = refMap.get(norm(refRaw));
        if (!ref) rowErrors.push(`Reference not found: "${refRaw}"`);
        else referenceId = ref.id;
      }

      const label = catRaw || String(row.partyName ?? '').trim() || (dateVal ? dateVal.toISOString().slice(0, 10) : '');
      if (rowErrors.length) { errors.push({ row: rowNum, name: label, errors: rowErrors }); continue; }

      toCreate.push({
        rowNum,
        label,
        data: {
          date: dateVal,
          categoryId: category.id,
          amount: Math.round(amt),
          notes: String(row.notes ?? '').slice(0, 1000),
          partyName: String(row.partyName ?? '').slice(0, 200),
          referenceId,
          createdById: req.user?.id || null,
        },
      });
    }

    for (const item of toCreate) {
      try {
        const exp = await prisma.expense.create({ data: item.data, select: { id: true } });
        created.push({ row: item.rowNum, id: exp.id, name: item.label });
      } catch (e) {
        errors.push({ row: item.rowNum, name: item.label, errors: [e.message || 'Failed to save'] });
      }
    }

    const successCount = created.length;
    res.json({
      message: `Imported ${successCount} of ${rows.length} expense(s)`,
      created,
      errors,
      totalRows: rows.length,
      successCount,
      createdCount: successCount,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: errors.length,
      mode: 'append',
    });
  } catch (error) {
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
