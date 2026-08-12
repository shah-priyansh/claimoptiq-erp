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
