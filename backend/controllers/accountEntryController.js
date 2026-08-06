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

const norm = (s) => String(s || '').trim().toLowerCase();

// Loose date parser for bulk import — accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
// and Excel serials. Returns a UTC-midnight Date or null.
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

const cleanNum = (v) => String(v ?? '').replace(/,/g, '').trim();

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

// Bulk import — each valid row creates an account entry (append-only). Handles
// both 'general' (debit/credit) and 'contra' (mode-to-mode transfer) rows;
// validation is delegated to buildEntryData() for parity with single-add.
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const created = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const entryType = norm(row.type ?? row.entryType);
      const label = entryType || '?';
      try {
        const dateVal = parseImportDate(row.date);
        if (!dateVal) throw { message: row.date ? `Date invalid: "${row.date}"` : 'Date is required' };
        const data = buildEntryData({
          date: dateVal,
          entryType,
          remarks: row.remarks,
          debit: cleanNum(row.debit),
          credit: cleanNum(row.credit),
          fromMode: norm(row.fromMode),
          toMode: norm(row.toMode),
          amount: cleanNum(row.amount),
        });
        const entry = await prisma.accountEntry.create({
          data: { ...data, createdById: req.user?.id || null },
          select: { id: true },
        });
        created.push({ row: rowNum, id: entry.id, name: label });
      } catch (e) {
        errors.push({ row: rowNum, name: label, errors: [e.message || 'Failed to save'] });
      }
    }

    const successCount = created.length;
    res.json({
      message: `Imported ${successCount} of ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`,
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
