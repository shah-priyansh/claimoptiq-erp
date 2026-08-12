# Journal Entry (Double-Entry Chart of Accounts) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the notes-only "Account Entry" modal with a real double-entry **Journal Entry** posted against the existing Chart of Accounts, whose lines fold into the balances already shown across the app.

**Architecture:** Two new tables (`journal_entries`, `journal_lines`) hold header + balanced Dr/Cr lines. Each line carries a polymorphic account reference `{accountKind, accountId}` into the existing account sources (bank / cash / `Account` / expense category / party). Balances everywhere are computed as `nativeBalance + Σ(line.debit − line.credit)` — the same fold the code already does for Contra entries. No rewrite of Invoices/Expenses (Approach B).

**Tech Stack:** Node/Express 5, Prisma 7 + PostgreSQL, React 19 + Tailwind. Backend `:5001`, frontend `:3000`.

## Global Constraints

- **Approach B only.** Invoices/Expenses/Cash-Bank are NOT rewritten as postings. Reports (Sales/Expense/Profit) are **unchanged in v1** — journal lines flow into Chart-of-Accounts balances and Cash/Bank balances only.
- **Account kinds** (exact strings): `'bank' | 'cash' | 'ledger_account' | 'expense_category' | 'party'`. `accountId` is `null` **iff** kind is `cash`.
- **Amounts** are 2-decimal (paise). Round with `Math.round(n*100)/100`. Balanced check uses epsilon `< 0.005`.
- **Ref number** format `JE-<n>` (n starts at 1, monotonic). `ref_number` is UNIQUE; on collision (`P2002`) the create **retries**.
- **A line has exactly one side:** exactly one of `debit`/`credit` is `> 0`, the other `0`; both non-negative.
- **RBAC:** reuse the existing **`account_entries`** module (`view`/`create`/`edit`/`delete`) for all `/api/journal-entries` routes. No new RBAC module.
- **Controllers** return `toResponse(...)` (maps Prisma `id` → `_id`, recursively). Import from `../utils/toResponse`.
- **Prisma client** is `require('../config/prisma')`.
- **Test style:** standalone runnable scripts `node <path>.test.js` using an `eq(name, got, want)` / `throws(name, fn)` helper and `process.exit(failures ? 1 : 0)` — mirror `backend/utils/calculateFilePrice.test.js`. There is **no jest/mocha** and **no frontend component test runner in use**; UI is verified by running the app.
- **Migrations:** author via `npx prisma migrate dev --name <name>` from `backend/`. Production build runs `npx prisma migrate deploy`.

---

## File structure

**Backend (create):**
- `backend/utils/journalValidation.js` — pure validation: `normalizeLines`, `assertBalanced`, `nextRefNumber`.
- `backend/utils/journalValidation.test.js` — node test.
- `backend/services/journalBalances.js` — `journalKey`, `foldJournalLines` (pure), `getJournalNetByAccount` (DB), `drSide`.
- `backend/services/journalBalances.test.js` — node test.
- `backend/controllers/journalEntryController.js` — CRUD + `resolveAccounts`.
- `backend/routes/journalEntryRoutes.js` — routes.
- `backend/scripts/smokeJournal.js` — DB round-trip smoke.

**Backend (modify):**
- `backend/prisma/schema.prisma` — add `JournalEntry`, `JournalLine`, `User` back-relation.
- `backend/server.js:53` (after the last `app.use`) — mount `/api/journal-entries`.
- `backend/controllers/accountController.js` — add `ledgerOptions`; fold journal net into `chart`; block delete of in-use ledger account.
- `backend/routes/accountRoutes.js` — add `GET /ledger-options`.
- `backend/controllers/partyController.js` — export `computeBalances` + `partyBalance`.
- `backend/controllers/cashBankController.js:179-207` — fold journal net into `balances`.

**Frontend (modify/create):**
- `frontend/src/services/api.js` — journal + ledger-options API fns.
- `frontend/src/pages/accountentries/JournalEntryModal.js` — new multi-line modal.
- `frontend/src/pages/accountentries/AccountEntryList.js` — rework to list journals + host modal + legacy toggle.

---

## Task 1: Prisma schema + migration

**Files:**
- Modify: `backend/prisma/schema.prisma` (add two models near the existing `AccountEntry` at line ~342; add `User` back-relation near line 560)

**Interfaces:**
- Produces: Prisma models `JournalEntry { id, refNumber, date, description, createdById, createdBy, lines, createdAt, updatedAt }` and `JournalLine { id, entryId, entry, accountKind, accountId, accountName, debit, credit, createdAt }`.

- [ ] **Step 1: Add the two models to `schema.prisma`** (place after the `AccountEntry` model block, before `CashBankEntry`):

```prisma
model JournalEntry {
  id          String        @id @default(uuid())
  refNumber   String        @unique @map("ref_number")
  date        DateTime
  description String        @default("")
  createdById String?       @map("created_by_id")
  createdBy   User?         @relation("JournalEntryCreatedBy", fields: [createdById], references: [id])
  lines       JournalLine[]
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  @@index([date(sort: Desc)])
  @@map("journal_entries")
}

model JournalLine {
  id          String       @id @default(uuid())
  entryId     String       @map("entry_id")
  entry       JournalEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)

  accountKind String       @map("account_kind")
  accountId   String?      @map("account_id")
  accountName String       @map("account_name")

  debit       Float        @default(0)
  credit      Float        @default(0)

  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([entryId])
  @@index([accountKind, accountId])
  @@map("journal_lines")
}
```

