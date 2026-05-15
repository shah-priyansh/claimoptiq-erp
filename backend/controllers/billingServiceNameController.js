const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

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
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ message: 'Name is required' });
    const existing = await prisma.billingServiceName.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(400).json({ message: 'Service name already exists' });
    const item = await prisma.billingServiceName.create({ data: { name: name.trim() } });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const item = await prisma.billingServiceName.update({
      where: { id: req.params.id },
      data: { name: req.body.name?.trim() },
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
