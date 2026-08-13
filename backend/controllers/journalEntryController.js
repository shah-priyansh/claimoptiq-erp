const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { normalizeLines, assertBalanced, nextRefNumber, round2 } = require('../utils/journalValidation');

const norm = (s) => String(s || '').trim().toLowerCase();

// Loose date parser for bulk import — accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY,
// and Excel serials. Returns a UTC-midnight Date or null. Mirrors the other
// import controllers so operators can reuse the same date formats everywhere.
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

// Build a lookup from account display name → { accountKind, accountId, accountName }
// across every account source a journal line can reference. A name shared by two
// different accounts is marked `ambiguous` so the import flags it rather than
// silently guessing which one the operator meant.
const buildAccountNameMap = async () => {
  const [banks, ledgers, cats, parties] = await Promise.all([
    prisma.bankAccount.findMany({ where: { isActive: true }, select: { id: true, bankName: true } }),
    prisma.account.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    prisma.expenseCategory.findMany({ where: { isActive: true }, select: { id: true, label: true } }),
    prisma.party.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
  ]);
  const map = new Map();
  const add = (kind, id, name) => {
    const key = norm(name);
    if (!key) return;
    const existing = map.get(key);
    if (existing) {
      if (!existing.ambiguous && !(existing.accountKind === kind && existing.accountId === id)) {
        map.set(key, { ambiguous: true });
      }
    } else {
      map.set(key, { accountKind: kind, accountId: id, accountName: name });
    }
  };
  banks.forEach((b) => add('bank', b.id, b.bankName));
  add('cash', null, 'Cash in Hand');
  ledgers.forEach((a) => add('ledger_account', a.id, a.name));
  cats.forEach((c) => add('expense_category', c.id, c.label));
  parties.forEach((p) => add('party', p.id, p.name));
  return map;
};

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

// Bulk import: one row = one balanced two-legged journal entry. Each row carries
// a Debit Account name, a Credit Account name, an amount and a date; the row
// becomes an entry that debits the first and credits the second by that amount.
exports.bulkImport = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const nameMap = await buildAccountNameMap();
    const resolve = (raw) => {
      const key = norm(raw);
      if (!key) return { error: 'required' };
      const hit = nameMap.get(key);
      if (!hit) return { error: 'notfound' };
      if (hit.ambiguous) return { error: 'ambiguous' };
      return hit;
    };

    const errors = [];
    const toCreate = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2; // header is row 1 in the source file
      const rowErrors = [];

      const dateVal = parseImportDate(row.date);
      if (!dateVal) rowErrors.push(row.date ? `Date invalid: "${row.date}"` : 'Date is required');

      const drRaw = String(row.debitAccount ?? '').trim();
      const crRaw = String(row.creditAccount ?? '').trim();
      const dr = resolve(drRaw);
      const cr = resolve(crRaw);
      if (dr.error === 'required') rowErrors.push('Debit Account is required');
      else if (dr.error === 'notfound') rowErrors.push(`Debit Account not found: "${drRaw}"`);
      else if (dr.error === 'ambiguous') rowErrors.push(`Debit Account name is ambiguous: "${drRaw}"`);
      if (cr.error === 'required') rowErrors.push('Credit Account is required');
      else if (cr.error === 'notfound') rowErrors.push(`Credit Account not found: "${crRaw}"`);
      else if (cr.error === 'ambiguous') rowErrors.push(`Credit Account name is ambiguous: "${crRaw}"`);
      if (!dr.error && !cr.error && dr.accountKind === cr.accountKind && dr.accountId === cr.accountId) {
        rowErrors.push('Debit and Credit accounts must differ');
      }

      const amtRaw = row.amount;
      const amtStr = String(amtRaw ?? '').replace(/,/g, '').trim();
      const amt = Number(amtStr);
      if (amtStr === '') rowErrors.push('Amount is required');
      else if (!Number.isFinite(amt)) rowErrors.push(`Amount must be a number: "${amtRaw}"`);
      else if (amt <= 0) rowErrors.push('Amount must be greater than 0');

      const label = drRaw && crRaw ? `${drRaw} → ${crRaw}` : (drRaw || crRaw || (dateVal ? dateVal.toISOString().slice(0, 10) : ''));
      if (rowErrors.length) { errors.push({ row: rowNum, name: label, errors: rowErrors }); continue; }

      toCreate.push({
        rowNum,
        label,
        date: dateVal,
        description: String(row.description ?? '').slice(0, 1000),
        lines: [
          { accountKind: dr.accountKind, accountId: dr.accountId, accountName: dr.accountName, debit: round2(amt), credit: 0 },
          { accountKind: cr.accountKind, accountId: cr.accountId, accountName: cr.accountName, debit: 0, credit: round2(amt) },
        ],
      });
    }

    // Assign sequential ref numbers from the current max; a P2002 collision (a
    // concurrent create grabbed the number) just bumps the counter and retries.
    const latest = await prisma.journalEntry.findFirst({ orderBy: { createdAt: 'desc' }, select: { refNumber: true } });
    const startMatch = /(\d+)\s*$/.exec(latest?.refNumber || '');
    let counter = startMatch ? parseInt(startMatch[1], 10) : 0;

    const created = [];
    for (const item of toCreate) {
      let done = false;
      for (let attempt = 0; attempt < 5 && !done; attempt++) {
        counter += 1;
        try {
          const entry = await prisma.journalEntry.create({
            data: {
              refNumber: `JE-${counter}`,
              date: item.date,
              description: item.description,
              createdById: req.user?.id || null,
              lines: { create: item.lines },
            },
            select: { id: true, refNumber: true },
          });
          created.push({ row: item.rowNum, id: entry.id, name: item.label, refNumber: entry.refNumber });
          done = true;
        } catch (e) {
          if (e.code === 'P2002') continue; // ref collision → bump and retry
          errors.push({ row: item.rowNum, name: item.label, errors: [e.message || 'Failed to save'] });
          done = true;
        }
      }
      if (!done) errors.push({ row: item.rowNum, name: item.label, errors: ['Could not assign a reference number, please retry'] });
    }

    const successCount = created.length;
    res.json({
      message: `Imported ${successCount} of ${rows.length} journal entr${rows.length === 1 ? 'y' : 'ies'}`,
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
