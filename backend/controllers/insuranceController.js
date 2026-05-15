const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

exports.create = async (req, res) => {
  try {
    const existing = await prisma.insuranceCompany.findUnique({ where: { name: req.body.name } });
    if (existing) return res.status(400).json({ message: 'Insurance company already exists' });
    const item = await prisma.insuranceCompany.create({ data: { name: req.body.name } });
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
      data: req.body,
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
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