- [ ] **Step 2: Add the `User` back-relation.** In the `User` model (near line 560, beside `accountEntriesCreated`), add:

```prisma
  journalEntriesCreated    JournalEntry[]       @relation("JournalEntryCreatedBy")
```

- [ ] **Step 3: Generate + apply the migration**

Run (from `backend/`): `npx prisma migrate dev --name journal_entries`
Expected: creates `prisma/migrations/<ts>_journal_entries/migration.sql`, applies it, regenerates the client. If it reports drift, stop and report — do not `--force`/reset.

- [ ] **Step 4: Verify the tables + client**

Run (from `backend/`): `node -e "require('dotenv').config(); const p=require('./config/prisma'); p.journalEntry.count().then(n=>{console.log('journal_entries rows:',n); process.exit(0)}).catch(e=>{console.error(e); process.exit(1)})"`
Expected: prints `journal_entries rows: 0` (no error → table + client model exist).

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(journal): add JournalEntry/JournalLine schema + migration"
```

---

## Task 2: Pure helpers (validation + balance fold)

**Files:**
- Create: `backend/utils/journalValidation.js`, `backend/utils/journalValidation.test.js`
- Create: `backend/services/journalBalances.js`, `backend/services/journalBalances.test.js`

**Interfaces:**
- Produces:
  - `journalValidation`: `normalizeLines(rawLines) -> [{accountKind, accountId, debit, credit}]` (throws `{status,message}`); `assertBalanced(lines) -> {debit, credit}` (throws); `nextRefNumber(existingRefs: string[]) -> 'JE-<n>'`.
  - `journalBalances`: `journalKey(kind, id) -> string`; `foldJournalLines(lines) -> Map<key, netDr>` (pure); `drSide(balanceDr) -> {balance, side}`; `getJournalNetByAccount(prisma) -> Promise<Map<key, netDr>>` (DB).

- [ ] **Step 1: Write the failing test `backend/utils/journalValidation.test.js`**

```js
// Run: node backend/utils/journalValidation.test.js
const { normalizeLines, assertBalanced, nextRefNumber } = require('./journalValidation');

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✗ FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};
const throws = (name, fn) => {
  let threw = false; try { fn(); } catch { threw = true; }
  if (!threw) failures++;
  console.log(`${threw ? '✔' : '✗ FAIL'}  ${name} (expected throw)`);
};

// nextRefNumber
eq('nextRef empty', nextRefNumber([]), 'JE-1');
eq('nextRef from JE-52', nextRefNumber(['JE-52']), 'JE-53');
eq('nextRef ignores blanks', nextRefNumber([null, undefined, '', 'JE-7']), 'JE-8');

// normalizeLines happy path (one Dr, one Cr, paise rounding)
eq('normalize 2 lines', normalizeLines([
  { accountKind: 'ledger_account', accountId: 'w', debit: '390000', credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 390000.004 },
]), [
  { accountKind: 'ledger_account', accountId: 'w', debit: 390000, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 390000 },
]);
eq('normalize cash → null id', normalizeLines([
  { accountKind: 'cash', accountId: 'ignored', debit: 100, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 100 },
])[0].accountId, null);

// normalizeLines rejections
throws('reject <2 lines', () => normalizeLines([{ accountKind: 'cash', debit: 10, credit: 0 }]));
throws('reject both sides', () => normalizeLines([
  { accountKind: 'cash', debit: 10, credit: 10 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 10 },
]));
throws('reject zero line', () => normalizeLines([
  { accountKind: 'cash', debit: 0, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 10 },
]));
throws('reject bad kind', () => normalizeLines([
  { accountKind: 'nope', accountId: 'x', debit: 10, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 10 },
]));
throws('reject missing accountId (non-cash)', () => normalizeLines([
  { accountKind: 'bank', debit: 10, credit: 0 },
  { accountKind: 'cash', debit: 0, credit: 10 },
]));

// assertBalanced
eq('balanced totals', assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }]), { debit: 100, credit: 100 });
throws('reject unbalanced', () => assertBalanced([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }]));

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 2: Run it — expect failure**

Run: `node backend/utils/journalValidation.test.js`
Expected: FAIL — `Cannot find module './journalValidation'`.

- [ ] **Step 3: Implement `backend/utils/journalValidation.js`**

```js
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VALID_KINDS = ['bank', 'cash', 'ledger_account', 'expense_category', 'party'];

// Normalize + validate one raw line. Throws { status, message } on user error.
const normalizeLine = (raw, idx) => {
  const kind = String(raw?.accountKind || '').trim();
  if (!VALID_KINDS.includes(kind)) throw { status: 400, message: `Line ${idx + 1}: invalid account type` };
  const accountId = kind === 'cash' ? null : (raw.accountId ? String(raw.accountId) : null);
  if (kind !== 'cash' && !accountId) throw { status: 400, message: `Line ${idx + 1}: an account is required` };
  const debit = round2(raw.debit);
  const credit = round2(raw.credit);
  if (debit < 0 || credit < 0) throw { status: 400, message: `Line ${idx + 1}: amounts must be non-negative` };
  if ((debit > 0) === (credit > 0)) throw { status: 400, message: `Line ${idx + 1}: enter exactly one of Debit or Credit` };
  return { accountKind: kind, accountId, debit, credit };
};

const normalizeLines = (rawLines) => {
  if (!Array.isArray(rawLines) || rawLines.length < 2) throw { status: 400, message: 'A journal entry needs at least 2 lines' };
  return rawLines.map(normalizeLine);
};

const assertBalanced = (lines) => {
  const debit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
  const credit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
  if (Math.abs(debit - credit) >= 0.005) {
    throw { status: 400, message: `Total Debit (${debit}) and Credit (${credit}) must be equal` };
  }
  return { debit, credit };
};

// Given existing ref strings (e.g. ['JE-52']), return the next 'JE-<n>'.
const nextRefNumber = (existingRefs) => {
  let max = 0;
  for (const r of existingRefs || []) {
    const m = /(\d+)\s*$/.exec(String(r || ''));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `JE-${max + 1}`;
};

module.exports = { normalizeLines, assertBalanced, nextRefNumber, round2 };
```

