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
