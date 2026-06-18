// Phase 2.6 — Reports.
//
// Read-only aggregations across the data shipped in 2.1–2.5.
// Every endpoint returns the same normalized shape:
//   { filters, totals, rows: [{ key, label, value, ...extras }] }
// so the UI can render any of them with a single table + chart component.

const prisma = require('../config/prisma');

const ACTIVE_INVOICE_STATUSES = ['issued', 'partially_paid', 'paid'];

const parseDate = (input) => {
  if (!input) return null;
  const d = new Date(input);
  return isNaN(d.getTime()) ? null : d;
};

const monthStart = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const monthKey = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d) => d.toLocaleString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' });

// Resolve a date range with sane defaults (last 6 months → today).
const resolveRange = (query) => {
  let from = parseDate(query.from);
  let to = parseDate(query.to);
  const now = new Date();
  if (!to) to = now;
  if (!from) {
    from = new Date(now);
    from.setUTCMonth(from.getUTCMonth() - 5);
    from = monthStart(from);
  }
  // Make `to` inclusive of the entire day.
  const toInclusive = new Date(to);
  toInclusive.setUTCHours(23, 59, 59, 999);
  return { from, to: toInclusive, filtersOut: { from: from.toISOString(), to: toInclusive.toISOString() } };
};

const sum = (rows, key) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