- [ ] **Step 4: Run it — expect pass**

Run: `node backend/utils/journalValidation.test.js`
Expected: `All tests passed`.

- [ ] **Step 5: Write the failing test `backend/services/journalBalances.test.js`**

```js
// Run: node backend/services/journalBalances.test.js
const { journalKey, foldJournalLines, drSide } = require('./journalBalances');

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✗ FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

eq('journalKey cash', journalKey('cash', null), 'cash:');
eq('journalKey bank', journalKey('bank', 'h'), 'bank:h');

const fold = foldJournalLines([
  { accountKind: 'ledger_account', accountId: 'w', debit: 390000, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 390000 },
  { accountKind: 'bank', accountId: 'h', debit: 500, credit: 0 },
]);
eq('fold ledger', fold.get('ledger_account:w'), 390000);
eq('fold bank net', fold.get('bank:h'), -389500);

eq('drSide positive', drSide(37757.52), { balance: 37757.52, side: 'Dr' });
eq('drSide negative', drSide(-390000), { balance: 390000, side: 'Cr' });
eq('drSide zero', drSide(0), { balance: 0, side: 'Dr' });

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
```

- [ ] **Step 6: Run it — expect failure**

Run: `node backend/services/journalBalances.test.js`
Expected: FAIL — `Cannot find module './journalBalances'`.

- [ ] **Step 7: Implement `backend/services/journalBalances.js`**

```js
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Stable key for a polymorphic account reference. accountId is '' for cash.
const journalKey = (kind, id) => `${kind}:${id ?? ''}`;

// Pure: fold lines into a Map key -> net Dr amount (Σ debit − Σ credit).
const foldJournalLines = (lines) => {
  const map = new Map();
  for (const l of lines || []) {
    const key = journalKey(l.accountKind, l.accountId);
    const net = (Number(l.debit) || 0) - (Number(l.credit) || 0);
    map.set(key, round2((map.get(key) || 0) + net));
  }
  return map;
};

// Display helper: Dr-signed number -> { balance: |x|, side: 'Dr'|'Cr' }.
const drSide = (balanceDr) => {
  const v = round2(balanceDr);
  return { balance: Math.abs(v), side: v >= 0 ? 'Dr' : 'Cr' };
};

// DB: Map of every account's journal net (Dr-signed) across ALL journal lines.
const getJournalNetByAccount = async (prisma) => {
  const grouped = await prisma.journalLine.groupBy({
    by: ['accountKind', 'accountId'],
    _sum: { debit: true, credit: true },
  });
  const map = new Map();
  for (const g of grouped) {
    map.set(journalKey(g.accountKind, g.accountId), round2((g._sum.debit || 0) - (g._sum.credit || 0)));
  }
  return map;
};

module.exports = { journalKey, foldJournalLines, drSide, getJournalNetByAccount };
```

- [ ] **Step 8: Run it — expect pass**

Run: `node backend/services/journalBalances.test.js`
Expected: `All tests passed`.

- [ ] **Step 9: Commit**

```bash
git add backend/utils/journalValidation.js backend/utils/journalValidation.test.js backend/services/journalBalances.js backend/services/journalBalances.test.js
git commit -m "feat(journal): pure validation + balance-fold helpers with tests"
```

---

## Task 3: Journal entry controller + routes

**Files:**
- Create: `backend/controllers/journalEntryController.js`, `backend/routes/journalEntryRoutes.js`, `backend/scripts/smokeJournal.js`
- Modify: `backend/server.js` (mount route after line 53)

**Interfaces:**
- Consumes: `normalizeLines`, `assertBalanced`, `nextRefNumber` (Task 2); Prisma models (Task 1).
- Produces: REST endpoints under `/api/journal-entries` (`GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id`).

- [ ] **Step 1: Implement `backend/controllers/journalEntryController.js`**

```js
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
```

- [ ] **Step 2: Implement `backend/routes/journalEntryRoutes.js`**

```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/journalEntryController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('account_entries', 'view'), ctrl.list)
  .post(checkPermission('account_entries', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('account_entries', 'view'), ctrl.getOne)
  .patch(checkPermission('account_entries', 'edit'), ctrl.update)
  .delete(checkPermission('account_entries', 'delete'), ctrl.remove);

module.exports = router;
```

- [ ] **Step 3: Mount the route in `backend/server.js`** — add after the `/api/backup` line (line 53):

```js
app.use('/api/journal-entries', require('./routes/journalEntryRoutes'));
```

- [ ] **Step 4: Write the DB round-trip smoke `backend/scripts/smokeJournal.js`**

