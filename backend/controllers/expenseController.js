const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { normalizeQtyRateLine } = require('../utils/lineQty');
const { payableOf, computeExpenseTax } = require('../utils/expenseTotals');

// Raw tax/adjustment inputs off the request body, each falling back to an
// existing value (used on update so an unrelated edit never wipes stored taxes).
const pickTaxInput = (body, fallback = {}) => {
  const take = (k) => (body[k] !== undefined ? body[k] : fallback[k]) || 0;
  return {
    gstRate: take('gstRate'), tdsRate: take('tdsRate'),
    discount: take('discount'), roundOff: take('roundOff'),
  };
};

// Expense amounts carry paisa (a ₹899.37 petrol bill), so round to 2 decimals —
// never to whole rupees, which silently dropped the paisa on save and made a
// fully-paid expense still read a ₹0.37 balance.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const expenseInclude = {
  category: { select: { id: true, slug: true, label: true, isSystem: true, nature: true } },
  reference: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  // The cash/bank OUT movement(s) that pay this expense. Kept in sync by
  // create/update/remove so Total On Hand reflects money actually spent.
  payments: { select: { id: true, mode: true, bankAccountId: true, direction: true, amount: true } },
  // Invoice-style qty/rate line items. The expense's amount is the sum of these.
  lineItems: { orderBy: { order: 'asc' } },
};

// Normalize an incoming expense `lineItems[]` into stored rows + their summed
// total. Returns null when the body carries no lineItems array (older callers /
// bulk import that still send a flat `amount`). Amounts are always recomputed
// server-side from rate x qty (see utils/lineQty.js); the client total is ignored.
const buildExpenseLines = (body) => {
  if (!Array.isArray(body.lineItems)) return null;
  const lines = body.lineItems
    .map((raw, order) => {
      const description = String(raw?.description || '').slice(0, 300).trim();
      const hasQtyRate = raw?.rate != null || raw?.qtyRaw != null || raw?.qty != null;
      const { rate, qtyRaw, qtyIsPercent, qtyValue, amount } = hasQtyRate
        ? normalizeQtyRateLine({ rate: raw.rate, qtyRaw: raw.qtyRaw ?? raw.qty })
        : normalizeQtyRateLine({ rate: raw?.amount });
      return { description, rate, qtyRaw, qtyIsPercent, qtyValue, amount, order };
    })
    .filter((l) => l.description || l.amount);
  const total = round2(lines.reduce((s, l) => s + l.amount, 0));
  return { lines, total };
};

// Payment rollup for one expense, derived from its linked cash/bank entries
// (money-out pays the expense; a money-in reversal offsets it). Mirrors the
// invoice paid/pending/status model, but computed on the fly since Expense has
// no stored paid columns. Status: paid (fully settled) / partial / pending.
const rollupPayment = (amount, payments = []) => {
  const total = round2(Number(amount) || 0);
  const amountPaid = round2(
    payments.reduce((s, p) => s + (p.direction === 'in' ? -1 : 1) * (Number(p.amount) || 0), 0)
  );
  const amountPending = round2(total - amountPaid);
  let paymentStatus;
  if (amountPaid === 0) paymentStatus = total === 0 ? 'paid' : 'pending';
  else if (amountPending <= 0) paymentStatus = 'paid';
  else paymentStatus = 'partial';
  return { amountPaid, amountPending, paymentStatus };
};

const VALID_MODES = ['cash', 'bank', 'upi'];

// Resolve how an expense was paid so the outflow can be mirrored into the
// cashbook as a cash/bank/upi OUT entry (that's what Total On Hand sums).
// Returns { mode, bankAccountId } — or null when the caller opts out of
// payment tracking (paymentMode === 'none'). Defaults to cash so a plain
// expense still reduces on-hand. Throws { status, message } for bad bank refs.
const resolvePayment = async (body) => {
  const raw = String(body.paymentMode ?? body.mode ?? 'cash').trim().toLowerCase();
  if (raw === 'none') return null;
  const mode = VALID_MODES.includes(raw) ? raw : 'cash';
  let bankAccountId = body.bankAccountId || null;
  if (mode === 'bank' || mode === 'upi') {
    if (!bankAccountId) {
      const def = await prisma.bankAccount.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
      bankAccountId = def?.id || null;
    }
    if (!bankAccountId) throw { status: 400, message: 'Bank / UPI expense needs a bank account. Add one in Site Settings → Bank Accounts.' };
    const acct = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, isActive: true } });
    if (!acct) throw { status: 400, message: 'Bank account not found' };
    if (!acct.isActive) throw { status: 400, message: 'Bank account is inactive' };
  } else {
    bankAccountId = null; // cash never carries a bank account
  }
  return { mode, bankAccountId };
};

