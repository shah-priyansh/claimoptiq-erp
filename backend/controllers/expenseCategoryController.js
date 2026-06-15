const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);

exports.list = async (req, res) => {
  try {
    const { active } = req.query;
    const where = {};
    if (active !== undefined) where.isActive = active === 'true';
    const items = await prisma.expenseCategory.findMany({ where, orderBy: [{ order: 'asc' }, { label: 'asc' }] });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const label = String(req.body.label || '').trim();
    if (!label) return res.status(400).json({ message: 'Label is required' });
    const slug = req.body.slug ? slugify(req.body.slug) : slugify(label);
    const item = await prisma.expenseCategory.create({
      data: {
        slug,
        label,
        order: Number(req.body.order) || 0,
        isActive: req.body.isActive === undefined ? true : !!req.body.isActive,
        isSystem: false,
      },
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ message: 'Slug already in use' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.expenseCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = {};
    if (req.body.label !== undefined) data.label = String(req.body.label).trim();
    if (req.body.order !== undefined) data.order = Number(req.body.order) || 0;
    if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
    // slug is locked on system rows so the auto-flow can't lose its anchor
    if (req.body.slug !== undefined && !existing.isSystem) data.slug = slugify(req.body.slug);

    const item = await prisma.expenseCategory.update({ where: { id: req.params.id }, data });
    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ message: 'Slug already in use' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.expenseCategory.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (existing.isSystem) return res.status(400).json({ message: 'System categories cannot be deleted' });

    const used = await prisma.expense.count({ where: { categoryId: req.params.id } });
    if (used > 0) {
      await prisma.expenseCategory.update({ where: { id: req.params.id }, data: { isActive: false } });
      return res.json({ message: `Deactivated (${used} expense${used === 1 ? '' : 's'} still reference it)` });
    }

    await prisma.expenseCategory.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
