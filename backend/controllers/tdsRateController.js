const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const pickFields = (body) => {
  const data = {};
  if (body.taxName !== undefined) data.taxName = String(body.taxName).trim();
  if (body.section !== undefined) data.section = String(body.section || '').trim();
  if (body.rate !== undefined) {
    const n = Number(body.rate);
    data.rate = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.taxName) return res.status(400).json({ message: 'Tax name is required' });
    const item = await prisma.tdsRate.create({ data });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { search, active } = req.query;
    const where = {};
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.taxName = { contains: search, mode: 'insensitive' };
    const items = await prisma.tdsRate.findMany({ where, orderBy: { taxName: 'asc' } });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.tdsRate.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const item = await prisma.tdsRate.update({ where: { id: req.params.id }, data: pickFields(req.body) });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    // If any invoice still references this rate, soft-delete instead of hard-delete.
    const linked = await prisma.invoice.count({ where: { tdsRateId: id } });
    if (linked > 0) {
      await prisma.tdsRate.update({ where: { id }, data: { isActive: false } });
      return res.json({ message: `Deactivated (referenced by ${linked} invoice${linked === 1 ? '' : 's'})` });
    }
    await prisma.tdsRate.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
