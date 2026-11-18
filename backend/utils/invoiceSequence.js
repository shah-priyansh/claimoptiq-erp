// Indian fiscal year: Apr 1 → Mar 31. Returns "YYYY-YY" string.
// Kept for callers that still want a FY label; no longer used by the
// invoice-numbering flow.
const getFiscalYear = (date) => {
  const d = new Date(date);
  const month = d.getUTCMonth(); // 0-11
  const year = d.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1; // April = 3
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, '0')}`;
};

// The operator-supplied prefix is used literally and the sequence number is
// appended as-is: "26/0" yields "26/01", "26/011", "26/0167", ... Only a
// prefix ending in a letter gets a "/" separator, so "FCC" still produces a
// readable "FCC/1" rather than "FCC1".
const parseInvoicePrefix = (raw) => {
  const str = String(raw || '').trim();
  if (!str) return { base: 'FCC/' };
  const needsSep = /[A-Za-z]$/.test(str);
  return { base: needsSep ? str + '/' : str };
};

// Highest numeric suffix among existing invoices that start with `base`, so
// the sequence continues after imported/legacy bills (e.g. "26/0166" → 167).
const maxExistingSequence = async (tx, base) => {
  const rows = await tx.invoice.findMany({
    where: { invoiceNumber: { startsWith: base } },
    select: { invoiceNumber: true },
  });
  return rows.reduce((max, r) => {
    const rest = r.invoiceNumber.slice(base.length);
    return /^\d+$/.test(rest) ? Math.max(max, parseInt(rest, 10)) : max;
  }, 0);
};

// Atomically reserve the next invoice number for the given prefix.
// Stores the per-base counter in SiteSetting under `invoice.seq.<base>`.
// The highest existing invoice number acts as a floor, so the sequence never
// goes backwards or collides with bills created outside the counter.
// Must be called inside a $transaction `tx` for atomicity.
const reserveNextInvoiceNumber = async (tx, rawPrefix) => {
  const { base } = parseInvoicePrefix(rawPrefix);
  const key = `invoice.seq.${base}`;
  const existing = await tx.siteSetting.findUnique({ where: { key } });
  const stored = (() => {
    if (!existing) return 0;
    try { return Number(JSON.parse(existing.value)?.seq) || 0; } catch { return 0; }
  })();
  const next = Math.max(stored, await maxExistingSequence(tx, base)) + 1;
  if (existing) {
    await tx.siteSetting.update({ where: { key }, data: { value: JSON.stringify({ seq: next }) } });
  } else {
    await tx.siteSetting.create({ data: { key, value: JSON.stringify({ seq: next }) } });
  }
  return `${base}${next}`;
};

module.exports = { getFiscalYear, parseInvoicePrefix, reserveNextInvoiceNumber };