```js
// Run: node backend/scripts/smokeJournal.js
// Creates a balanced journal directly via Prisma, reads it back, deletes it.
require('dotenv').config();
const prisma = require('../config/prisma');
const { getJournalNetByAccount } = require('../services/journalBalances');

(async () => {
  const bank = await prisma.bankAccount.findFirst({ where: { isActive: true } });
  if (!bank) { console.error('No active bank account to test with'); process.exit(1); }
  const entry = await prisma.journalEntry.create({
    data: {
      refNumber: `JE-SMOKE-${Date.now()}`,
      date: new Date(),
      description: 'smoke test',
      lines: {
        create: [
          { accountKind: 'cash', accountId: null, accountName: 'Cash in Hand', debit: 1000, credit: 0 },
          { accountKind: 'bank', accountId: bank.id, accountName: bank.bankName, debit: 0, credit: 1000 },
        ],
      },
    },
    include: { lines: true },
  });
  const net = await getJournalNetByAccount(prisma);
  const cashNet = net.get('cash:') || 0;
  const bankNet = net.get(`bank:${bank.id}`) || 0;
  console.log('created', entry.refNumber, 'lines:', entry.lines.length, 'cashNet:', cashNet, 'bankNet:', bankNet);
  await prisma.journalEntry.delete({ where: { id: entry.id } });
  const gone = await prisma.journalLine.count({ where: { entryId: entry.id } });
  const ok = entry.lines.length === 2 && cashNet >= 1000 && bankNet <= -1000 && gone === 0;
  console.log(ok ? '✔ smoke passed (cascade delete removed lines)' : '✗ smoke FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Run the smoke test**

Run (from repo root): `node backend/scripts/smokeJournal.js`
Expected: prints `created JE-SMOKE-… lines: 2 …` then `✔ smoke passed (cascade delete removed lines)`.

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/journalEntryController.js backend/routes/journalEntryRoutes.js backend/scripts/smokeJournal.js backend/server.js
git commit -m "feat(journal): journal entry CRUD controller + routes"
```

---

## Task 4: Ledger-options endpoint (the account picker source)

**Files:**
- Modify: `backend/controllers/partyController.js` (export `computeBalances`, `partyBalance`)
- Modify: `backend/controllers/accountController.js` (add `ledgerOptions`)
- Modify: `backend/routes/accountRoutes.js` (add `GET /ledger-options`)

**Interfaces:**
- Consumes: `getJournalNetByAccount`, `journalKey`, `drSide` (Task 2); `computeBalances`, `partyBalance` (partyController).
- Produces: `GET /api/accounts/ledger-options` → `{ groups: [{ key, label, accounts: [{ kind, id, name, code, balance, side }] }] }`.

- [ ] **Step 1: Export the party-balance helpers.** In `backend/controllers/partyController.js`, find the module-scoped `computeBalances` and `partyBalance` functions and add at the bottom of the file (next to `module.exports`/`exports.*`):

```js
// Reused by the journal ledger-options picker to show each party's Cur Bal.
exports.computeBalances = computeBalances;
exports.partyBalance = partyBalance;
```

- [ ] **Step 2: Add `ledgerOptions` to `backend/controllers/accountController.js`** (append; reuse the requires already at the top and add the new ones):

```js
const { getJournalNetByAccount, journalKey, drSide } = require('../services/journalBalances');
const partyCtrl = require('./partyController');
```

```js
// Flat, grouped list of every selectable Chart-of-Accounts account WITH its
// current Dr-signed balance, for the Journal Entry "Select A/C" picker.
exports.ledgerOptions = async (req, res) => {
  try {
    const [accounts, bankAccounts, bankRows, cashRows, categories, catTotals, parties, partyBalances, jnet] = await Promise.all([
      prisma.account.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }] }),
      prisma.bankAccount.findMany({ where: { isActive: true }, orderBy: [{ isDefault: 'desc' }, { bankName: 'asc' }] }),
      prisma.cashBankEntry.groupBy({ by: ['bankAccountId', 'direction'], where: { bankAccountId: { not: null } }, _sum: { amount: true } }),
      prisma.cashBankEntry.groupBy({ by: ['direction'], where: { mode: 'cash' }, _sum: { amount: true } }),
      prisma.expenseCategory.findMany({ where: { isActive: true }, orderBy: [{ order: 'asc' }, { label: 'asc' }] }),
      prisma.expense.groupBy({ by: ['categoryId'], _sum: { amount: true } }),
      prisma.party.findMany({ where: { isActive: true }, orderBy: [{ name: 'asc' }] }),
      partyCtrl.computeBalances(),
      getJournalNetByAccount(prisma),
    ]);

    const j = (kind, id) => jnet.get(journalKey(kind, id)) || 0;

    const bankNativeDr = new Map();
    for (const r of bankRows) {
      const sign = r.direction === 'in' ? 1 : -1;
      bankNativeDr.set(r.bankAccountId, (bankNativeDr.get(r.bankAccountId) || 0) + sign * (r._sum.amount || 0));
    }
    const cashNativeDr = cashRows.reduce((s, r) => s + (r.direction === 'in' ? 1 : -1) * (r._sum.amount || 0), 0);
    const catTotalMap = new Map(catTotals.map((c) => [c.categoryId, c._sum.amount || 0]));

    const line = (kind, id, name, code, nativeDr) => {
      const { balance, side } = drSide(nativeDr + j(kind, id));
      return { kind, id, name, code: code || '', balance, side };
    };

    const bankAccountsOut = bankAccounts.map((b) => line('bank', b.id, b.bankName, b.accountNumber, bankNativeDr.get(b.id) || 0));
    const cashOut = [line('cash', null, 'Cash in Hand', '', cashNativeDr)];
    const ledgerOut = accounts.map((a) => line('ledger_account', a.id, a.name, a.accountCode, a.openingBalance || 0));
    const expenseOut = categories.map((c) => line('expense_category', c.id, c.label, c.slug, catTotalMap.get(c.id) || 0));
    // Party native balance is a signed receivable (+ they owe us = Dr).
    const partyOut = parties.map((p) => line('party', p.id, p.name, '', partyCtrl.partyBalance(p, partyBalances)));

    res.json({
      groups: [
        { key: 'bank', label: 'Bank Accounts', accounts: bankAccountsOut },
        { key: 'cash', label: 'Cash', accounts: cashOut },
        { key: 'ledger', label: 'Capital / Assets / Loans', accounts: ledgerOut },
        { key: 'expense', label: 'Expense Heads', accounts: expenseOut },
        { key: 'party', label: 'Sundry Debtors / Creditors', accounts: partyOut },
      ],
    });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};
```

