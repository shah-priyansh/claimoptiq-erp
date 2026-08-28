const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { recomputeInvoicePaidStatus } = require('../utils/invoicePaidRollup');
const { getJournalNetByAccount, journalKey } = require('../services/journalBalances');

const VALID_DIRECTIONS = ['in', 'out'];
const VALID_MODES = ['cash', 'bank', 'upi'];

const cashBankInclude = {
  invoice: { select: { id: true, invoiceNumber: true, hospital: { select: { id: true, name: true } } } },
  expense: { select: { id: true, amount: true, notes: true, date: true, category: { select: { id: true, label: true, slug: true } } } },
  hospital: { select: { id: true, name: true } },
  bankAccount: { select: { id: true, bankName: true, accountNumber: true, ifsc: true } },
  createdBy: { select: { id: true, name: true } },
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

const norm = (s) => String(s || '').trim().toLowerCase();

// Loose date parser for bulk import — accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
// and Excel serials. Returns a UTC-midnight Date or null.
const parseImportDate = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) ? null : d;
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    let day = +a, month = +b;
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    if (!day || !month || day > 31 || month > 12) return null;
    const d = new Date(Date.UTC(+yy, month - 1, day));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== month - 1) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Common synonyms operators type instead of the canonical in/out.
const DIRECTION_SYNONYMS = {
  in: 'in', received: 'in', receipt: 'in', credit: 'in', deposit: 'in',
  out: 'out', paid: 'out', payment: 'out', debit: 'out', withdrawal: 'out',
};

