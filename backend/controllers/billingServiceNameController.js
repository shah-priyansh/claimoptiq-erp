const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const VALID_CLAIM_TYPES = ['cashless', 'cashless_anywhere', 'reimbursement', 'grievance'];

// Coerce whatever the client sent (array | undefined | garbage) into a
// sanitized string[] of allowed claim types. Empty array means "no
// restriction" so the service can fall back onto any claim type.
const sanitizeClaimTypes = (raw) => {
  if (!Array.isArray(raw)) return [];
  const unique = new Set();
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const norm = v.trim().toLowerCase();
    if (VALID_CLAIM_TYPES.includes(norm)) unique.add(norm);
  }
  return [...unique];
};

exports.getAll = async (req, res) => {
  try {
    const items = await prisma.billingServiceName.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, claimTypes } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });
    const existing = await prisma.billingServiceName.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(400).json({ message: 'Service name already exists' });
    const item = await prisma.billingServiceName.create({
      data: {
        name: name.trim(),
        claimTypes: sanitizeClaimTypes(claimTypes),
      },
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body.name === 'string') patch.name = req.body.name.trim();
    if (req.body.claimTypes !== undefined) patch.claimTypes = sanitizeClaimTypes(req.body.claimTypes);
    const item = await prisma.billingServiceName.update({
      where: { id: req.params.id },
      data: patch,
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.billingServiceName.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