- [ ] **Step 3: Add the route.** In `backend/routes/accountRoutes.js`, below the existing `router.get('/chart', ctrl.chart);` line, add:

```js
router.get('/ledger-options', ctrl.ledgerOptions);
```

- [ ] **Step 4: Verify with the running server.** Start the backend (`cd backend && npm run dev`), then in another shell obtain a token and call the endpoint:

```bash
TOKEN=$(curl -s localhost:5001/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"admin@claimoptiq.com","password":"Test@123"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s localhost:5001/api/accounts/ledger-options -H "Authorization: Bearer $TOKEN" | node -pe 'const d=JSON.parse(require("fs").readFileSync(0)); d.groups.map(g=>`${g.label}: ${g.accounts.length}`).join("\n")'
```
Expected: prints each group with a count (e.g. `Bank Accounts: 2`, `Cash: 1`, …). No 500.

- [ ] **Step 5: Commit**

```bash
git add backend/controllers/partyController.js backend/controllers/accountController.js backend/routes/accountRoutes.js
git commit -m "feat(journal): ledger-options endpoint for the account picker"
```

---

## Task 5: Fold journal lines into existing balances + guard account delete

**Files:**
- Modify: `backend/controllers/cashBankController.js:179-207` (`balances`)
- Modify: `backend/controllers/accountController.js` (`chart`; `remove`)

**Interfaces:**
- Consumes: `getJournalNetByAccount`, `journalKey` (Task 2).
- Produces: journal lines now affect Cash/Bank mode balances and Chart-of-Accounts balances; deleting an in-use ledger account is blocked.

- [ ] **Step 1: Fold journal net into `cashBankController.balances`.** At the top of `backend/controllers/cashBankController.js`, add the require:

```js
const { getJournalNetByAccount, journalKey } = require('../services/journalBalances');
```

Then in `exports.balances`, after the existing `for (const row of contraFrom) { … }` loop and before `out.total = …`, insert:

```js
    // Fold Journal Entry lines: a debit to cash/bank increases it, a credit decreases it.
    const jnet = await getJournalNetByAccount(prisma);
    out.cash += jnet.get(journalKey('cash', null)) || 0;
    for (const [key, val] of jnet) { if (key.startsWith('bank:')) out.bank += val; }
```

- [ ] **Step 2: Verify the fold end-to-end.** With the server running and `$TOKEN` from Task 4:

```bash
# baseline bank balance
curl -s localhost:5001/api/cash-bank/balances -H "Authorization: Bearer $TOKEN"
# post Owner's-Withdrawal-style journal: Dr cash 100 / Cr <bank> 100  (use a real bank _id + a ledger acct works too)
BANK=$(curl -s localhost:5001/api/accounts/ledger-options -H "Authorization: Bearer $TOKEN" | node -pe 'JSON.parse(require("fs").readFileSync(0)).groups.find(g=>g.key==="bank").accounts[0].id')
curl -s localhost:5001/api/journal-entries -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"date\":\"2026-08-12\",\"description\":\"fold test\",\"lines\":[{\"accountKind\":\"cash\",\"debit\":100,\"credit\":0},{\"accountKind\":\"bank\",\"accountId\":\"$BANK\",\"debit\":0,\"credit\":100}]}"
# bank balance should now be 100 lower, cash 100 higher
curl -s localhost:5001/api/cash-bank/balances -H "Authorization: Bearer $TOKEN"
```
Expected: second `/balances` shows `bank` down 100 and `cash` up 100 vs baseline. (Delete the test entry afterward via `DELETE /api/journal-entries/:id`.)

- [ ] **Step 3: Fold journal net into `accountController.chart`.** In `exports.chart`, add `getJournalNetByAccount(prisma)` to the `Promise.all([...])` array (bind it to a new `jnet` variable), then add `const j = (kind, id) => jnet.get(journalKey(kind, id)) || 0;` after the destructure. Update each line's balance to add its journal contribution:
  - bank lines: `balance: round(bankBal.get(b.id) || 0) + j('bank', b.id)`
  - cash line: `balance: cashBalance + j('cash', null)`
  - `accountsOfType(t)` helper: change its map to `balance: round(a.openingBalance) + j('ledger_account', a.id)`
  - the two `accounts.filter(... 'other' ...)` maps: add `+ j('ledger_account', a.id)`
  - expense lines: `balance: (catTotalMap.get(c.id) || 0) + j('expense_category', c.id)`
  - Sundry Debtors: `balance: receivable + Math.max(0, partyJournalNet)` and Sundry Creditors: `balance: payable + Math.max(0, -partyJournalNet)`, where before building the lines you compute `const partyJournalNet = [...jnet].filter(([k]) => k.startsWith('party:')).reduce((s, [, v]) => s + v, 0);`

  (Import `journalKey` alongside the Task-4 require of `getJournalNetByAccount`/`drSide` at the top of the controller.)