// Shape the linked cashBankEntry for an expense, recording `payAmt` (the amount
// actually paid). cashBankEntry.amount must be positive, so a negative pay
// amount (a reversal) becomes an IN of the absolute amount instead of an OUT.
const paymentEntryFields = (expense, payment, category, payAmt) => {
  const amt = round2(Number(payAmt) || 0);
  return {
    date: expense.date,
    direction: amt < 0 ? 'in' : 'out',
    mode: payment.mode,
    amount: Math.abs(amt),
    bankAccountId: payment.bankAccountId,
    notes: `[Expense] ${expense.partyName || category?.label || ''}`.trim().slice(0, 1000),
  };
};

// How much of an expense is paid up-front, from the form's `paidAmount`.
// Returns null when the field is ABSENT (legacy callers / bulk import) so the
// caller can fall back to the old "auto-pay the full amount" behaviour. When
// present (the expense form always sends it — 0 for Unpaid) it's clamped to
// [0, |amount|] so a partial payment can never exceed the expense total.
const resolvePaidAmount = (body, amount) => {
  if (body.paidAmount === undefined) return null;
  if (body.paidAmount === null || body.paidAmount === '') return 0;
  const n = round2(Number(body.paidAmount) || 0);
  if (!Number.isFinite(n)) return 0;
  const max = Math.abs(round2(Number(amount) || 0));
  return Math.max(0, Math.min(n, max));
};

// The signed amount to mirror into the cashbook for an expense:
//  - reversal (negative expense) → the full negative amount (recorded as an IN)
//  - legacy caller (paidReq === null) → the full expense amount (auto-paid)
//  - otherwise → exactly what was paid (0 = Unpaid, partial, or full)
const payAmountFor = (expenseAmount, paidReq) => {
  const full = round2(Number(expenseAmount) || 0);
  if (full < 0) return full;
  if (paidReq === null) return full;
  return paidReq;
};

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

const norm = (s) => String(s || '').trim().toLowerCase();

// Loose date parser for bulk import — accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
// and Excel serial numbers. Returns a UTC-midnight Date or null. The frontend
// already coerces spreadsheet date cells to YYYY-MM-DD, but CSV text and manual
// entries can arrive in day-first formats, so mirror that tolerance here.
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

const pickFields = (body) => {
  const data = {};
  if (body.date !== undefined) {
    const d = parseDate(body.date);
    if (!d) {
      const err = new Error('Invalid date');
      err.status = 400;
      throw err;
    }
    data.date = d;
  }
  if (body.categoryId !== undefined) data.categoryId = String(body.categoryId);
  if (body.amount !== undefined) {
    const n = Number(body.amount);
    if (!Number.isFinite(n)) {
      const err = new Error('Amount must be a number (negatives allowed for reversals)');
      err.status = 400;
      throw err;
    }
    data.amount = round2(n);
  }
  if (body.notes !== undefined) data.notes = String(body.notes || '').slice(0, 1000);
  if (body.partyName !== undefined) data.partyName = String(body.partyName || '').slice(0, 200);
  if (body.referenceId !== undefined) data.referenceId = body.referenceId || null;
  if (body.partyId !== undefined) data.partyId = body.partyId || null;
  return data;
};

