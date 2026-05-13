const ClaimStatus = require('../models/ClaimStatus');

exports.getAll = async (req, res) => {
  try {
    const statuses = await ClaimStatus.find().sort('order');
    res.json(statuses);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { label, slug, color, order } = req.body;
    if (!label || !label.trim()) return res.status(400).json({ message: 'Label is required' });

    const generatedSlug = (slug || label).toLowerCase().trim().replace(/\s+/g, '_');

    const existing = await ClaimStatus.findOne({ slug: generatedSlug });
    if (existing) return res.status(400).json({ message: 'A status with this slug already exists' });

    const last = await ClaimStatus.findOne().sort('-order');
    const newOrder = order !== undefined ? Number(order) : (last?.order ?? 0) + 1;

    const status = await ClaimStatus.create({
      label: label.trim(),
      slug: generatedSlug,
      color: color || 'gray',
      order: newOrder,
    });
    res.status(201).json(status);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const { label, color, order, isActive } = req.body;
    const status = await ClaimStatus.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });

    if (label !== undefined) status.label = label.trim();
    if (color !== undefined) status.color = color;
    if (order !== undefined) status.order = Number(order);
    if (isActive !== undefined) status.isActive = isActive;

    await status.save();
    res.json(status);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const status = await ClaimStatus.findById(req.params.id);
    if (!status) return res.status(404).json({ message: 'Status not found' });
    if (status.isSystem) return res.status(400).json({ message: 'System statuses cannot be deleted' });

    await status.deleteOne();
    res.json({ message: 'Status deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
