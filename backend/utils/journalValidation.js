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
