const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { invalidateStatusCache } = require('./claimController');

exports.getAll = async (req, res) => {
  try {
    const statuses = await prisma.claimStatus.findMany({ orderBy: { order: 'asc' } });
    res.json(toResponse(statuses));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { label, slug, color, order } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ message: 'Label is required' });

    const generatedSlug = (slug || label).toLowerCase().trim().replace(/\s+/g, '_');
    const existing = await prisma.claimStatus.findUnique({ where: { slug: generatedSlug } });
    if (existing) return res.status(400).json({ message: 'A status with this slug already exists' });

    const last = await prisma.claimStatus.findFirst({ orderBy: { order: 'desc' } });
    const newOrder = order !== undefined ? Number(order) : (last?.order ?? 0) + 1;

    const status = await prisma.claimStatus.create({
      data: { label: label.trim(), slug: generatedSlug, color: color || 'gray', order: newOrder },
    });
    invalidateStatusCache();
    res.status(201).json(toResponse(status));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { label, color, order, isActive } = req.body;
    const status = await prisma.claimStatus.findUnique({ where: { id: req.params.id } });
    if (!status) return res.status(404).json({ message: 'Status not found' });

    const updateData = {};
    if (label !== undefined) updateData.label = label.trim();
    if (color !== undefined) updateData.color = color;
    if (order !== undefined) updateData.order = Number(order);
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await prisma.claimStatus.update({ where: { id: req.params.id }, data: updateData });
    invalidateStatusCache();
    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const status = await prisma.claimStatus.findUnique({ where: { id: req.params.id } });
    if (!status) return res.status(404).json({ message: 'Status not found' });
    if (status.isSystem) return res.status(400).json({ message: 'System statuses cannot be deleted' });
    await prisma.claimStatus.delete({ where: { id: req.params.id } });
    invalidateStatusCache();
    res.json({ message: 'Status deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
