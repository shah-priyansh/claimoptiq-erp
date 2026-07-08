const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

// TDS rates are effectively config — cache list responses (2min) keyed by
// query so the invoice / reports pages don't pay a WAN roundtrip per mount.
const _listCache = new Map();
const LIST_CACHE_TTL = 2 * 60 * 1000;
const bustListCache = () => { _listCache.clear(); };

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
    bustListCache();
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { search, active } = req.query;
    const cacheKey = `${search || ''}|${active ?? 'all'}`;
    const cached = _listCache.get(cacheKey);
    if (cached && cached.expiry > Date.now()) {
      return res.json(cached.payload);
    }
    const where = {};
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.taxName = { contains: search, mode: 'insensitive' };
    const items = await prisma.tdsRate.findMany({ where, orderBy: { taxName: 'asc' } });
    const payload = toResponse(items);
    _listCache.set(cacheKey, { payload, expiry: Date.now() + LIST_CACHE_TTL });
    res.json(payload);
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
    bustListCache();
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
      bustListCache();
      return res.json({ message: `Deactivated (referenced by ${linked} invoice${linked === 1 ? '' : 's'})` });
    }
    await prisma.tdsRate.delete({ where: { id } });
    bustListCache();
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
