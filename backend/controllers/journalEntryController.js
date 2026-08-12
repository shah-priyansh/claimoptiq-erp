const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { normalizeLines, assertBalanced, nextRefNumber } = require('../utils/journalValidation');

const journalInclude = {
  lines: true,
  createdBy: { select: { id: true, name: true } },
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

// Resolve each line's account to a display name; reject unknown/inactive accounts.
const resolveAccounts = async (lines) => {
  const [banks, ledgers, cats, parties] = await Promise.all([
    prisma.bankAccount.findMany({ where: { isActive: true }, select: { id: true, bankName: true } }),
    prisma.account.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({ where: { isActive: true }, select: { id: true, label: true } }),
    prisma.party.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const maps = {
    bank: new Map(banks.map((b) => [b.id, b.bankName])),
    ledger_account: new Map(ledgers.map((a) => [a.id, a.name])),
    expense_category: new Map(cats.map((c) => [c.id, c.label])),
    party: new Map(parties.map((p) => [p.id, p.name])),
  };
  return lines.map((l, i) => {
    const name = l.accountKind === 'cash' ? 'Cash in Hand' : maps[l.accountKind]?.get(l.accountId);
    if (!name) throw { status: 400, message: `Line ${i + 1}: selected account not found or inactive` };
    return { accountKind: l.accountKind, accountId: l.accountId, accountName: name, debit: l.debit, credit: l.credit };
  });
};

const buildEntryPayload = async (body) => {
  const date = parseDate(body.date);
  if (!date) throw { status: 400, message: 'Valid date is required' };
  const lines = normalizeLines(body.lines);
  assertBalanced(lines);
  const resolved = await resolveAccounts(lines);
  return { date, description: String(body.description || '').slice(0, 1000), lines: resolved };
};

exports.list = async (req, res) => {
  try {
    const { from, to, q, page, limit = 25 } = req.query;
    const where = {};
    const fromD = parseDate(from);
    const toD = parseDate(to);
    if (fromD || toD) {
      where.date = {};
      if (fromD) where.date.gte = fromD;
      if (toD) { const inc = new Date(toD); inc.setUTCHours(23, 59, 59, 999); where.date.lte = inc; }
    }
    if (q && q.trim()) {
      where.OR = [
        { refNumber: { contains: q.trim(), mode: 'insensitive' } },
        { description: { contains: q.trim(), mode: 'insensitive' } },
        { lines: { some: { accountName: { contains: q.trim(), mode: 'insensitive' } } } },
      ];
    }
    const take = Math.min(Number(limit) || 25, 200);
    const skip = page ? (Number(page) - 1) * take : 0;
    const [items, total] = await Promise.all([
      prisma.journalEntry.findMany({ where, include: journalInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take }),
      prisma.journalEntry.count({ where }),
    ]);
    res.json({ entries: toResponse(items), total, pages: Math.ceil(total / take) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.journalEntry.findUnique({ where: { id: req.params.id }, include: journalInclude });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const payload = await buildEntryPayload(req.body);
    let entry = null;
    for (let attempt = 0; attempt < 5 && !entry; attempt++) {
      const latest = await prisma.journalEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { refNumber: true } });
      const refNumber = nextRefNumber([latest?.refNumber]);
      try {
        entry = await prisma.journalEntry.create({
          data: {
            refNumber, date: payload.date, description: payload.description,
            createdById: req.user?.id || null,
            lines: { create: payload.lines },
          },
          include: journalInclude,
        });
      } catch (e) {
        if (e.code === 'P2002') continue; // ref collision → retry
        throw e;
      }
    }
    if (!entry) return res.status(409).json({ message: 'Could not assign a reference number, please retry' });
    res.status(201).json(toResponse(entry));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.journalEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const payload = await buildEntryPayload({
      date: req.body.date ?? existing.date,
      description: req.body.description ?? existing.description,
      lines: req.body.lines,
    });
    const entry = await prisma.$transaction(async (tx) => {
      await tx.journalLine.deleteMany({ where: { entryId: existing.id } });
      return tx.journalEntry.update({
        where: { id: existing.id },
        data: { date: payload.date, description: payload.description, lines: { create: payload.lines } },
        include: journalInclude,
      });
    });
    res.json(toResponse(entry));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    await prisma.journalEntry.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
