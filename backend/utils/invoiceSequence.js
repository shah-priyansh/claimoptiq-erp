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

// Split the operator-supplied prefix into a literal "base" and a numeric
// "seed". The seed is the trailing run of digits; the next invoice's sequence
// starts at seed + 1, so typing "26/0" yields invoices "26/1", "26/2", ...
// If the prefix has no trailing digits, we append a "/" so e.g. "FCC" still
// produces a readable "FCC/1" rather than "FCC1".
const parseInvoicePrefix = (raw) => {
  const str = String(raw || '').trim();
  if (!str) return { base: 'FCC/', seed: 0 };
  const m = str.match(/^(.*?)(\d+)$/);
  if (m) return { base: m[1], seed: parseInt(m[2], 10) || 0 };
  // No trailing digit — add a separator unless the operator already ended
  // the prefix with one (so "INV-" stays "INV-", "FCC" becomes "FCC/").
  const needsSep = !(str.endsWith('/') || str.endsWith('-') || str.endsWith('_'));
  return { base: needsSep ? str + '/' : str, seed: 0 };
};

// Atomically reserve the next invoice number for the given prefix.
// Stores the per-base counter in SiteSetting under `invoice.seq.<base>`.
// The seed acts as a floor: changing the configured prefix from "26/0" to
// "26/100" makes the next invoice "26/101" rather than going backwards.
// Must be called inside a $transaction `tx` for atomicity.
const reserveNextInvoiceNumber = async (tx, rawPrefix) => {
  const { base, seed } = parseInvoicePrefix(rawPrefix);
  const key = `invoice.seq.${base}`;
  const existing = await tx.siteSetting.findUnique({ where: { key } });
  const stored = (() => {
    if (!existing) return 0;
    try { return Number(JSON.parse(existing.value)?.seq) || 0; } catch { return 0; }
  })();
  const next = Math.max(stored, seed) + 1;
  if (existing) {
    await tx.siteSetting.update({ where: { key }, data: { value: JSON.stringify({ seq: next }) } });
  } else {
    await tx.siteSetting.create({ data: { key, value: JSON.stringify({ seq: next }) } });
  }
  return `${base}${next}`;
};

module.exports = { getFiscalYear, parseInvoicePrefix, reserveNextInvoiceNumber };
