const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const VALID_FIELDS = ['bankName', 'accountHolder', 'accountNumber', 'ifsc', 'upiId', 'isDefault', 'isActive', 'order'];

const pickFields = (body) => {
  const data = {};
  if (body.bankName !== undefined) data.bankName = String(body.bankName).slice(0, 200);
  if (body.accountHolder !== undefined) data.accountHolder = String(body.accountHolder || '').slice(0, 200);
  if (body.accountNumber !== undefined) data.accountNumber = String(body.accountNumber || '').slice(0, 60);
  if (body.ifsc !== undefined) data.ifsc = String(body.ifsc || '').toUpperCase().slice(0, 20);
  if (body.upiId !== undefined) data.upiId = String(body.upiId || '').slice(0, 100);
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  if (body.order !== undefined) {
    const n = Number(body.order);
    if (Number.isFinite(n)) data.order = n;
  }
  return data;
};

// Ensure the operator can't end up without a default account — flips `isDefault`
// off on every other row inside a transaction whenever one is promoted.
const flipDefault = async (tx, id) => {
  await tx.bankAccount.updateMany({
    where: { id: { not: id } },
    data: { isDefault: false },
  });
};

exports.list = async (req, res) => {
  try {
    const { active } = req.query;
    const where = {};
    if (active === 'true' || active === '1') where.isActive = true;
    const items = await prisma.bankAccount.findMany({
      where,
      orderBy: [{ isDefault: 'desc' }, { order: 'asc' }, { bankName: 'asc' }],
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.bankName) return res.status(400).json({ message: 'bankName is required' });

    const item = await prisma.$transaction(async (tx) => {
      const existingCount = await tx.bankAccount.count();
      // First-ever row is always the default — there has to be one for the
      // PDF renderer + dropdown picker to fall back to.
      const wantsDefault = req.body.isDefault === true || existingCount === 0;
      const created = await tx.bankAccount.create({
        data: { ...data, isDefault: wantsDefault },
      });
      if (wantsDefault) await flipDefault(tx, created.id);
      return created;
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = pickFields(req.body);
    const wantsDefault = req.body.isDefault === true;
    // Block "un-defaulting" the only default row — the system always needs one.
    if (existing.isDefault && req.body.isDefault === false) {
      return res.status(400).json({ message: 'A default bank account is required. Promote another account first.' });
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.bankAccount.update({
        where: { id: req.params.id },
        data: { ...data, ...(wantsDefault ? { isDefault: true } : {}) },
      });
      if (wantsDefault) await flipDefault(tx, updated.id);
      return updated;
    });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.setDefault = async (req, res) => {
  try {
    const existing = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (!existing.isActive) return res.status(400).json({ message: 'Activate the account before making it default.' });

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.bankAccount.update({
        where: { id: req.params.id },
        data: { isDefault: true },
      });
      await flipDefault(tx, updated.id);
      return updated;
    });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.bankAccount.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    // Don't allow deleting the default row — operator must promote another first.
    if (existing.isDefault) {
      return res.status(400).json({ message: 'Promote another account as default before deleting this one.' });
    }
    const used = await prisma.cashBankEntry.count({ where: { bankAccountId: req.params.id } });
    if (used > 0) {
      // Soft-delete so historical cash/bank entries keep their reference.
      const item = await prisma.bankAccount.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      return res.json({ ...toResponse(item), softDeleted: true });
    }
    await prisma.bankAccount.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Helper for invoice rendering — returns the single default bank account
// (active or otherwise). Returns null if no rows exist.
exports.getDefaultBankAccount = async () => {
  return prisma.bankAccount.findFirst({
    where: { isDefault: true },
    orderBy: { isDefault: 'desc' },
  });
};

module.exports.VALID_FIELDS = VALID_FIELDS;