- [ ] **Step 4: Verify the chart reflects the journal.** With a test journal posted (Step 2 style), `curl -s localhost:5001/api/accounts/chart -H "Authorization: Bearer $TOKEN"` and confirm the affected account balances changed; then delete the test entry and confirm they revert.

- [ ] **Step 5: Block deleting an in-use ledger account.** In `backend/controllers/accountController.js`, `exports.remove`, after loading `existing` and before `prisma.account.delete`, insert:

```js
    const usedBy = await prisma.journalLine.count({ where: { accountKind: 'ledger_account', accountId: existing.id } });
    if (usedBy > 0) return res.status(409).json({ message: `Cannot delete: used by ${usedBy} journal line(s)` });
```

- [ ] **Step 6: Verify the guard.** Create a ledger account, post a journal that uses it, then `DELETE /api/accounts/:id` → expect `409` with the "used by N journal line(s)" message. Delete the journal, retry the delete → expect success.

- [ ] **Step 7: Commit**

```bash
git add backend/controllers/cashBankController.js backend/controllers/accountController.js
git commit -m "feat(journal): fold journal lines into cash-bank + chart balances; guard ledger delete"
```

---

## Task 6: Frontend API + Journal Entry modal

**Files:**
- Modify: `frontend/src/services/api.js` (add fns near the existing account-entry fns, ~line 267)
- Create: `frontend/src/pages/accountentries/JournalEntryModal.js`

**Interfaces:**
- Consumes: `/api/journal-entries`, `/api/accounts/ledger-options`.
- Produces: `JournalEntryModal` component `({ open, initial, onClose, onSave })`; API fns `getJournalEntriesAPI`, `getJournalEntryAPI`, `createJournalEntryAPI`, `updateJournalEntryAPI`, `deleteJournalEntryAPI`, `getLedgerOptionsAPI`.

- [ ] **Step 1: Add API functions to `frontend/src/services/api.js`** (after the account-entry block, ~line 272):

```js
// ── Journal Entries (double-entry) ──────────────────────────────
export const getLedgerOptionsAPI       = () => API.get('/accounts/ledger-options');
export const getJournalEntriesAPI      = (params) => API.get('/journal-entries', { params });
export const getJournalEntryAPI        = (id) => API.get(`/journal-entries/${id}`);
export const createJournalEntryAPI      = (data) => API.post('/journal-entries', data);
export const updateJournalEntryAPI      = (id, data) => API.patch(`/journal-entries/${id}`, data);
export const deleteJournalEntryAPI      = (id) => API.delete(`/journal-entries/${id}`);
```

- [ ] **Step 2: Create `frontend/src/pages/accountentries/JournalEntryModal.js`**

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi';
import { getLedgerOptionsAPI } from '../../services/api';

const todayIso = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const formatINR = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const emptyLine = () => ({ accountKind: '', accountId: null, debit: '', credit: '' });

// A flat option value encodes kind + id so the <select> stays a single string.
const optValue = (a) => `${a.kind}:${a.id ?? ''}`;
const parseOpt = (v) => { const i = v.indexOf(':'); return { kind: v.slice(0, i), id: v.slice(i + 1) || null }; };

