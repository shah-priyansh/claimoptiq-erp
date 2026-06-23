const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.address !== undefined) data.address = String(body.address || '').trim();
  if (body.contactPerson !== undefined) data.contactPerson = String(body.contactPerson || '').trim();
  if (body.mobile !== undefined) data.mobile = String(body.mobile || '').trim();
  if (body.email !== undefined) data.email = String(body.email || '').trim();
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'Name is required' });
    const existing = await prisma.tPA.findUnique({ where: { name: data.name } });
    if (existing) return res.status(400).json({ message: 'TPA already exists' });
    const item = await prisma.tPA.create({ data });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const items = await prisma.tPA.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const item = await prisma.tPA.update({
      where: { id: req.params.id },
      data: pickFields(req.body),
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    if (error.code === 'P2002') return res.status(400).json({ message: 'TPA name already exists' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    const mode = req.body.mode === 'replace' ? 'replace' : 'skip';
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const existing = await prisma.tPA.findMany({ select: { id: true, name: true, isActive: true } });
    const activeMap = new Map();
    const inactiveMap = new Map();
    for (const e of existing) {
      const key = e.name.trim().toLowerCase();
      (e.isActive ? activeMap : inactiveMap).set(key, e);
    }

    const seenInBatch = new Set();
    const created = [];
    const updated = [];
    const skipped = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const name = String(row.name || '').trim();
      const key = name.toLowerCase();
      const rowErrors = [];
      if (!name) rowErrors.push('Name is required');
      else if (seenInBatch.has(key)) rowErrors.push(`"${name}" is duplicated in the file`);

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }

      const activeExisting = activeMap.get(key);
      if (activeExisting && mode === 'skip') {
        seenInBatch.add(key);
        skipped.push({ row: rowNum, id: activeExisting.id, name });
        continue;
      }

      try {
        const data = pickFields({ name, address: row.address, contactPerson: row.contactPerson, mobile: row.mobile, email: row.email });
        const inactive = inactiveMap.get(key);
        if (activeExisting) {
          const item = await prisma.tPA.update({
            where: { id: activeExisting.id },
            data,
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: item.id, name: item.name });
        } else if (inactive) {
          const item = await prisma.tPA.update({
            where: { id: inactive.id },
            data: { ...data, isActive: true },
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: item.id, name: item.name });
        } else {
          const item = await prisma.tPA.create({ data, select: { id: true, name: true } });
          seenInBatch.add(key);
          created.push({ row: rowNum, id: item.id, name: item.name });
        }
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    const successCount = created.length + updated.length;
    res.status(errors.length && !successCount && !skipped.length ? 400 : 200).json({
      message: `Imported ${successCount} of ${rows.length} TPA(s)`,
      created, updated, skipped, errors,
      totalRows: rows.length,
      successCount,
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      mode,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.tPA.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
