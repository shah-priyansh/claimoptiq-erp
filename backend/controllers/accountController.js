const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

// Account types that live in the new `accounts` table (Bank/Cash/Party/Expense
// are rolled into the chart from their own tables).
const VALID_TYPES = ['fixed_asset', 'capital', 'loan', 'other'];
const GROUP_OF = { fixed_asset: 'assets', capital: 'equity', loan: 'liabilities', other: 'assets' };
const VALID_GROUPS = ['assets', 'liabilities', 'equity'];
const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid'];

const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name || '').slice(0, 200);
  if (body.accountType !== undefined) data.accountType = VALID_TYPES.includes(body.accountType) ? body.accountType : 'other';
  // Group defaults from the type unless explicitly overridden (for 'other').
  if (body.group !== undefined && VALID_GROUPS.includes(body.group)) data.group = body.group;
  else if (data.accountType) data.group = GROUP_OF[data.accountType] || 'assets';
  if (body.accountCode !== undefined) data.accountCode = String(body.accountCode || '').slice(0, 60);
  if (body.parentId !== undefined) data.parentId = body.parentId || null;
  if (body.openingBalance !== undefined) { const n = Number(body.openingBalance); data.openingBalance = Number.isFinite(n) ? n : 0; }
  if (body.openingType !== undefined) data.openingType = body.openingType === 'credit' ? 'credit' : 'debit';
  if (body.asOfDate !== undefined) data.asOfDate = body.asOfDate ? new Date(body.asOfDate) : null;
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

exports.list = async (req, res) => {
  try {
    const { type, active } = req.query;
    const where = {};
    if (type) where.accountType = type;
    if (active === 'true' || active === '1') where.isActive = true;
    const items = await prisma.account.findMany({ where, orderBy: [{ group: 'asc' }, { name: 'asc' }] });
    res.json(toResponse(items));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name || !data.name.trim()) return res.status(400).json({ message: 'name is required' });
    if (!data.accountType) return res.status(400).json({ message: 'accountType is required' });
    if (!data.group) data.group = GROUP_OF[data.accountType] || 'assets';
    const item = await prisma.account.create({ data });
    res.status(201).json(toResponse(item));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const item = await prisma.account.update({ where: { id: req.params.id }, data: pickFields(req.body) });
    res.json(toResponse(item));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.account.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    await prisma.account.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Unified Chart of Accounts — assembles a grouped view (Assets / Liabilities /
// Equity / Expenses) from every source: new Account rows (fixed asset / capital
// / loan / other), BankAccounts, the cash bucket, Party receivables/payables
// (as Sundry Debtors/Creditors summary lines), and ExpenseCategories.
exports.chart = async (req, res) => {
  try {
    const [accounts, bankAccounts, bankRows, cashRows, invAgg, expTotAgg, expPaidRows, categories, catTotals] = await Promise.all([
      prisma.account.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }] }),
      prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }] }),
      prisma.cashBankEntry.groupBy({ by: ['bankAccountId', 'direction'], where: { bankAccountId: { not: null } }, _sum: { amount: true } }),
      prisma.cashBankEntry.groupBy({ by: ['direction'], where: { mode: 'cash' }, _sum: { amount: true } }),
      prisma.invoice.aggregate({ where: { status: { in: OPEN_INVOICE_STATUSES } }, _sum: { amountPending: true } }),
      prisma.expense.aggregate({ _sum: { amount: true } }),
      prisma.$queryRaw`SELECT COALESCE(SUM(CASE WHEN direction = 'in' THEN -amount ELSE amount END), 0) AS paid FROM cash_bank_entries WHERE expense_id IS NOT NULL`,
      prisma.expenseCategory.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true } }),
    ]);

    // Bank balances per account.
    const bankBal = new Map();
    for (const r of bankRows) {
      const sign = r.direction === 'in' ? 1 : -1;
      bankBal.set(r.bankAccountId, (bankBal.get(r.bankAccountId) || 0) + sign * (r._sum.amount || 0));
    }
    const cashBalance = Math.round(cashRows.reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * (r._sum.amount || 0), 0));
    const receivable = Math.round(invAgg._sum.amountPending || 0);
    const payable = Math.round((expTotAgg._sum.amount || 0) - Number(expPaidRows[0]?.paid || 0));
    const catTotalMap = new Map(catTotals.map((c) => [c.categoryId, Math.round(c._sum.amount || 0)]));

    const round = (n) => Math.round(Number(n) || 0);
    const accountsOfType = (t) => accounts.filter((a) => a.accountType === t)
      .map((a) => ({ id: a.id, kind: t, name: a.name, code: a.accountCode || '', balance: round(a.openingBalance) }));

    const assetLines = [
      ...bankAccounts.map((b) => ({ id: b.id, kind: 'bank', name: b.bankName, code: b.accountNumber || '', balance: round(bankBal.get(b.id) || 0) })),
      { id: 'cash', kind: 'cash', name: 'Cash in Hand', code: '', balance: cashBalance },
      ...accountsOfType('fixed_asset'),
      ...accounts.filter((a) => a.accountType === 'other' && a.group === 'assets').map((a) => ({ id: a.id, kind: 'other', name: a.name, code: a.accountCode || '', balance: round(a.openingBalance) })),
      { id: 'sundry_debtors', kind: 'sundry_debtors', name: 'Sundry Debtors', code: '', balance: receivable },
    ];
    const liabilityLines = [
      ...accountsOfType('loan'),
      ...accounts.filter((a) => a.accountType === 'other' && a.group === 'liabilities').map((a) => ({ id: a.id, kind: 'other', name: a.name, code: a.accountCode || '', balance: round(a.openingBalance) })),
      { id: 'sundry_creditors', kind: 'sundry_creditors', name: 'Sundry Creditors', code: '', balance: payable },
    ];
    const equityLines = [
      ...accountsOfType('capital'),
      ...accounts.filter((a) => a.accountType === 'other' && a.group === 'equity').map((a) => ({ id: a.id, kind: 'other', name: a.name, code: a.accountCode || '', balance: round(a.openingBalance) })),
    ];
    const expenseLines = categories.map((c) => ({ id: c.id, kind: 'expense_category', name: c.label, code: c.slug, nature: c.nature, balance: catTotalMap.get(c.id) || 0 }));

    const groupTotal = (lines) => lines.reduce((s, l) => s + l.balance, 0);
    res.json({
      groups: [
        { key: 'assets', label: 'Assets', total: groupTotal(assetLines), accounts: assetLines },
        { key: 'liabilities', label: 'Liabilities', total: groupTotal(liabilityLines), accounts: liabilityLines },
        { key: 'equity', label: 'Equity', total: groupTotal(equityLines), accounts: equityLines },
        { key: 'expenses', label: 'Expenses', total: groupTotal(expenseLines), accounts: expenseLines },
      ],
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};