const JournalEntryModal = ({ open, initial, onClose, onSave }) => {
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getLedgerOptionsAPI().then((r) => setGroups(r.data.groups)).catch(() => setGroups([]));
    if (initial) {
      setDate((initial.date || '').slice(0, 10) || todayIso());
      setDescription(initial.description || '');
      setLines((initial.lines || []).map((l) => ({
        accountKind: l.accountKind, accountId: l.accountId,
        debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '',
      })));
    } else {
      setDate(todayIso()); setDescription(''); setLines([emptyLine(), emptyLine()]);
    }
  }, [open, initial]);

  // Map "kind:id" -> account (for Cur Bal display).
  const optIndex = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const a of g.accounts) m.set(optValue(a), a);
    return m;
  }, [groups]);

  const totals = useMemo(() => {
    const debit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const credit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    return { debit, credit, balanced: debit > 0 && Math.abs(debit - credit) < 0.005 };
  }, [lines]);

  const everyLineValid = lines.every((l) =>
    l.accountKind && (l.accountKind === 'cash' || l.accountId) &&
    ((Number(l.debit) > 0) !== (Number(l.credit) > 0)));

  const canSave = totals.balanced && lines.length >= 2 && everyLineValid && !saving;

  if (!open) return null;

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const onPickAccount = (i, v) => { const { kind, id } = parseOpt(v); setLine(i, { accountKind: kind, accountId: id }); };
  const onDebit = (i, v) => setLine(i, { debit: v, credit: '' });
  const onCredit = (i, v) => setLine(i, { credit: v, debit: '' });
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length <= 2 ? ls : ls.filter((_, idx) => idx !== i)));

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        date, description,
        lines: lines.map((l) => ({
          accountKind: l.accountKind, accountId: l.accountKind === 'cash' ? null : l.accountId,
          debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        })),
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? `Edit Journal Entry ${initial.refNumber || ''}` : 'Journal Entry'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex justify-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Journal Date *</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_140px_36px] bg-gray-50 text-xs font-semibold uppercase text-gray-500 px-3 py-2">
              <span>Account</span><span className="text-right">Credit</span><span className="text-right">Debit</span><span />
            </div>
            {lines.map((l, i) => {
              const acct = optIndex.get(`${l.accountKind}:${l.accountId ?? ''}`);
              return (
                <div key={i} className="grid grid-cols-[1fr_140px_140px_36px] items-center px-3 py-2 border-t border-gray-100 gap-2">
                  <div>
                    <select value={l.accountKind ? `${l.accountKind}:${l.accountId ?? ''}` : ''} onChange={(e) => onPickAccount(i, e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                      <option value="">Select A/C</option>
                      {groups.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {g.accounts.map((a) => <option key={optValue(a)} value={optValue(a)}>{a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {acct && <p className="text-[11px] text-gray-400 mt-0.5">Cur Bal: {formatINR(acct.balance)} {acct.side}</p>}
                  </div>
                  <input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => onCredit(i, e.target.value)}
                    placeholder="0.00" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                  <input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => onDebit(i, e.target.value)}
                    placeholder="0.00" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                  <button type="button" onClick={() => removeLine(i)} disabled={lines.length <= 2}
                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"><HiOutlineTrash className="w-4 h-4" /></button>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_140px_140px_36px] items-center px-3 py-2 border-t border-gray-200 bg-gray-50 text-sm font-semibold">
              <button type="button" onClick={addLine} className="flex items-center gap-1 text-primary-600 hover:text-primary-700 justify-self-start">
                <HiOutlinePlus className="w-4 h-4" /> Add row
              </button>
              <span className="text-right">{formatINR(totals.credit)}</span>
              <span className="text-right">{formatINR(totals.debit)}</span>
              <span />
            </div>
          </div>

          {!totals.balanced && (totals.debit > 0 || totals.credit > 0) && (
            <p className="text-xs text-red-600">Total Debit and Credit must be equal to save.</p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description here" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={!canSave}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JournalEntryModal;
```

- [ ] **Step 3: Verify it compiles.** Run (from `frontend/`): `npx eslint src/pages/accountentries/JournalEntryModal.js` (or confirm the dev server hot-reloads without a compile error). Expected: no errors. (Full click-through happens in Task 7.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.js frontend/src/pages/accountentries/JournalEntryModal.js
git commit -m "feat(journal): frontend API fns + Journal Entry modal"
```

---

## Task 7: Rework the list page to journals (+ legacy toggle)

**Files:**
- Modify: `frontend/src/pages/accountentries/AccountEntryList.js` (replace the add-modal + primary list with journals; keep the old table behind a "Legacy" toggle)

**Interfaces:**
- Consumes: `getJournalEntriesAPI`, `createJournalEntryAPI`, `updateJournalEntryAPI`, `deleteJournalEntryAPI` (Task 6); `JournalEntryModal` (Task 6). Keeps existing `getAccountEntriesAPI` for the legacy view.

- [ ] **Step 1: Rework `AccountEntryList.js`.** Replace the component so that:
  - A segmented toggle `[Journal Entries] [Legacy]` sits at the top (default `journal`).
  - **Journal view:** `+ Add Entry` opens `JournalEntryModal`; table columns `Date | Ref | Entry (lines summary) | Description | By | Actions`. The lines summary renders each line as `name Dr ₹x` / `name Cr ₹x` joined by `→`. Save calls `createJournalEntryAPI`/`updateJournalEntryAPI`; delete calls `deleteJournalEntryAPI`. Date-range + search filters call `getJournalEntriesAPI`.
  - **Legacy view:** the EXISTING account-entry table, read-only (no Add/Edit/Delete controls), fetched via `getAccountEntriesAPI`. Show a one-line banner: "Legacy account entries (read-only). New entries use Journal Entries."

Full replacement file:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSwitchHorizontal } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getJournalEntriesAPI, createJournalEntryAPI, updateJournalEntryAPI, deleteJournalEntryAPI,
  getAccountEntriesAPI,
} from '../../services/api';
import JournalEntryModal from './JournalEntryModal';
import { formatDate as _formatDate } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const formatINR = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);

const lineSummary = (lines = []) => lines.map((l) =>
  `${l.accountName} ${l.debit > 0 ? 'Dr ' + formatINR(l.debit) : 'Cr ' + formatINR(l.credit)}`).join('  →  ');

const AccountEntryList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('account_entries', 'create');
  const canEdit = can('account_entries', 'edit');
  const canDelete = can('account_entries', 'delete');

  const [tab, setTab] = usePersistedFilters('journal:tab', 'journal');
  const [items, setItems] = useState([]);
  const [legacy, setLegacy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [page, setPage] = usePersistedFilters('journal:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('journal:pageSize', 25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = usePersistedFilters('journal:filters', { from: monthStart(), to: todayIso(), q: '' });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const params = useMemo(() => ({
    page, limit: pageSize, from: filters.from || undefined, to: filters.to || undefined, q: filters.q || undefined,
  }), [page, pageSize, filters]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      if (tab === 'journal') {
        const r = await getJournalEntriesAPI(params);
        setItems(r.data.entries); setTotal(r.data.total);
      } else {
        const r = await getAccountEntriesAPI({ from: filters.from || undefined, to: filters.to || undefined, limit: 200 });
        setLegacy(r.data.entries); setTotal(r.data.total);
      }
    } catch { toast.error('Failed to load entries'); } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params, tab]);

  const handleSave = async (form) => {
    try {
      if (modal.item) { await updateJournalEntryAPI(modal.item._id, form); toast.success('Journal updated'); }
      else { await createJournalEntryAPI(form); toast.success('Journal added'); }
      setModal({ open: false, item: null }); fetchAll();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to save'); throw e; }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete ${item.refNumber}?`, { title: 'Delete Journal', confirmLabel: 'Delete' }))) return;
    try { await deleteJournalEntryAPI(item._id); toast.success('Deleted'); fetchAll(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete'); }
  };

  const Tab = ({ id, label }) => (
    <button onClick={() => { setTab(id); setPage(1); }}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 border-b border-gray-100">
          <Tab id="journal" label="Journal Entries" />
          <Tab id="legacy" label="Legacy" />
        </div>
        {tab === 'journal' && canCreate && (
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-4 h-4" /> Add Entry
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          {tab === 'journal' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input value={filters.q} onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
                placeholder="Ref / description / account…" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          )}
        </div>

        {tab === 'legacy' && (
          <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
            Legacy account entries (read-only). New entries use Journal Entries.
          </p>
        )}

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : tab === 'journal' ? (
          items.length === 0 ? <div className="py-8 text-center text-gray-400">No journal entries in this range</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Ref</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Entry</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((e) => (
                    <tr key={e._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="py-3 px-4 font-medium text-gray-700 whitespace-nowrap">{e.refNumber}</td>
                      <td className="py-3 px-4 text-gray-700 text-sm">{lineSummary(e.lines)}</td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.description || <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          {canEdit && <button onClick={() => setModal({ open: true, item: e })} className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"><HiOutlinePencil className="w-4 h-4" /></button>}
                          {canDelete && <button onClick={() => handleDelete(e)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"><HiOutlineTrash className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          legacy.length === 0 ? <div className="py-8 text-center text-gray-400">No legacy entries in this range</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Debit</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Credit</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Contra</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {legacy.map((e) => (
                    <tr key={e._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="py-3 px-4"><span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">{e.entryType?.toUpperCase()}</span></td>
                      <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.debit > 0 ? formatINR(e.debit) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.credit > 0 ? formatINR(e.credit) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-gray-700">
                        {e.entryType === 'contra' ? (
                          <span className="inline-flex items-center gap-1"><span className="font-medium">{e.fromMode?.toUpperCase()}</span><HiOutlineSwitchHorizontal className="w-3.5 h-3.5 text-gray-400" /><span className="font-medium">{e.toMode?.toUpperCase()}</span><span className="ml-2 text-gray-500">{formatINR(e.amount)}</span></span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.remarks || <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && tab === 'journal' && total > 0 && (
          <PaginationBar page={page} pages={pages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      <JournalEntryModal open={modal.open} initial={modal.item}
        onClose={() => setModal({ open: false, item: null })} onSave={handleSave} />
    </div>
  );
};

export default AccountEntryList;
```

- [ ] **Step 2: Manual end-to-end verification (run the app).** Start backend (`cd backend && npm run dev`) and frontend (`cd frontend && npm start`). Log in as `admin@claimoptiq.com` / `Test@123`. Then:
  1. Open **Account Entries** → **Journal Entries** tab → **Add Entry**.
  2. Reproduce the reference: Line 1 = an "Owner's Withdrawal"-type ledger account (create one under Chart of Accounts first if none), **Debit 390000**; Line 2 = a bank account, **Credit 390000**. Confirm each line shows `Cur Bal … Dr/Cr`, the footer shows `3,90,000 / 3,90,000`, and **Save** enables only when balanced.
  3. Save → the entry appears with `JE-1` (or next), correct line summary.
  4. Go to **Cash/Bank** (or Chart of Accounts) → confirm the bank balance dropped by 3,90,000 and Owner's Withdrawal rose 3,90,000 Dr.
  5. Delete the entry → confirm balances revert.
  6. Switch to **Legacy** tab → confirm old entries render read-only (no Add/Edit/Delete).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/accountentries/AccountEntryList.js
git commit -m "feat(journal): rework Account Entries page to Journal Entries + legacy view"
```

---

## Self-review notes (author check — done)

- **Spec coverage:** data model (T1); ref-number + validation + balance-check (T2); CRUD API + RBAC reuse (T3); unified account picker with Cur Bal, parties individualized (T4); fold into Chart + Cash/Bank, block in-use ledger delete (T5); modal matching the reference + must-balance Save (T6); page rework + retire old add form + legacy history (T7). Reports/P&L explicitly deferred per decision (i).
- **Placeholder scan:** none — every code/test step is concrete.
- **Type consistency:** `accountKind`/`accountId`/`accountName`/`debit`/`credit` and helper names (`journalKey`, `foldJournalLines`, `getJournalNetByAccount`, `drSide`, `normalizeLines`, `assertBalanced`, `nextRefNumber`) are used identically across tasks. Option encoding `kind:id` is consistent between modal build + parse.
- **Known v1 boundaries:** Chart's Sundry Debtors/Creditors fold is an aggregate (per-party accuracy lives in the picker's Cur Bal). Delete-guard covers `ledger_account` deletes (bank/party/category delete guards are a noted follow-up). No bulk import for journals.