// Attribute an expense to a Party for the ledger. An explicit partyId wins;
// otherwise derive from the reference's party, else find-or-create a standalone
// party from the free-text partyName. Returns null when nothing to attribute.
const resolvePartyId = async (tx, data) => {
  if (data.partyId) return data.partyId;
  if (data.referenceId) {
    let p = await tx.party.findUnique({ where: { referenceId: data.referenceId }, select: { id: true } });
    if (!p) {
      const r = await tx.reference.findUnique({ where: { id: data.referenceId }, select: { name: true, mobile: true, address: true, isActive: true } });
      if (r) p = await tx.party.create({ data: { name: r.name, phone: r.mobile || '', billingAddress: r.address || '', referenceId: data.referenceId, isActive: r.isActive } });
    }
    if (p) return p.id;
  }
  const name = (data.partyName || '').trim();
  if (name) {
    const existing = await tx.party.findFirst({ where: { name, hospitalId: null, referenceId: null }, select: { id: true } });
    if (existing) return existing.id;
    const created = await tx.party.create({ data: { name } });
    return created.id;
  }
  return null;
};

exports.list = async (req, res) => {
  try {
    const { categoryId, referenceId, from, to, q, page, limit = 100, merge, unlinkedOnly } = req.query;
    const where = {};
    if (categoryId) where.categoryId = categoryId;
    if (referenceId) where.referenceId = referenceId;
    // Cash/Bank payout picker — only offer expenses not already paid by a
    // cash/bank entry, so the same expense can't be linked twice. (Expense
    // creation usually auto-creates a payment entry, so "unlinked" means an
    // expense recorded without a payment.) The entry being edited re-adds its
    // own currently-linked expense on the client so it stays selectable.
    if (unlinkedOnly === 'true') where.payments = { none: {} };
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
    if (q && q.trim()) where.notes = { contains: q.trim(), mode: 'insensitive' };

    const take = Math.min(Number(limit) || 100, 200);

    // Monthly-merged view — collapses every Expense in the filter scope into
    // one synthetic row per (referenceId, calendar-month). Used by the
    // Reference Commission category on the Expenses page so dozens of
    // per-invoice rows for the same reference roll up to a single line item.
    if (merge === 'monthly') {
      const allItems = await prisma.expense.findMany({
        where,
        include: expenseInclude,
        orderBy: [{ date: 'desc' }],
      });
      const buckets = new Map();
      for (const exp of allItems) {
        const d = new Date(exp.date);
        const yyyymm = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
        const refKey = exp.referenceId || 'none';
        const key = `${refKey}:${exp.categoryId}:${yyyymm}`;
        if (!buckets.has(key)) {
          const anchor = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
          buckets.set(key, {
            id: key,
            date: anchor,
            categoryId: exp.categoryId,
            category: exp.category,
            referenceId: exp.referenceId,
            reference: exp.reference,
            amount: 0,
            notes: '',
            partyName: '',
            sourceType: exp.sourceType || null,
            sourceId: null,
            sourceLineId: null,
            createdAt: exp.createdAt,
            updatedAt: exp.updatedAt,
            mergedCount: 0,
            amountPaid: 0,
          });
        }
        const b = buckets.get(key);
        b.amount += Number(exp.amount) || 0;
        // Aggregate paid across every expense folded into this (reference,
        // month) bucket so the roll-up row carries real Paid/Balance/Status,
        // not just the gross amount. Reuses rollupPayment's signed sum.
        b.amountPaid += rollupPayment(Number(exp.amount) || 0, exp.payments).amountPaid;
        b.mergedCount += 1;
      }
      const merged = [...buckets.values()]
        .map((b) => {
          const amount = round2(b.amount);
          const amountPaid = round2(b.amountPaid);
          const amountPending = round2(amount - amountPaid);
          // Same status rule as rollupPayment, applied to the bucket total.
          let paymentStatus;
          if (amountPaid === 0) paymentStatus = amount === 0 ? 'paid' : 'pending';
          else if (amountPending <= 0) paymentStatus = 'paid';
          else paymentStatus = 'partial';
          return {
            ...b,
            amount,
            amountPaid,
            amountPending,
            paymentStatus,
            notes: `${b.mergedCount} entr${b.mergedCount === 1 ? 'y' : 'ies'} merged`,
          };
        })
        .sort((a, b) => b.date - a.date);
      const start = page ? (Number(page) - 1) * take : 0;
      const mSumAmount = round2(merged.reduce((s, m) => s + m.amount, 0));
      const mSumPaid = round2(merged.reduce((s, m) => s + m.amountPaid, 0));
      return res.json({
        expenses: toResponse(merged.slice(start, start + take)),
        total: merged.length,
        pages: Math.ceil(merged.length / take),
        sumAmount: mSumAmount,
        sumPaid: mSumPaid,
        sumPending: round2(mSumAmount - mSumPaid),
        merged: true,
      });
    }

    const skip = page ? (Number(page) - 1) * take : 0;
    const [items, total, agg, payAgg] = await Promise.all([
      prisma.expense.findMany({ where, include: expenseInclude, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], skip, take }),
      prisma.expense.count({ where }),
      // Sum the components so the filtered Balance total reflects the net payable
      // (amount − discount + GST + roundOff − TDS), while sumAmount stays the
      // pre-tax figure that ties to the category sidebar / P&L.
      prisma.expense.aggregate({ where, _sum: { amount: true, discount: true, gstAmount: true, roundOff: true, tdsAmount: true } }),
      // Paid total across the WHOLE filtered set — sum of the linked cash/bank
      // entries (out − in) so header/footer totals stay page-independent.
      // `expenseId: { not: null }` restricts to expense-linked entries (an empty
      // `expense: {}` relation filter would match every entry); `expense: where`
      // applies the same category/date/reference scope as the expense list.
      prisma.cashBankEntry.groupBy({ by: ['direction'], where: { expenseId: { not: null }, expense: where }, _sum: { amount: true } }),
    ]);
    // Balance/paid/status roll up against the net payable (taxes included), not
    // the pre-tax amount, so a GST-bearing expense can be fully settled.
    const expenses = toResponse(items).map((e) => ({ ...e, ...rollupPayment(payableOf(e), e.payments) }));
    const sumAmount = round2(agg._sum.amount || 0);
    const sumPayable = round2(
      (agg._sum.amount || 0) - (agg._sum.discount || 0) + (agg._sum.gstAmount || 0)
      + (agg._sum.roundOff || 0) - (agg._sum.tdsAmount || 0)
    );
    const sumPaid = round2(
      payAgg.reduce((s, r) => s + (r.direction === 'in' ? -1 : 1) * (r._sum.amount || 0), 0)
    );
    res.json({
      expenses,
      total,
      pages: Math.ceil(total / take),
      sumAmount,
      sumPaid,
      sumPending: round2(sumPayable - sumPaid),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

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
    const [categories, grouped] = await Promise.all([
      prisma.expenseCategory.findMany({ orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      prisma.expense.groupBy({ where, by: ['categoryId'], _sum: { amount: true }, _count: { _all: true } }),
    ]);
    const byCat = new Map(grouped.map((g) => [g.categoryId, g]));
    const rows = categories.map((c) => {
      const g = byCat.get(c.id);
      return {
        _id: c.id,
        slug: c.slug,
        label: c.label,
        isSystem: c.isSystem,
        amount: round2(g?._sum.amount || 0),
        count: g?._count._all || 0,
      };
    });
    const grandTotal = round2(rows.reduce((acc, r) => acc + r.amount, 0));
    res.json({ rows, grandTotal });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.expense.findUnique({ where: { id: req.params.id }, include: expenseInclude });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    // When the form sends line items, the expense amount is their server-computed
    // sum (never the client-sent flat amount).
    const lineData = buildExpenseLines(req.body);
    if (lineData) {
      if (!lineData.lines.length) return res.status(400).json({ message: 'Add at least one line item' });
      data.amount = lineData.total;
    }
    if (!data.date || !data.categoryId || data.amount === undefined) {
      return res.status(400).json({ message: 'date, categoryId, and amount are required' });
    }
    // Taxes/adjustments computed from the pre-tax subtotal. `amount` is left as
    // the subtotal; the net payable drives the paid clamp + cashbook outflow.
    const tax = computeExpenseTax(data.amount, pickTaxInput(req.body));
    Object.assign(data, { discount: tax.discount, gstRate: tax.gstRate, gstAmount: tax.gstAmount, tdsRate: tax.tdsRate, tdsAmount: tax.tdsAmount, roundOff: tax.roundOff });
    const payable = tax.grandTotal;

    const category = await prisma.expenseCategory.findUnique({ where: { id: data.categoryId } });
    if (!category) return res.status(400).json({ message: 'Category not found' });
    if (!category.isActive) return res.status(400).json({ message: 'Category is inactive' });

    const payment = await resolvePayment(req.body);
    const paidReq = resolvePaidAmount(req.body, payable);

    const item = await prisma.$transaction(async (tx) => {
      const partyId = await resolvePartyId(tx, data);
      const created = await tx.expense.create({
        data: {
          ...data,
          partyId,
          createdById: req.user?.id || null,
          ...(lineData ? { lineItems: { create: lineData.lines } } : {}),
        },
      });
      // Mirror the paid portion into the cashbook so Total On Hand drops. When
      // Paid is 0 (Unpaid) nothing is recorded and the expense reads Unpaid;
      // a partial pays only that much. Honour paymentMode 'none'. Paid is against
      // the net payable (incl. taxes), not the pre-tax amount.
      const payAmt = payAmountFor(payableOf(created), paidReq);
      if (payment && payAmt !== 0) {
        await tx.cashBankEntry.create({
          data: { ...paymentEntryFields(created, payment, category, payAmt), expenseId: created.id, createdById: req.user?.id || null },
        });
      }
      return tx.expense.findUnique({ where: { id: created.id }, include: expenseInclude });
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Bulk import — each valid row creates a new Expense (append-only; no dedupe,
// since expenses are transactional, not unique masters). Category is resolved by
// label or slug, Reference by name; both case-insensitive. Invalid rows are
// reported per-row and skipped so a single bad row never blocks the rest.
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const [categories, references] = await Promise.all([
      prisma.expenseCategory.findMany({ select: { id: true, slug: true, label: true, isActive: true } }),
      prisma.reference.findMany({ select: { id: true, name: true } }),
    ]);
    const catMap = new Map();
    for (const c of categories) {
      catMap.set(norm(c.label), c);
      if (!catMap.has(norm(c.slug))) catMap.set(norm(c.slug), c);
    }
    const refMap = new Map();
    for (const r of references) {
      const k = norm(r.name);
      if (k && !refMap.has(k)) refMap.set(k, r);
    }

    const created = [];
    const errors = [];
    const toCreate = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2; // header is row 1 in the source file
      const rowErrors = [];

      const catRaw = String(row.category ?? '').trim();
      let category = null;
      if (!catRaw) rowErrors.push('Category is required');
      else {
        category = catMap.get(norm(catRaw));
        if (!category) rowErrors.push(`Category not found: "${catRaw}"`);
        else if (!category.isActive) rowErrors.push(`Category is inactive: "${category.label}"`);
      }

      const dateVal = parseImportDate(row.date);
      if (!dateVal) rowErrors.push(row.date ? `Date invalid: "${row.date}"` : 'Date is required');

      const amtRaw = row.amount;
      const amt = Number(String(amtRaw ?? '').replace(/,/g, '').trim());
      if (amtRaw === undefined || amtRaw === null || String(amtRaw).trim() === '') rowErrors.push('Amount is required');
      else if (!Number.isFinite(amt)) rowErrors.push(`Amount must be a number: "${amtRaw}"`);

      let referenceId = null;
      const refRaw = String(row.reference ?? row.referenceBy ?? '').trim();
      if (refRaw) {
        const ref = refMap.get(norm(refRaw));
        if (!ref) rowErrors.push(`Reference not found: "${refRaw}"`);
        else referenceId = ref.id;
      }

      const label = catRaw || String(row.partyName ?? '').trim() || (dateVal ? dateVal.toISOString().slice(0, 10) : '');
      if (rowErrors.length) { errors.push({ row: rowNum, name: label, errors: rowErrors }); continue; }

      toCreate.push({
        rowNum,
        label,
        data: {
          date: dateVal,
          categoryId: category.id,
          amount: round2(amt),
          notes: String(row.notes ?? '').slice(0, 1000),
          partyName: String(row.partyName ?? '').slice(0, 200),
          referenceId,
          createdById: req.user?.id || null,
        },
      });
    }

    for (const item of toCreate) {
      try {
        const exp = await prisma.expense.create({ data: item.data, select: { id: true } });
        created.push({ row: item.rowNum, id: exp.id, name: item.label });
      } catch (e) {
        errors.push({ row: item.rowNum, name: item.label, errors: [e.message || 'Failed to save'] });
      }
    }

    const successCount = created.length;
    res.json({
      message: `Imported ${successCount} of ${rows.length} expense(s)`,
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
    const existing = await prisma.expense.findUnique({
      where: { id: req.params.id },
      include: {
        category: true,
        payments: { select: { id: true, mode: true, bankAccountId: true, direction: true, amount: true } },
      },
    });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    const data = pickFields(req.body);
    // When line items are sent, replace them and set amount to their summed total.
    const lineData = buildExpenseLines(req.body);
    if (lineData) {
      if (!lineData.lines.length) return res.status(400).json({ message: 'Add at least one line item' });
      data.amount = lineData.total;
    }
    // Re-attribute the party only when a party-related field was edited, so an
    // unrelated update never clears an existing partyId.
    if (['partyId', 'referenceId', 'partyName'].some((k) => req.body[k] !== undefined)) {
      data.partyId = await resolvePartyId(prisma, {
        partyId: data.partyId,
        referenceId: data.referenceId !== undefined ? data.referenceId : existing.referenceId,
        partyName: data.partyName !== undefined ? data.partyName : existing.partyName,
      });
    }

    // Payment reconciliation. Only when the form sent a paid amount (paidReq
    // !== null); resolvePayment validates the mode/bank up-front (may throw 400).
    const newAmount = data.amount !== undefined ? data.amount : existing.amount;
    // Recompute taxes from the (possibly new) subtotal; each rate / discount /
    // round-off falls back to the stored value so an unrelated edit keeps them.
    const tax = computeExpenseTax(newAmount, pickTaxInput(req.body, existing));
    Object.assign(data, { discount: tax.discount, gstRate: tax.gstRate, gstAmount: tax.gstAmount, tdsRate: tax.tdsRate, tdsAmount: tax.tdsAmount, roundOff: tax.roundOff });
    const payable = tax.grandTotal;
    const paidReq = resolvePaidAmount(req.body, payable);
    const payment = paidReq !== null ? await resolvePayment(req.body) : null;

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: req.params.id },
        data: {
          ...data,
          updatedById: req.user?.id || null,
          // Replace the full line set when the form sent one.
          ...(lineData ? { lineItems: { deleteMany: {}, create: lineData.lines } } : {}),
        },
        include: expenseInclude,
      });

      if (paidReq !== null) {
        const payAmt = payAmountFor(payableOf(updated), paidReq);
        const cur = existing.payments || [];
        const curPaid = cur.reduce((s, p) => s + (p.direction === 'in' ? -1 : 1) * (Number(p.amount) || 0), 0);
        const only = cur.length === 1 ? cur[0] : null;
        // Skip when nothing changed, so unrelated edits (and any externally
        // recorded payments) are left alone. When it did change, rewrite the
        // expense's payment as a single entry for the new paid amount.
        const unchanged =
          round2(curPaid) === round2(payAmt) &&
          (payAmt === 0
            ? cur.length === 0
            : !!only && only.mode === payment.mode && (only.bankAccountId || null) === (payment.bankAccountId || null));
        if (!unchanged) {
          if (cur.length) await tx.cashBankEntry.deleteMany({ where: { expenseId: updated.id } });
          if (payment && payAmt !== 0) {
            await tx.cashBankEntry.create({
              data: { ...paymentEntryFields(updated, payment, existing.category, payAmt), expenseId: updated.id, createdById: req.user?.id || null },
            });
          }
        }
      }
      return tx.expense.findUnique({ where: { id: updated.id }, include: expenseInclude });
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
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
