const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid'];

// Net paid on an expense = money-out − money-in across its linked cash/bank entries.
const expensePaidOf = (payments = []) =>
  Math.round(payments.reduce((s, p) => s + (p.direction === 'in' ? -1 : 1) * (Number(p.amount) || 0), 0));

// Opening balance as a signed receivable (+ they owe us, − we owe them).
const openingSigned = (p) => (p.openingType === 'to_pay' ? -1 : 1) * (Number(p.openingBalance) || 0);

// Expense payment status, matching the Expenses page rollup.
const expenseStatus = (total, paid) => {
  if (paid === 0) return total === 0 ? 'paid' : 'pending';
  return total - paid <= 0 ? 'paid' : 'partial';
};

const pickFields = (body) => {
  const data = {};
  const str = (k, max) => { if (body[k] !== undefined) data[k] = String(body[k] || '').slice(0, max); };
  str('name', 200); str('phone', 30); str('gstin', 20); str('email', 120);
  str('partyGroup', 100); str('gstType', 40); str('state', 60);
  str('billingAddress', 500); str('shippingAddress', 500);
  if (body.gstin !== undefined) data.gstin = String(body.gstin || '').toUpperCase().slice(0, 20);
  if (body.openingBalance !== undefined) {
    const n = Number(body.openingBalance);
    data.openingBalance = Number.isFinite(n) ? n : 0;
  }
  if (body.openingType !== undefined) data.openingType = body.openingType === 'to_pay' ? 'to_pay' : 'to_collect';
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

// One pass of global aggregates → per-party receivable (open invoices) and
// payable (expense total − paid). Used to attach a balance to each party row.
async function computeBalances() {
  const [invAgg, expAgg, paidRows] = await Promise.all([
    prisma.invoice.groupBy({ by: ['partyId'], where: { partyId: { not: null }, status: { in: OPEN_INVOICE_STATUSES } }, _sum: { amountPending: true } }),
    prisma.expense.groupBy({ by: ['partyId'], where: { partyId: { not: null } }, _sum: { amount: true } }),
    prisma.$queryRaw`
      SELECT e.party_id AS "partyId",
             COALESCE(SUM(CASE WHEN cbe.direction = 'in' THEN -cbe.amount ELSE cbe.amount END), 0) AS paid
      FROM cash_bank_entries cbe
      JOIN expenses e ON e.id = cbe.expense_id
      WHERE e.party_id IS NOT NULL
      GROUP BY e.party_id`,
  ]);
  const receivable = new Map(invAgg.map((r) => [r.partyId, Math.round(r._sum.amountPending || 0)]));
  const expTotal = new Map(expAgg.map((r) => [r.partyId, Math.round(r._sum.amount || 0)]));
  const expPaid = new Map(paidRows.map((r) => [r.partyId, Math.round(Number(r.paid) || 0)]));
  return { receivable, expTotal, expPaid };
}

const partyBalance = (p, b) => {
  const recv = b.receivable.get(p.id) || 0;
  const payable = (b.expTotal.get(p.id) || 0) - (b.expPaid.get(p.id) || 0);
  return Math.round(openingSigned(p) + recv - payable);
};

exports.list = async (req, res) => {
  try {
    const { q, active } = req.query;
    const where = {};
    if (active === 'true' || active === '1') where.isActive = true;
    if (q && q.trim()) where.name = { contains: q.trim(), mode: 'insensitive' };
    const [parties, balances] = await Promise.all([
      prisma.party.findMany({ where, orderBy: { name: 'asc' } }),
      computeBalances(),
    ]);
    res.json(parties.map((p) => ({ ...toResponse(p), balance: partyBalance(p, balances) })));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const party = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!party) return res.status(404).json({ message: 'Not found' });
    const balances = await computeBalances();
    res.json({ ...toResponse(party), balance: partyBalance(party, balances) });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Full transaction ledger for one party: invoices (receivable) + their receipts,
// expenses (payable) + their payouts. Each row carries its own outstanding
// balance and status; the party's net balance is returned alongside.
exports.ledger = async (req, res) => {
  try {
    const partyId = req.params.id;
    const party = await prisma.party.findUnique({ where: { id: partyId } });
    if (!party) return res.status(404).json({ message: 'Not found' });

    const [invoices, expenses] = await Promise.all([
      prisma.invoice.findMany({
        where: { partyId },
        select: {
          id: true, invoiceNumber: true, grandTotal: true, amountPending: true, status: true,
          invoiceDate: true, issuedAt: true, createdAt: true, dueDate: true,
          payments: { select: { id: true, direction: true, amount: true, date: true } },
        },
      }),
      prisma.expense.findMany({
        where: { partyId },
        select: {
          id: true, amount: true, date: true, notes: true,
          category: { select: { label: true } },
          payments: { select: { id: true, direction: true, amount: true, date: true } },
        },
      }),
    ]);

    const rows = [];
    let receivable = 0;
    for (const inv of invoices) {
      const pending = Math.round(inv.amountPending || 0);
      if (OPEN_INVOICE_STATUSES.includes(inv.status)) receivable += pending;
      rows.push({
        type: 'invoice', name: inv.invoiceNumber || 'Invoice', number: inv.invoiceNumber || null,
        date: inv.invoiceDate || inv.issuedAt || inv.createdAt, total: Math.round(inv.grandTotal || 0),
        balance: pending, dueDate: inv.dueDate || null, status: inv.status,
      });
      for (const pay of inv.payments.filter((p) => p.direction === 'in')) {
        rows.push({ type: 'payment_in', name: 'Payment-In', number: null, date: pay.date, total: Math.round(pay.amount || 0), balance: 0, dueDate: null, status: 'used' });
      }
    }

    let payable = 0;
    for (const e of expenses) {
      const total = Math.round(e.amount || 0);
      const paid = expensePaidOf(e.payments);
      const pending = total - paid;
      payable += pending;
      rows.push({
        type: 'expense', name: e.category?.label || e.notes || 'Expense', number: null,
        date: e.date, total, balance: pending, dueDate: null, status: expenseStatus(total, paid),
      });
      for (const pay of e.payments.filter((p) => p.direction === 'out')) {
        rows.push({ type: 'payment_out', name: 'Payment-Out', number: null, date: pay.date, total: Math.round(pay.amount || 0), balance: 0, dueDate: null, status: 'used' });
      }
    }

    rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    const balance = Math.round(openingSigned(party) + receivable - payable);
    res.json({ party: toResponse(party), balance, receivable: Math.round(receivable), payable: Math.round(payable), transactions: rows });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name || !data.name.trim()) return res.status(400).json({ message: 'name is required' });
    const party = await prisma.party.create({ data });
    res.status(201).json(toResponse(party));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const party = await prisma.party.update({ where: { id: req.params.id }, data: pickFields(req.body) });
    res.json(toResponse(party));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Merge a duplicate party (:id) into another (body.into): move its invoices +
// expenses to the target, transfer its hospital/reference link if the target
// has none, then delete the source.
exports.merge = async (req, res) => {
  try {
    const sourceId = req.params.id;
    const targetId = req.body.into;
    if (!targetId) return res.status(400).json({ message: 'Target party (into) is required' });
    if (targetId === sourceId) return res.status(400).json({ message: 'Cannot merge a party into itself' });
    const [source, target] = await Promise.all([
      prisma.party.findUnique({ where: { id: sourceId } }),
      prisma.party.findUnique({ where: { id: targetId } }),
    ]);
    if (!source || !target) return res.status(404).json({ message: 'Party not found' });

    const merged = await prisma.$transaction(async (tx) => {
      await tx.invoice.updateMany({ where: { partyId: sourceId }, data: { partyId: targetId } });
      await tx.expense.updateMany({ where: { partyId: sourceId }, data: { partyId: targetId } });
      // Only one party may link a given hospital/reference (unique index), so
      // clear the source's links first, then hand any the target lacks over.
      const linkPatch = {};
      if (source.hospitalId && !target.hospitalId) linkPatch.hospitalId = source.hospitalId;
      if (source.referenceId && !target.referenceId) linkPatch.referenceId = source.referenceId;
      await tx.party.update({ where: { id: sourceId }, data: { hospitalId: null, referenceId: null } });
      if (Object.keys(linkPatch).length) await tx.party.update({ where: { id: targetId }, data: linkPatch });
      await tx.party.delete({ where: { id: sourceId } });
      return tx.party.findUnique({ where: { id: targetId } });
    });
    res.json(toResponse(merged));
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.party.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const [invCount, expCount] = await Promise.all([
      prisma.invoice.count({ where: { partyId: req.params.id } }),
      prisma.expense.count({ where: { partyId: req.params.id } }),
    ]);
    // Keep parties with history (or that mirror a master) — just deactivate them.
    if (invCount > 0 || expCount > 0 || existing.hospitalId || existing.referenceId) {
      const party = await prisma.party.update({ where: { id: req.params.id }, data: { isActive: false } });
      return res.json({ ...toResponse(party), softDeleted: true });
    }
    await prisma.party.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};