// === SALES =================================================================
// Reads issued/partially_paid/paid invoices in the range; groups by month,
// hospital, or service (via lineItems).
exports.sales = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);
    const groupBy = ['month', 'hospital', 'service'].includes(req.query.groupBy) ? req.query.groupBy : 'month';
    const hospitalFilter = req.query.hospitalId ? { hospitalId: req.query.hospitalId } : {};

    const invoices = await prisma.invoice.findMany({
      where: {
        status: { in: ACTIVE_INVOICE_STATUSES },
        issuedAt: { gte: from, lte: to },
        ...hospitalFilter,
      },
      select: {
        id: true, hospitalId: true, issuedAt: true, netTotal: true, amountPaid: true,
        hospital: { select: { id: true, name: true } },
        lineItems: groupBy === 'service'
          ? { select: { lineType: true, amount: true, billingServiceNameId: true, billingServiceName: { select: { id: true, name: true } } } }
          : false,
      },
    });

    const rowsMap = new Map();
    if (groupBy === 'month') {
      for (const inv of invoices) {
        const m = monthStart(inv.issuedAt);
        const key = monthKey(m);
        const cur = rowsMap.get(key) || { key, label: monthLabel(m), value: 0, paid: 0, invoiceCount: 0 };
        cur.value += inv.netTotal || 0;
        cur.paid += inv.amountPaid || 0;
        cur.invoiceCount += 1;
        rowsMap.set(key, cur);
      }
    } else if (groupBy === 'hospital') {
      for (const inv of invoices) {
        const key = inv.hospitalId;
        const cur = rowsMap.get(key) || { key, label: inv.hospital?.name || '—', value: 0, paid: 0, invoiceCount: 0 };
        cur.value += inv.netTotal || 0;
        cur.paid += inv.amountPaid || 0;
        cur.invoiceCount += 1;
        rowsMap.set(key, cur);
      }
    } else {
      // service: aggregate line items by billingServiceNameId (and fall back to lineType for naming when missing)
      for (const inv of invoices) {
        // Need to fetch lineItems separately if not included
        const lineItems = inv.lineItems || [];
        for (const li of lineItems) {
          const key = li.billingServiceNameId || `__type:${li.lineType}`;
          const name = li.billingServiceName?.name || (li.lineType === 'adjustment' ? 'Adjustments' : li.lineType);
          const cur = rowsMap.get(key) || { key, label: name, value: 0, lineCount: 0 };
          cur.value += li.amount || 0;
          cur.lineCount += 1;
          rowsMap.set(key, cur);
        }
      }
    }

    const rows = Array.from(rowsMap.values())
      .map((r) => ({ ...r, value: Math.round(r.value), paid: r.paid !== undefined ? Math.round(r.paid) : undefined }))
      .sort((a, b) => groupBy === 'month' ? a.key.localeCompare(b.key) : b.value - a.value);

    res.json({
      filters: { ...filtersOut, groupBy, hospitalId: req.query.hospitalId || null },
      totals: {
        sales: sum(rows, 'value'),
        paid: Math.round(invoices.reduce((a, i) => a + (i.amountPaid || 0), 0)),
        invoiceCount: invoices.length,
        rowCount: rows.length,
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === EXPENSES ==============================================================
exports.expenses = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);
    const groupBy = ['month', 'category'].includes(req.query.groupBy) ? req.query.groupBy : 'category';
    const categoryFilter = req.query.categoryId ? { categoryId: req.query.categoryId } : {};

    const expenses = await prisma.expense.findMany({
      where: {
        date: { gte: from, lte: to },
        ...categoryFilter,
      },
      select: {
        id: true, date: true, amount: true, categoryId: true,
        category: { select: { id: true, label: true, slug: true } },
      },
    });

    const rowsMap = new Map();
    if (groupBy === 'month') {
      for (const e of expenses) {
        const m = monthStart(e.date);
        const key = monthKey(m);
        const cur = rowsMap.get(key) || { key, label: monthLabel(m), value: 0, count: 0 };
        cur.value += e.amount || 0;
        cur.count += 1;
        rowsMap.set(key, cur);
      }
    } else {
      for (const e of expenses) {
        const key = e.categoryId;
        const cur = rowsMap.get(key) || { key, label: e.category?.label || '—', slug: e.category?.slug, value: 0, count: 0 };
        cur.value += e.amount || 0;
        cur.count += 1;
        rowsMap.set(key, cur);
      }
    }

    const rows = Array.from(rowsMap.values())
      .map((r) => ({ ...r, value: Math.round(r.value) }))
      .sort((a, b) => groupBy === 'month' ? a.key.localeCompare(b.key) : b.value - a.value);

    res.json({
      filters: { ...filtersOut, groupBy, categoryId: req.query.categoryId || null },
      totals: { expense: sum(rows, 'value'), expenseCount: expenses.length, rowCount: rows.length },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === PROFIT ================================================================
// profit(month) = sales(invoice.netTotal issued in month) - expenses(date in month).
exports.profit = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);
    const [invoices, expenses] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: from, lte: to } },
        select: { issuedAt: true, netTotal: true },
      }),
      prisma.expense.findMany({
        where: { date: { gte: from, lte: to } },
        select: { date: true, amount: true },
      }),
    ]);

    const byMonth = new Map();
    const bump = (date, field, val) => {
      const m = monthStart(date);
      const key = monthKey(m);
      const cur = byMonth.get(key) || { key, label: monthLabel(m), sales: 0, expense: 0 };
      cur[field] += val;
      byMonth.set(key, cur);
    };
    for (const inv of invoices) bump(inv.issuedAt, 'sales', inv.netTotal || 0);
    for (const e of expenses) bump(e.date, 'expense', e.amount || 0);

    const rows = Array.from(byMonth.values())
      .map((r) => ({
        key: r.key,
        label: r.label,
        sales: Math.round(r.sales),
        expense: Math.round(r.expense),
        value: Math.round(r.sales - r.expense),
      }))
      .sort((a, b) => a.key.localeCompare(b.key));

    res.json({
      filters: filtersOut,
      totals: {
        sales: sum(rows, 'sales'),
        expense: sum(rows, 'expense'),
        profit: sum(rows, 'value'),
        rowCount: rows.length,
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === REFERENCES ============================================================
// businessGiven = Σ invoice.netTotal where hospital.referenceId = ref AND invoice active in range.
// commissionPaid = Σ expense.amount where category=reference_commission AND referenceId = ref AND in range.
// commissionPending = roughly businessGiven*rate − commissionPaid, surfaced as advisory.
exports.references = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);
    const refFilter = req.query.referenceId ? { id: req.query.referenceId } : {};

    const references = await prisma.reference.findMany({
      where: { ...refFilter },
      select: { id: true, name: true, commissionRate: true, isActive: true },
    });

    // Business given: sum invoice.netTotal grouped by hospital.referenceId
    const businessRows = await prisma.invoice.groupBy({
      by: ['hospitalId'],
      where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: from, lte: to } },
      _sum: { netTotal: true },
    });
    const hospitalIds = businessRows.map((r) => r.hospitalId);
    const hospitals = hospitalIds.length
      ? await prisma.hospital.findMany({ where: { id: { in: hospitalIds } }, select: { id: true, referenceId: true } })
      : [];
    const hospRefMap = new Map(hospitals.map((h) => [h.id, h.referenceId]));
    const businessByRef = new Map();
    for (const r of businessRows) {
      const refId = hospRefMap.get(r.hospitalId);
      if (!refId) continue;
      businessByRef.set(refId, (businessByRef.get(refId) || 0) + (r._sum.netTotal || 0));
    }

    // Commission paid: sum expenses in reference_commission category grouped by referenceId
    const commissionCat = await prisma.expenseCategory.findUnique({ where: { slug: 'reference_commission' } });
    const paidRows = commissionCat ? await prisma.expense.groupBy({
      by: ['referenceId'],
      where: {
        categoryId: commissionCat.id,
        date: { gte: from, lte: to },
        referenceId: { not: null },
      },
      _sum: { amount: true },
    }) : [];
    const paidByRef = new Map(paidRows.map((r) => [r.referenceId, r._sum.amount || 0]));

    const rows = references.map((ref) => {
      const business = Math.round(businessByRef.get(ref.id) || 0);
      const paid = Math.round(paidByRef.get(ref.id) || 0);
      // Advisory: expected = business * rate / 100. Pending = expected − paid.
      const expected = Math.round(business * (Number(ref.commissionRate) || 0) / 100);
      const pending = expected - paid;
      return {
        key: ref.id,
        label: ref.name,
        commissionRate: ref.commissionRate,
        isActive: ref.isActive,
        businessGiven: business,
        commissionExpected: expected,
        commissionPaid: paid,
        commissionPending: pending,
        value: business,
      };
    }).filter((r) => r.businessGiven > 0 || r.commissionPaid > 0)
      .sort((a, b) => b.businessGiven - a.businessGiven);

    res.json({
      filters: { ...filtersOut, referenceId: req.query.referenceId || null },
      totals: {
        businessGiven: sum(rows, 'businessGiven'),
        commissionExpected: sum(rows, 'commissionExpected'),
        commissionPaid: sum(rows, 'commissionPaid'),
        commissionPending: sum(rows, 'commissionPending'),
        rowCount: rows.length,
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === CASH/BANK =============================================================
// Grouped by day, month, or mode.
exports.cashBank = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);
    const groupBy = ['day', 'month', 'mode'].includes(req.query.groupBy) ? req.query.groupBy : 'month';
    const modeFilter = req.query.mode ? { mode: req.query.mode } : {};

    const entries = await prisma.cashBankEntry.findMany({
      where: { date: { gte: from, lte: to }, ...modeFilter },
      select: { date: true, direction: true, mode: true, amount: true },
      orderBy: { date: 'asc' },
    });

    const bucketKey = (d) => {
      if (groupBy === 'day') return d.toISOString().slice(0, 10);
      if (groupBy === 'month') return monthKey(monthStart(d));
      return null; // mode grouping ignores date
    };
    const bucketLabel = (d, key) => {
      if (groupBy === 'day') return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      if (groupBy === 'month') return monthLabel(monthStart(d));
      return key;
    };

    const rowsMap = new Map();
    if (groupBy === 'mode') {
      for (const e of entries) {
        const key = e.mode;
        const cur = rowsMap.get(key) || { key, label: e.mode.toUpperCase(), in: 0, out: 0 };
        cur[e.direction] += e.amount || 0;
        rowsMap.set(key, cur);
      }
    } else {
      for (const e of entries) {
        const key = bucketKey(e.date);
        const cur = rowsMap.get(key) || { key, label: bucketLabel(e.date, key), in: 0, out: 0 };
        cur[e.direction] += e.amount || 0;
        rowsMap.set(key, cur);
      }
    }

    const rows = Array.from(rowsMap.values())
      .map((r) => ({ ...r, in: Math.round(r.in), out: Math.round(r.out), value: Math.round(r.in - r.out) }))
      .sort((a, b) => groupBy === 'mode' ? b.value - a.value : a.key.localeCompare(b.key));

    res.json({
      filters: { ...filtersOut, groupBy, mode: req.query.mode || null },
      totals: {
        in: sum(rows, 'in'),
        out: sum(rows, 'out'),
        net: sum(rows, 'value'),
        rowCount: rows.length,
      },
      rows,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === TAXES & DISCOUNTS ====================================================
// Consolidated tax & discount summary across the [from, to] window.
//
// Sourced from invoices (sales side): Discount given, TDS deducted at source
// (Receivable), Output GST collected (Payable). Expense-side counterparts
// (TDS Payable on vendor payments, Input GST on purchases) are not modeled
// on Expense yet, so they're returned as zero with a `notTracked: true` hint
// so the UI can flag them.
exports.taxesDiscount = async (req, res) => {
  try {
    const { from, to, filtersOut } = resolveRange(req.query);

    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: from, lte: to } },
      select: {
        id: true, hospitalId: true, issuedAt: true,
        discount: true, gstAmount: true, gstRate: true,
        tdsAmount: true, tdsRate: true, tdsName: true, tdsSection: true,
        netTotal: true, gross: true,
        hospital: { select: { id: true, name: true } },
      },
    });

    // Generic monthly / per-hospital / per-bucket grouper. Reads `fieldFn(inv)`
    // for the value so the same body handles discount, tds, gst.
    const groupAll = (fieldFn, extraKeyFn) => {
      const byMonth = new Map();
      const byHospital = new Map();
      const byBucket = extraKeyFn ? new Map() : null;
      let total = 0;
      let count = 0;
      for (const inv of invoices) {
        const v = fieldFn(inv) || 0;
        if (!v) continue;
        total += v;
        count += 1;
        const m = monthStart(inv.issuedAt);
        const mk = monthKey(m);
        const mCur = byMonth.get(mk) || { key: mk, label: monthLabel(m), value: 0, count: 0 };
        mCur.value += v; mCur.count += 1; byMonth.set(mk, mCur);
        const hCur = byHospital.get(inv.hospitalId) || { key: inv.hospitalId, label: inv.hospital?.name || '—', value: 0, count: 0 };
        hCur.value += v; hCur.count += 1; byHospital.set(inv.hospitalId, hCur);
        if (extraKeyFn) {
          const ek = extraKeyFn(inv);
          if (ek) {
            const bCur = byBucket.get(ek.key) || { key: ek.key, label: ek.label, value: 0, count: 0, ...ek.extra };
            bCur.value += v; bCur.count += 1; byBucket.set(ek.key, bCur);
          }
        }
      }
      const finalize = (m, sortKey) => Array.from(m.values())
        .map((r) => ({ ...r, value: Math.round(r.value) }))
        .sort((a, b) => sortKey === 'month' ? a.key.localeCompare(b.key) : b.value - a.value);
      return {
        total: Math.round(total),
        count,
        byMonth: finalize(byMonth, 'month'),
        byHospital: finalize(byHospital),
        ...(byBucket ? { byBucket: finalize(byBucket) } : {}),
      };
    };

    const discount = groupAll((i) => i.discount);
    const tdsReceivable = groupAll(
      (i) => i.tdsAmount,
      (i) => {
        const label = i.tdsSection || i.tdsName || (i.tdsRate ? `${i.tdsRate}%` : 'Unspecified');
        const key = `${i.tdsSection || ''}|${i.tdsName || ''}|${i.tdsRate || 0}`;
        return { key, label, extra: { section: i.tdsSection || '', name: i.tdsName || '', rate: i.tdsRate || 0 } };
      },
    );
    const gstPayable = groupAll(
      (i) => i.gstAmount,
      (i) => {
        const rate = i.gstRate || 0;
        return { key: `rate:${rate}`, label: `${rate}% GST`, extra: { rate } };
      },
    );

    res.json({
      filters: filtersOut,
      discount,
      tdsReceivable,
      gstPayable,
      tdsPayable: { total: 0, count: 0, byMonth: [], byHospital: [], notTracked: true,
        note: 'TDS deducted while paying vendors is not tracked on Expense yet. Add a tdsAmount field on Expense to populate this.' },
      gstReceivable: { total: 0, count: 0, byMonth: [], byHospital: [], notTracked: true,
        note: 'Input GST on purchases is not tracked on Expense yet. Add a gstAmount field on Expense to populate this.' },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === BALANCE SHEET =========================================================
// As-on snapshot of assets and liabilities for the given date.
//
// Assets are derived from on-hand cash balances (cash/upi by mode + bank
// balances broken down per BankAccount), outstanding invoice receivables
// (Sundry Debtors by hospital), and the TDS withheld on issued invoices
// (treated as a receivable from the income tax dept).
//
// Liabilities side has the GST collected on issued invoices (Output GST
// payable), and the equity bucket: Retained Earnings = lifetime income −
// lifetime expenses up to `asOn`. The remaining gap to make Assets =
// Liabilities + Equity is reported as "Owner's Capital" (opening capital
// + adjustments not tracked in the system).
exports.balanceSheet = async (req, res) => {
  try {
    // Date semantics:
    //   to / asOn  - the snapshot date everything is measured up to (defaults to today)
    //   from       - optional period start. When set, Retained Earnings is scoped to
    //                [from, to]; lifetime profit before `from` rolls into Owner's Capital
    //                (matches the Tally "01-Apr → 30-Jun" balance-sheet convention).
    const to = parseDate(req.query.to) || parseDate(req.query.asOn) || new Date();
    to.setUTCHours(23, 59, 59, 999);
    const from = parseDate(req.query.from);
    if (from) from.setUTCHours(0, 0, 0, 0);

    const periodInvoiceWhere = from
      ? { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: from, lte: to } }
      : { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { lte: to } };
    const periodExpenseWhere = from
      ? { date: { gte: from, lte: to } }
      : { date: { lte: to } };

    const [
      bankAccounts,
      cashAgg,
      contraTo,
      contraFrom,
      openInvoices,
      issuedAgg,
      expenseAgg,
      periodIncomeAgg,
      periodExpenseAgg,
    ] = await Promise.all([
      prisma.bankAccount.findMany({
        where: { isActive: true },
        select: { id: true, bankName: true, isDefault: true, order: true },
        orderBy: [{ isDefault: 'desc' }, { order: 'asc' }],
      }),
      prisma.cashBankEntry.groupBy({
        by: ['mode', 'direction', 'bankAccountId'],
        where: { date: { lte: to } },
        _sum: { amount: true },
      }),
      prisma.accountEntry.groupBy({
        where: { entryType: 'contra', date: { lte: to } },
        by: ['toMode'],
        _sum: { amount: true },
      }),
      prisma.accountEntry.groupBy({
        where: { entryType: 'contra', date: { lte: to } },
        by: ['fromMode'],
        _sum: { amount: true },
      }),
      // Issued invoices up to `to` — the receivable side (always lifetime-up-to-`to`)
      prisma.invoice.findMany({
        where: {
          status: { in: ACTIVE_INVOICE_STATUSES },
          issuedAt: { lte: to },
        },
        select: {
          hospitalId: true, grandTotal: true, amountPaid: true,
          hospital: { select: { id: true, name: true } },
        },
      }),
      // Lifetime tax pools (GST / TDS) up to `to`
      prisma.invoice.aggregate({
        where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { lte: to } },
        _sum: { netTotal: true, gstAmount: true, tdsAmount: true },
      }),
      prisma.expense.aggregate({
        where: { date: { lte: to } },
        _sum: { amount: true },
      }),
      // Period totals — drive Retained Earnings when `from` is set.
      prisma.invoice.aggregate({
        where: periodInvoiceWhere,
        _sum: { netTotal: true },
      }),
      prisma.expense.aggregate({
        where: periodExpenseWhere,
        _sum: { amount: true },
      }),
    ]);

    // --- Cash balance per mode + per bank account ---
    // 'cash' / 'upi' are single buckets (no per-account split). 'bank' is split
    // by bankAccountId from CashBankEntry. Contras adjust at the mode level
    // only (AccountEntry has no bankAccountId), so bank-side contras are
    // attributed to the default bank account.
    const cashBucket = { cash: 0, upi: 0 };
    const bankByAccount = new Map(); // bankAccountId -> running balance
    let bankNullBucket = 0;          // bank entries with no bankAccountId
    for (const row of cashAgg) {
      const sign = row.direction === 'in' ? 1 : -1;
      const amt = sign * (row._sum.amount || 0);
      if (row.mode === 'bank') {
        if (row.bankAccountId) {
          bankByAccount.set(row.bankAccountId, (bankByAccount.get(row.bankAccountId) || 0) + amt);
        } else {
          bankNullBucket += amt;
        }
      } else if (row.mode === 'cash' || row.mode === 'upi') {
        cashBucket[row.mode] += amt;
      }
    }

    let bankContraNet = 0;
    for (const row of contraTo) {
      if (!row.toMode) continue;
      const amt = row._sum.amount || 0;
      if (row.toMode === 'bank') bankContraNet += amt;
      else if (row.toMode === 'cash' || row.toMode === 'upi') cashBucket[row.toMode] += amt;
    }
    for (const row of contraFrom) {
      if (!row.fromMode) continue;
      const amt = row._sum.amount || 0;
      if (row.fromMode === 'bank') bankContraNet -= amt;
      else if (row.fromMode === 'cash' || row.fromMode === 'upi') cashBucket[row.fromMode] -= amt;
    }

    const defaultBank = bankAccounts.find((b) => b.isDefault) || bankAccounts[0];
    const unallocatedBank = bankNullBucket + bankContraNet;
    if (defaultBank && unallocatedBank) {
      bankByAccount.set(defaultBank.id, (bankByAccount.get(defaultBank.id) || 0) + unallocatedBank);
    }

    const bankRows = bankAccounts
      .map((ba) => ({ key: ba.id, label: ba.bankName, value: Math.round(bankByAccount.get(ba.id) || 0) }))
      .filter((r) => r.value !== 0);
    const bankTotal = bankRows.reduce((a, r) => a + r.value, 0);
    const cashTotal = Math.round(cashBucket.cash);
    const upiTotal = Math.round(cashBucket.upi);

    // --- Sundry Debtors (per hospital, outstanding > 0) ---
    const debtorMap = new Map();
    for (const inv of openInvoices) {
      const due = (inv.grandTotal || 0) - (inv.amountPaid || 0);
      if (Math.abs(due) < 0.5) continue;
      const cur = debtorMap.get(inv.hospitalId) || { key: inv.hospitalId, label: inv.hospital?.name || '—', value: 0 };
      cur.value += due;
      debtorMap.set(inv.hospitalId, cur);
    }
    const debtorRows = Array.from(debtorMap.values())
      .map((r) => ({ ...r, value: Math.round(r.value) }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value);
    const debtorsTotal = debtorRows.reduce((a, r) => a + r.value, 0);

    // --- Tax pools ---
    const tdsReceivable = Math.round(issuedAgg._sum.tdsAmount || 0);
    const gstPayable = Math.round(issuedAgg._sum.gstAmount || 0);

    // --- Equity ---
    // Retained Earnings is scoped to the [from, to] window when `from` is set;
    // otherwise it's lifetime-up-to-`to`. Either way, Owner's Capital absorbs
    // the remainder so the sheet balances by construction.
    const periodIncome = periodIncomeAgg._sum.netTotal || 0;
    const periodExpense = periodExpenseAgg._sum.amount || 0;
    const retainedEarnings = Math.round(periodIncome - periodExpense);

    const totalAssets = bankTotal + cashTotal + upiTotal + debtorsTotal + tdsReceivable;
    const knownLiabilities = gstPayable + retainedEarnings;
    const ownersCapital = totalAssets - knownLiabilities;
    const totalLiabilities = ownersCapital + retainedEarnings + gstPayable;

    res.json({
      filters: {
        from: from ? from.toISOString() : null,
        to: to.toISOString(),
        asOn: to.toISOString(),
      },
      assets: {
        sundryDebtors: { label: 'Sundry Debtors', total: debtorsTotal, items: debtorRows },
        bankAccounts:  { label: 'Bank Accounts',  total: bankTotal,    items: bankRows },
        cashAccount:   { label: 'Cash in Hand',   total: cashTotal,    items: cashTotal !== 0 ? [{ key: 'cash', label: 'Cash', value: cashTotal }] : [] },
        upiAccount:    { label: 'UPI',            total: upiTotal,     items: upiTotal !== 0 ? [{ key: 'upi', label: 'UPI', value: upiTotal }] : [] },
        tdsReceivable: { label: 'TDS Receivable', total: tdsReceivable, items: tdsReceivable !== 0 ? [{ key: 'tds', label: 'TDS deducted on invoices', value: tdsReceivable }] : [] },
      },
      liabilities: {
        capitalAccount: {
          label: 'Capital Account',
          ownersCapital,
          retainedEarnings,
          periodIncome: Math.round(periodIncome),
          periodExpense: Math.round(periodExpense),
          lifetimeIncome: Math.round(issuedAgg._sum.netTotal || 0),
          lifetimeExpense: Math.round(expenseAgg._sum.amount || 0),
          total: ownersCapital + retainedEarnings,
        },
        outwardDutiesTaxes: {
          label: 'Outward Duties & Taxes',
          total: gstPayable,
          items: gstPayable !== 0 ? [{ key: 'gst_out', label: 'Output GST', value: gstPayable }] : [],
        },
      },
      totals: {
        assets: totalAssets,
        liabilities: totalLiabilities,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// === DASHBOARD =============================================================
// Summary tiles: this month's sales, expense, profit, cash balance, top hospital, top reference.
exports.dashboard = async (req, res) => {
  try {
    const now = new Date();
    const mStart = monthStart(now);
    const mEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const mEndInclusive = new Date(mEnd.getTime() - 1);

    const [
      monthInvoices,
      monthExpenses,
      cashAgg,
      contraTo,
      contraFrom,
      topHospitalRow,
      topRefCommissionRow,
      paidThisMonthAgg,
      pendingTotalAgg,
    ] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: mStart, lte: mEndInclusive } },
        select: { netTotal: true, hospitalId: true, hospital: { select: { id: true, name: true } } },
      }),
      prisma.expense.findMany({
        where: { date: { gte: mStart, lte: mEndInclusive } },
        select: { amount: true, categoryId: true, category: { select: { label: true, slug: true } } },
      }),
      prisma.cashBankEntry.groupBy({ by: ['mode', 'direction'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['toMode'], _sum: { amount: true } }),
      prisma.accountEntry.groupBy({ where: { entryType: 'contra' }, by: ['fromMode'], _sum: { amount: true } }),
      prisma.invoice.groupBy({
        by: ['hospitalId'],
        where: { status: { in: ACTIVE_INVOICE_STATUSES }, issuedAt: { gte: mStart, lte: mEndInclusive } },
        _sum: { netTotal: true },
        orderBy: { _sum: { netTotal: 'desc' } },
        take: 1,
      }),
      // Top reference by commission paid (this month)
      (async () => {
        const cat = await prisma.expenseCategory.findUnique({ where: { slug: 'reference_commission' } });
        if (!cat) return [];
        return prisma.expense.groupBy({
          by: ['referenceId'],
          where: { categoryId: cat.id, date: { gte: mStart, lte: mEndInclusive }, referenceId: { not: null } },
          _sum: { amount: true },
          orderBy: { _sum: { amount: 'desc' } },
          take: 1,
        });
      })(),
      prisma.cashBankEntry.aggregate({
        where: { direction: 'in', date: { gte: mStart, lte: mEndInclusive } },
        _sum: { amount: true },
      }),
      prisma.invoice.aggregate({
        where: { status: { in: ['issued', 'partially_paid'] } },
        _sum: { amountPending: true },
      }),
    ]);

    const sales = monthInvoices.reduce((a, i) => a + (i.netTotal || 0), 0);
    const expense = monthExpenses.reduce((a, e) => a + (e.amount || 0), 0);
    const profit = sales - expense;

    const cashByMode = { cash: 0, bank: 0, upi: 0 };
    for (const row of cashAgg) {
      const sign = row.direction === 'in' ? 1 : -1;
      cashByMode[row.mode] = (cashByMode[row.mode] || 0) + sign * (row._sum.amount || 0);
    }
    for (const row of contraTo) if (row.toMode) cashByMode[row.toMode] += row._sum.amount || 0;
    for (const row of contraFrom) if (row.fromMode) cashByMode[row.fromMode] -= row._sum.amount || 0;
    const cashTotal = cashByMode.cash + cashByMode.bank + cashByMode.upi;

    let topHospital = null;
    if (topHospitalRow.length) {
      const h = await prisma.hospital.findUnique({ where: { id: topHospitalRow[0].hospitalId }, select: { id: true, name: true } });
      topHospital = h ? { id: h.id, name: h.name, value: Math.round(topHospitalRow[0]._sum.netTotal || 0) } : null;
    }
    let topReference = null;
    if (topRefCommissionRow.length) {
      const r = await prisma.reference.findUnique({ where: { id: topRefCommissionRow[0].referenceId }, select: { id: true, name: true } });
      topReference = r ? { id: r.id, name: r.name, value: Math.round(topRefCommissionRow[0]._sum.amount || 0) } : null;
    }

    res.json({
      filters: { month: monthKey(mStart), monthLabel: monthLabel(mStart) },
      thisMonth: {
        sales: Math.round(sales),
        expense: Math.round(expense),
        profit: Math.round(profit),
        invoiceCount: monthInvoices.length,
        expenseCount: monthExpenses.length,
      },
      cashBank: {
        cash: Math.round(cashByMode.cash),
        bank: Math.round(cashByMode.bank),
        upi:  Math.round(cashByMode.upi),
        total: Math.round(cashTotal),
        paymentsReceivedThisMonth: Math.round(paidThisMonthAgg._sum.amount || 0),
      },
      receivables: {
        outstandingTotal: Math.round(pendingTotalAgg._sum.amountPending || 0),
      },
      topHospital,
      topReference,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