// Build the persisted shape from a request body. Throws { status, message } for client errors.
const buildEntryData = async (body) => {
  const date = parseDate(body.date);
  if (!date) throw { status: 400, message: 'Valid date is required' };
  const direction = String(body.direction || '').trim();
  if (!VALID_DIRECTIONS.includes(direction)) throw { status: 400, message: `direction must be one of: ${VALID_DIRECTIONS.join(', ')}` };
  const mode = String(body.mode || '').trim();
  if (!VALID_MODES.includes(mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(', ')}` };
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw { status: 400, message: 'amount must be a positive number (use opposite direction to reverse)' };
  }

  const invoiceId = body.invoiceId || null;
  const expenseId = body.expenseId || null;
  if (invoiceId && expenseId) {
    throw { status: 400, message: 'An entry can link to at most one of invoiceId / expenseId' };
  }

  let hospitalId = body.hospitalId || null;

  // Denormalize hospitalId from the invoice when invoice is the link target.
  if (invoiceId) {
    const inv = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { hospitalId: true, status: true } });
    if (!inv) throw { status: 400, message: 'Invoice not found' };
    if (inv.status === 'draft') throw { status: 400, message: 'Cannot record payment against a draft invoice. Issue it first.' };
    if (inv.status === 'void') throw { status: 400, message: 'Cannot record payment against a voided invoice.' };
    hospitalId = inv.hospitalId;
  }
  if (expenseId) {
    const exp = await prisma.expense.findUnique({ where: { id: expenseId }, select: { id: true } });
    if (!exp) throw { status: 400, message: 'Expense not found' };
  }

  // Bank/UPI entries must reference a specific configured bank account so
  // per-account balances stay correct. We accept it directly OR fall back
  // to the default account when the client doesn't pick one.
  let bankAccountId = body.bankAccountId || null;
  if (mode === 'bank' || mode === 'upi') {
    if (!bankAccountId) {
      const def = await prisma.bankAccount.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
      bankAccountId = def?.id || null;
    }
    if (!bankAccountId) {
      throw { status: 400, message: 'Bank / UPI entries need a bank account. Add one in Site Settings → Bank Accounts.' };
    }
    const acct = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, isActive: true } });
    if (!acct) throw { status: 400, message: 'Bank account not found' };
    if (!acct.isActive) throw { status: 400, message: 'Bank account is inactive' };
  } else {
    // Cash entries never carry a bank account.
    bankAccountId = null;
  }

  return {
    date,
    direction,
    mode,
    amount: Math.round(amount),
    notes: String(body.notes || '').slice(0, 1000),
    invoiceId,
    expenseId,
    hospitalId,
    bankAccountId,
    utrNumber: String(body.utrNumber || '').slice(0, 60),
    chequeNumber: String(body.chequeNumber || '').slice(0, 60),
  };
};

// Money already paid on an expense = Σ its linked cash/bank entries ('out' pays
// it down, an 'in' refund adds back). Expense.payments IS the CashBankEntry[]
// relation, so an expense has no stored paid field — it's derived here.
const paidOnExpense = (payments = []) =>
  Math.round((payments || []).reduce((s, p) => s + (p.direction === 'in' ? -1 : 1) * (Number(p.amount) || 0), 0));

// ── Shared core for "split one payment into one entry per bill" ──────────────
// bulkReceipt (hospital-scoped), allocatePartyPayment (party-scoped) and
// createSplit (generic) all record ONE cashBankEntry per allocation so each
// invoice/expense keeps its own paid rollup. This is the single implementation
// they delegate to: it validates, resolves the bank account, enforces the
// universal rules (bills exist, invoices aren't draft/void, amount ≤ pending),
// creates the entries and recomputes invoice paid-status. Callers do their own
// SCOPE checks (same hospital / same party) via the optional validate* hooks.
// Kept lean — creates with a minimal select and re-fetches after the tx — so the
// remote DB's 5s interactive-transaction budget isn't blown when many bills are
// linked. Returns the fully-included entries (caller wraps with toResponse).
const createAllocationEntries = async ({
  direction, mode, date, bankAccountId, utrNumber, chequeNumber, notes,
  allocations, userId, validateInvoice = null, validateExpense = null,
}) => {
  const parsedDate = parseDate(date);
  if (!parsedDate) throw { status: 400, message: 'Valid date is required' };
  if (direction !== 'in' && direction !== 'out') throw { status: 400, message: "direction must be 'in' or 'out'" };
  if (!VALID_MODES.includes(mode)) throw { status: 400, message: `mode must be one of: ${VALID_MODES.join(', ')}` };
  if (!Array.isArray(allocations) || !allocations.length) throw { status: 400, message: 'At least one allocation is required' };

  const normalised = allocations.map((a) => ({
    invoiceId: a?.invoiceId || null,
    expenseId: a?.expenseId || null,
    amount: Math.round(Number(a?.amount) || 0),
  }));
  for (const a of normalised) {
    if (a.invoiceId && a.expenseId) throw { status: 400, message: 'An allocation links to at most one of invoice / expense' };
    if (!a.invoiceId && !a.expenseId) throw { status: 400, message: 'Each allocation needs an invoice or an expense' };
    if (a.amount <= 0) throw { status: 400, message: 'Each allocation amount must be greater than zero' };
  }
  if (direction === 'in' && normalised.some((a) => a.expenseId)) throw { status: 400, message: 'Money-in entries link invoices, not expenses' };
  if (direction === 'out' && normalised.some((a) => a.invoiceId)) throw { status: 400, message: 'Money-out entries link expenses, not invoices' };
  const refIds = normalised.map((a) => a.invoiceId || a.expenseId);
  if (new Set(refIds).size !== refIds.length) throw { status: 400, message: 'Duplicate invoice / expense in allocations' };

  // Bank account resolution — bank/upi need one (mirrors buildEntryData).
  let resolvedBankAccountId = bankAccountId || null;
  if (mode === 'bank' || mode === 'upi') {
    if (!resolvedBankAccountId) {
      const def = await prisma.bankAccount.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
      resolvedBankAccountId = def?.id || null;
    }
    if (!resolvedBankAccountId) throw { status: 400, message: 'Bank / UPI entries need a bank account. Add one in Site Settings → Bank Accounts.' };
    const acct = await prisma.bankAccount.findUnique({ where: { id: resolvedBankAccountId }, select: { id: true, isActive: true } });
    if (!acct) throw { status: 400, message: 'Bank account not found' };
    if (!acct.isActive) throw { status: 400, message: 'Bank account is inactive' };
  } else {
    resolvedBankAccountId = null;
  }

  // Validate targets + enforce the pending cap. hospitalId is denormalised from
  // each invoice; expenses carry none.
  const invIds = normalised.filter((a) => a.invoiceId).map((a) => a.invoiceId);
  const expIds = normalised.filter((a) => a.expenseId).map((a) => a.expenseId);
  const invById = new Map();
  if (invIds.length) {
    const invoices = await prisma.invoice.findMany({
      where: { id: { in: invIds } },
      select: { id: true, status: true, amountPending: true, hospitalId: true, partyId: true },
    });
    for (const i of invoices) invById.set(i.id, i);
  }
  const expById = new Map();
  if (expIds.length) {
    const expenses = await prisma.expense.findMany({
      where: { id: { in: expIds } },
      select: { id: true, amount: true, partyId: true, payments: { select: { direction: true, amount: true } } },
    });
    for (const e of expenses) expById.set(e.id, e);
  }
  for (const a of normalised) {
    if (a.invoiceId) {
      const inv = invById.get(a.invoiceId);
      if (!inv) throw { status: 400, message: 'Invoice not found' };
      if (inv.status === 'draft') throw { status: 400, message: 'Cannot record payment against a draft invoice. Issue it first.' };
      if (inv.status === 'void') throw { status: 400, message: 'Cannot record payment against a voided invoice.' };
      if (validateInvoice) validateInvoice(inv);
      if (a.amount > Math.round(inv.amountPending || 0)) throw { status: 400, message: 'Allocation exceeds the invoice pending amount' };
    } else {
      const exp = expById.get(a.expenseId);
      if (!exp) throw { status: 400, message: 'Expense not found' };
      if (validateExpense) validateExpense(exp);
      const pending = Math.round((exp.amount || 0) - paidOnExpense(exp.payments));
      if (a.amount > pending) throw { status: 400, message: 'Allocation exceeds the expense pending amount' };
    }
  }

  const sharedData = {
    date: parsedDate,
    direction,
    mode,
    bankAccountId: resolvedBankAccountId,
    utrNumber: String(utrNumber || '').slice(0, 60),
    chequeNumber: String(chequeNumber || '').slice(0, 60),
    notes: String(notes || '').slice(0, 1000),
  };

  const createdIds = await prisma.$transaction(async (tx) => {
    const ids = [];
    for (const a of normalised) {
      const hospitalId = a.invoiceId ? (invById.get(a.invoiceId)?.hospitalId || null) : null;
      const e = await tx.cashBankEntry.create({
        data: { ...sharedData, amount: a.amount, invoiceId: a.invoiceId, expenseId: a.expenseId, hospitalId, createdById: userId || null },
        select: { id: true },
      });
      ids.push(e.id);
    }
    for (const a of normalised) { if (a.invoiceId) await recomputeInvoicePaidStatus(tx, a.invoiceId); }
    return ids;
  }, { timeout: 20000 });

  return prisma.cashBankEntry.findMany({ where: { id: { in: createdIds } }, include: cashBankInclude });
};

// A journal line that debits/credits cash or bank is money moving through those
// accounts, so it belongs in the Cash/Bank list next to Payment-In/Out entries
// (the balances endpoint already folds these in — this keeps the list in sync).
// A debit to the asset is money in (+), a credit is money out (−). Read-only
// here: journal entries are edited from the Account Entries module.
const journalLineToRow = (l) => {
  const isIn = (l.debit || 0) > 0;
  return {
    _id: `journal:${l.id}`,
    source: 'journal',
    journalEntryId: l.entry.id,
    refNumber: l.entry.refNumber,
    direction: isIn ? 'in' : 'out',
    mode: l.accountKind === 'cash' ? 'cash' : 'bank',
    amount: isIn ? (l.debit || 0) : (l.credit || 0),
    date: l.entry.date,
    createdAt: l.entry.createdAt,
    notes: l.entry.description || '',
    accountName: l.accountName || '',
    invoice: null, expense: null, hospital: null, bankAccount: null,
    utrNumber: '', chequeNumber: '',
  };
};

exports.list = async (req, res) => {
  try {
    const { from, to, direction, mode, hospitalId, invoiceId, expenseId, bankAccountId, q, page, limit = 25 } = req.query;
    const where = {};
    if (direction) where.direction = direction;
    if (mode) where.mode = mode;
    if (hospitalId) where.hospitalId = hospitalId;
    if (invoiceId) where.invoiceId = invoiceId;
    if (expenseId) where.expenseId = expenseId;
    if (bankAccountId) where.bankAccountId = bankAccountId;
    const fromD = parseDate(from);
    const toD = parseDate(to);
    let toDInclusive = null;
    if (toD) { toDInclusive = new Date(toD); toDInclusive.setUTCHours(23, 59, 59, 999); }
    if (fromD || toDInclusive) {
      where.date = {};
      if (fromD) where.date.gte = fromD;
      if (toDInclusive) where.date.lte = toDInclusive;
    }
    const qq = q && q.trim() ? q.trim() : '';
    if (qq) {
      where.OR = [
        { notes: { contains: qq, mode: 'insensitive' } },
        { utrNumber: { contains: qq, mode: 'insensitive' } },
        { chequeNumber: { contains: qq, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(Number(limit) || 25, 200);
    const skip = page ? (Number(page) - 1) * take : 0;

    // Journal lines don't carry invoice/expense/hospital links and never touch
    // the UPI bucket, so only fold them in when none of those narrowing filters
    // are active. Otherwise fall back to the plain, SQL-paginated entry list.
    const includeJournal = !invoiceId && !expenseId && !hospitalId && mode !== 'upi';
    if (!includeJournal) {
      const [items, total] = await Promise.all([
        prisma.cashBankEntry.findMany({
          where, include: cashBankInclude,
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
          skip, take,
        }),
        prisma.cashBankEntry.count({ where }),
      ]);
      return res.json({ entries: toResponse(items), total, pages: Math.ceil(total / take) });
    }

    // Build the parallel filter for journal cash/bank lines.
    const journalWhere = {};
    if (mode === 'cash') journalWhere.accountKind = 'cash';
    else if (mode === 'bank') journalWhere.accountKind = 'bank';
    else journalWhere.accountKind = { in: ['cash', 'bank'] };
    if (bankAccountId) { journalWhere.accountKind = 'bank'; journalWhere.accountId = bankAccountId; }
    if (direction === 'in') journalWhere.debit = { gt: 0 };
    else if (direction === 'out') journalWhere.credit = { gt: 0 };
    const entryFilter = {};
    if (fromD || toDInclusive) {
      entryFilter.date = {};
      if (fromD) entryFilter.date.gte = fromD;
      if (toDInclusive) entryFilter.date.lte = toDInclusive;
    }
    if (Object.keys(entryFilter).length) journalWhere.entry = entryFilter;
    if (qq) {
      journalWhere.OR = [
        { accountName: { contains: qq, mode: 'insensitive' } },
        { entry: { is: { description: { contains: qq, mode: 'insensitive' } } } },
        { entry: { is: { refNumber: { contains: qq, mode: 'insensitive' } } } },
      ];
    }

    // Merge path: pull all matching entries + journal lines, combine, sort by
    // date, then paginate the unified list. Single-tenant scale keeps this cheap.
    const [cbAll, jLines] = await Promise.all([
      prisma.cashBankEntry.findMany({
        where, include: cashBankInclude,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.journalLine.findMany({
        where: journalWhere,
        include: { entry: { select: { id: true, refNumber: true, date: true, description: true, createdAt: true } } },
      }),
    ]);

    const merged = [...toResponse(cbAll), ...jLines.map(journalLineToRow)].sort((a, b) => {
      const d = new Date(b.date) - new Date(a.date);
      if (d) return d;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
    const total = merged.length;
    res.json({ entries: merged.slice(skip, skip + take), total, pages: Math.ceil(total / take) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Current running balance per mode:
//   balance(mode) = Σ CashBankEntry IN to that mode
//                 − Σ CashBankEntry OUT from that mode
//                 + Σ AccountEntry contra toMode == this mode
//                 − Σ AccountEntry contra fromMode == this mode
exports.balances = async (req, res) => {
  try {
    const [cashBankGrouped, contraTo, contraFrom] = await Promise.all([
      prisma.cashBankEntry.groupBy({ by: ['mode', 'direction'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['toMode'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['fromMode'], _sum: { amount: true } }),
    ]);
    const out = { cash: 0, bank: 0, upi: 0 };
    for (const row of cashBankGrouped) {
      const sign = row.direction === 'in' ? 1 : -1;
      out[row.mode] = (out[row.mode] || 0) + sign * (row._sum.amount || 0);
    }
    for (const row of contraTo) {
      if (row.toMode && out[row.toMode] !== undefined) out[row.toMode] += row._sum.amount || 0;
    }
    for (const row of contraFrom) {
      if (row.fromMode && out[row.fromMode] !== undefined) out[row.fromMode] -= row._sum.amount || 0;
    }
    // Fold Journal Entry lines: a debit to cash/bank increases it, a credit decreases it.
    const jnet = await getJournalNetByAccount(prisma);
    out.cash += jnet.get(journalKey('cash', null)) || 0;
    for (const [key, val] of jnet) { if (key.startsWith('bank:')) out.bank += val; }
    out.total = out.cash + out.bank + out.upi;
    res.json({
      cash: Math.round(out.cash),
      bank: Math.round(out.bank),
      upi:  Math.round(out.upi),
      total: Math.round(out.total),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// In/out totals per mode for a date range. Used by Reports (2.6).
exports.summary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const where = {};
    const fromD = parseDate(from);
    const toD = parseDate(to);
    if (fromD || toD) {
      where.date = {};
      if (fromD) where.date.gte = fromD;
      if (toD) {
        const inclusive = new Date(toD);
        inclusive.setUTCHours(23, 59, 59, 999);
        where.date.lte = inclusive;
      }
    }
    const grouped = await prisma.cashBankEntry.groupBy({
      where, by: ['mode', 'direction'], _sum: { amount: true },
    });
    const shape = (mode) => ({ in: 0, out: 0 });
    const out = { cash: shape(), bank: shape(), upi: shape() };
    for (const row of grouped) {
      if (!out[row.mode]) continue;
      out[row.mode][row.direction] = Math.round(row._sum.amount || 0);
    }
    const totalIn = out.cash.in + out.bank.in + out.upi.in;
    const totalOut = out.cash.out + out.bank.out + out.upi.out;
    res.json({ ...out, totalIn, totalOut, net: totalIn - totalOut });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id }, include: cashBankInclude });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = await buildEntryData(req.body);
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.cashBankEntry.create({
        data: { ...data, createdById: req.user?.id || null },
        include: cashBankInclude,
      });
      if (data.invoiceId) await recomputeInvoicePaidStatus(tx, data.invoiceId);
      return created;
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// POST /api/cash-bank/split — one payment linked to several invoices (money in)
// or several expenses (money out). Like bulkReceipt/allocatePartyPayment, each
// allocation becomes its OWN cash/bank entry so per-invoice/expense paid rollups
// stay correct — but generic (any hospital, either direction). The Cash/Bank
// entry form posts here when the operator links more than one bill.
exports.createSplit = async (req, res) => {
  try {
    const { date, direction, mode, bankAccountId, utrNumber, chequeNumber, notes, allocations } = req.body;
    const entries = await createAllocationEntries({
      direction, mode, date, bankAccountId, utrNumber, chequeNumber, notes,
      allocations, userId: req.user?.id,
    });
    res.status(201).json({ entries: toResponse(entries) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Bulk import — each valid row creates a standalone cash/bank movement
// (append-only). Invoice/expense reconciliation links are intentionally out of
// scope for import; do those in-app. Bank account is resolved by name / account
// number; validation is delegated to buildEntryData() for parity with single-add.
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const banks = await prisma.bankAccount.findMany({ select: { id: true, bankName: true, accountNumber: true } });
    const bankMap = new Map();
    const addBank = (k, b) => { const n = norm(k); if (n && !bankMap.has(n)) bankMap.set(n, b); };
    for (const b of banks) {
      addBank(b.bankName, b);
      if (b.accountNumber) {
        addBank(b.accountNumber, b);
        addBank(`${b.bankName} - ${b.accountNumber}`, b);
        addBank(`${b.bankName} ${b.accountNumber}`, b);
      }
    }

    const created = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const label = `${norm(row.direction) || '?'}/${norm(row.mode) || '?'}`;
      try {
        const dateVal = parseImportDate(row.date);
        if (!dateVal) throw { message: row.date ? `Date invalid: "${row.date}"` : 'Date is required' };
        const direction = DIRECTION_SYNONYMS[norm(row.direction)] || norm(row.direction);
        const mode = norm(row.mode);

        let bankAccountId = null;
        const bankRaw = String(row.bankAccount ?? '').trim();
        if (bankRaw) {
          const b = bankMap.get(norm(bankRaw));
          if (!b) throw { message: `Bank account not found: "${bankRaw}"` };
          bankAccountId = b.id;
        }

        const data = await buildEntryData({
          date: dateVal,
          direction,
          mode,
          amount: String(row.amount ?? '').replace(/,/g, '').trim(),
          bankAccountId,
          notes: row.notes,
          utrNumber: row.utrNumber,
          chequeNumber: row.chequeNumber,
        });
        const entry = await prisma.cashBankEntry.create({
          data: { ...data, createdById: req.user?.id || null },
          select: { id: true },
        });
        created.push({ row: rowNum, id: entry.id, name: label });
      } catch (e) {
        errors.push({ row: rowNum, name: label, errors: [e.message || 'Failed to save'] });
      }
    }

    const successCount = created.length;
    res.json({
      message: `Imported ${successCount} of ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`,
      created,
      errors,
      totalRows: rows.length,
      successCount,
      createdCount: successCount,
      updatedCount: 0,
      skippedCount: 0,
      errorCount: errors.length,
      mode: 'append',
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const merged = await buildEntryData({
      date: req.body.date ?? existing.date,
      direction: req.body.direction ?? existing.direction,
      mode: req.body.mode ?? existing.mode,
      amount: req.body.amount ?? existing.amount,
      notes: req.body.notes ?? existing.notes,
      invoiceId: req.body.invoiceId !== undefined ? req.body.invoiceId : existing.invoiceId,
      expenseId: req.body.expenseId !== undefined ? req.body.expenseId : existing.expenseId,
      hospitalId: req.body.hospitalId !== undefined ? req.body.hospitalId : existing.hospitalId,
      bankAccountId: req.body.bankAccountId !== undefined ? req.body.bankAccountId : existing.bankAccountId,
      utrNumber: req.body.utrNumber ?? existing.utrNumber,
      chequeNumber: req.body.chequeNumber ?? existing.chequeNumber,
    });

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.cashBankEntry.update({ where: { id: req.params.id }, data: merged, include: cashBankInclude });
      // Recompute both the old and new invoice (if either changed)
      const oldInv = existing.invoiceId;
      const newInv = merged.invoiceId;
      if (oldInv && oldInv !== newInv) await recomputeInvoicePaidStatus(tx, oldInv);
      if (newInv) await recomputeInvoicePaidStatus(tx, newInv);
      return updated;
    });
    res.json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.cashBankEntry.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    await prisma.$transaction(async (tx) => {
      await tx.cashBankEntry.delete({ where: { id: req.params.id } });
      if (existing.invoiceId) await recomputeInvoicePaidStatus(tx, existing.invoiceId);
    });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// POST /api/cash-bank/bulk-receipt — record one payment from a hospital that
// is split across multiple of that hospital's invoices. Creates one
// cashBankEntry per allocation inside a single transaction so paid status on
// every invoice updates atomically.
exports.bulkReceipt = async (req, res) => {
  try {
    const { hospitalId, date, mode, bankAccountId, utrNumber, chequeNumber, notes, allocations } = req.body;
    if (!hospitalId) throw { status: 400, message: 'hospitalId is required' };
    if (!Array.isArray(allocations) || !allocations.length) throw { status: 400, message: 'At least one invoice allocation is required' };

    const entries = await createAllocationEntries({
      direction: 'in', mode, date, bankAccountId, utrNumber, chequeNumber, notes,
      allocations: allocations.map((a) => ({ invoiceId: a?.invoiceId, amount: a?.amount })),
      userId: req.user?.id,
      validateInvoice: (inv) => { if (inv.hospitalId !== hospitalId) throw { status: 400, message: 'All invoices must belong to the same hospital' }; },
    });

    res.status(201).json({ entries: toResponse(entries) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Allocate ONE party payment across several of that party's open transactions —
// invoices for direction 'in' (money received), expenses for 'out' (money paid).
// Each allocation becomes its own cash/bank entry so per-invoice/expense paid
// rollups stay correct. Mirrors bulkReceipt but party-scoped and dual-direction.
exports.allocatePartyPayment = async (req, res) => {
  try {
    const { partyId, direction, date, mode, bankAccountId, utrNumber, chequeNumber, notes, allocations } = req.body;
    if (!partyId) throw { status: 400, message: 'partyId is required' };
    if (direction !== 'in' && direction !== 'out') throw { status: 400, message: "direction must be 'in' or 'out'" };
    if (!Array.isArray(allocations) || !allocations.length) throw { status: 400, message: 'At least one allocation is required' };

    const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
    if (!party) throw { status: 404, message: 'Party not found' };

    // The party UI sends generic `refId`s — map them to invoice/expense by direction.
    const mapped = (allocations || []).map((a) => (direction === 'in'
      ? { invoiceId: String(a?.refId || ''), amount: a?.amount }
      : { expenseId: String(a?.refId || ''), amount: a?.amount }));

    const entries = await createAllocationEntries({
      direction, mode, date, bankAccountId, utrNumber, chequeNumber, notes,
      allocations: mapped, userId: req.user?.id,
      validateInvoice: (inv) => { if (inv.partyId !== partyId) throw { status: 400, message: 'All invoices must belong to this party' }; },
      validateExpense: (exp) => { if (exp.partyId !== partyId) throw { status: 400, message: 'All expenses must belong to this party' }; },
    });

    res.status(201).json({ entries: toResponse(entries) });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// POST /api/invoices/:id/payments — convenience wrapper for the invoice detail UI.
exports.recordInvoicePayment = async (req, res) => {
  try {
    req.body.invoiceId = req.params.id;
    req.body.direction = 'in';
    return exports.create(req, res);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
