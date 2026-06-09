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
    const existing = await prisma.insuranceCompany.findUnique({ where: { name: data.name } });
    if (existing) return res.status(400).json({ message: 'Insurance company already exists' });
    const item = await prisma.insuranceCompany.create({ data });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const items = await prisma.insuranceCompany.findMany({
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
    const item = await prisma.insuranceCompany.update({
      where: { id: req.params.id },
      data: pickFields(req.body),
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    if (error.code === 'P2002') return res.status(400).json({ message: 'Insurance company name already exists' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const existing = await prisma.insuranceCompany.findMany({ select: { name: true } });
    const existingNames = new Set(existing.map(x => x.name.trim().toLowerCase()));

    const seenInBatch = new Set();
    const created = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const name = String(row.name || '').trim();
      const rowErrors = [];
      if (!name) rowErrors.push('Name is required');
      else if (existingNames.has(name.toLowerCase())) rowErrors.push(`"${name}" already exists`);
      else if (seenInBatch.has(name.toLowerCase())) rowErrors.push(`"${name}" is duplicated in the file`);

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }
      try {
        const item = await prisma.insuranceCompany.create({
          data: pickFields({ name, address: row.address, contactPerson: row.contactPerson, mobile: row.mobile, email: row.email }),
          select: { id: true, name: true },
        });
        seenInBatch.add(name.toLowerCase());
        created.push({ row: rowNum, id: item.id, name: item.name });
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    res.status(errors.length && !created.length ? 400 : 200).json({
      message: `Imported ${created.length} of ${rows.length} insurance company(s)`,
      created, errors, totalRows: rows.length, successCount: created.length, errorCount: errors.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.insuranceCompany.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
