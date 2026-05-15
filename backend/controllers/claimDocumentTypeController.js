const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

exports.getAll = async (req, res) => {
  try {
    const types = await prisma.claimDocumentType.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
    });
    res.json(toResponse(types));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, isRequired, order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

    const existing = await prisma.claimDocumentType.findUnique({ where: { name: name.trim() } });
    if (existing) return res.status(400).json({ message: 'A document type with this name already exists' });

    const last = await prisma.claimDocumentType.findFirst({ orderBy: { order: 'desc' } });
    const newOrder = order !== undefined ? Number(order) : (last?.order ?? 0) + 1;

    const docType = await prisma.claimDocumentType.create({
      data: { name: name.trim(), description: (description || '').trim(), isRequired: !!isRequired, order: newOrder },
    });
    res.status(201).json(toResponse(docType));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, isRequired, order, isActive } = req.body;
    const docType = await prisma.claimDocumentType.findUnique({ where: { id: req.params.id } });
    if (!docType) return res.status(404).json({ message: 'Document type not found' });

    if (name !== undefined) {
      const conflict = await prisma.claimDocumentType.findFirst({
        where: { name: name.trim(), id: { not: req.params.id } },
      });
      if (conflict) return res.status(400).json({ message: 'A document type with this name already exists' });
    }

    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description.trim();
    if (isRequired !== undefined) updateData.isRequired = !!isRequired;
    if (order !== undefined) updateData.order = Number(order);
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await prisma.claimDocumentType.update({ where: { id: req.params.id }, data: updateData });
    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const docType = await prisma.claimDocumentType.findUnique({ where: { id: req.params.id } });
    if (!docType) return res.status(404).json({ message: 'Document type not found' });
    if (docType.isSystem) return res.status(400).json({ message: 'System document types cannot be deleted' });
    await prisma.claimDocumentType.delete({ where: { id: req.params.id } });
    res.json({ message: 'Document type deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
