const ClaimDocumentType = require('../models/ClaimDocumentType');

exports.getAll = async (req, res) => {
  try {
    const types = await ClaimDocumentType.find().sort('order name');
    res.json(types);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { name, description, isRequired, order } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Name is required' });

    const existing = await ClaimDocumentType.findOne({ name: name.trim() });
    if (existing) return res.status(400).json({ message: 'A document type with this name already exists' });

    const last = await ClaimDocumentType.findOne().sort('-order');
    const newOrder = order !== undefined ? Number(order) : (last?.order ?? 0) + 1;

    const docType = await ClaimDocumentType.create({
      name: name.trim(),
      description: (description || '').trim(),
      isRequired: !!isRequired,
      order: newOrder,
    });
    res.status(201).json(docType);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { name, description, isRequired, order, isActive } = req.body;
    const docType = await ClaimDocumentType.findById(req.params.id);
    if (!docType) return res.status(404).json({ message: 'Document type not found' });

    if (name !== undefined) {
      const conflict = await ClaimDocumentType.findOne({ name: name.trim(), _id: { $ne: docType._id } });
      if (conflict) return res.status(400).json({ message: 'A document type with this name already exists' });
      docType.name = name.trim();
    }
    if (description !== undefined) docType.description = description.trim();
    if (isRequired !== undefined) docType.isRequired = !!isRequired;
    if (order !== undefined) docType.order = Number(order);
    if (isActive !== undefined) docType.isActive = isActive;

    await docType.save();
    res.json(docType);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const docType = await ClaimDocumentType.findById(req.params.id);
    if (!docType) return res.status(404).json({ message: 'Document type not found' });
    if (docType.isSystem) return res.status(400).json({ message: 'System document types cannot be deleted' });

    await docType.deleteOne();
    res.json({ message: 'Document type deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
