// Indian fiscal year: Apr 1 → Mar 31. Returns "YYYY-YY" string.
const getFiscalYear = (date) => {
  const d = new Date(date);
  const month = d.getUTCMonth(); // 0-11
  const year = d.getUTCFullYear();
  const startYear = month >= 3 ? year : year - 1; // April = 3
  const endYear = (startYear + 1) % 100;
  return `${startYear}-${String(endYear).padStart(2, '0')}`;
};

// Atomically reserve the next invoice number for the given prefix+FY.
// Uses a SiteSetting row keyed `invoice.seq.<FY>` whose value stores `{seq:N}`.
// Must be called inside a $transaction tx for atomicity.
const reserveNextInvoiceNumber = async (tx, prefix, date) => {
  const fy = getFiscalYear(date);
  const key = `invoice.seq.${fy}`;
  const existing = await tx.siteSetting.findUnique({ where: { key } });
  let next;
  if (!existing) {
    next = 1;
    await tx.siteSetting.create({ data: { key, value: JSON.stringify({ seq: next }) } });
  } else {
    const parsed = (() => {
      try { return JSON.parse(existing.value); } catch { return { seq: 0 }; }
    })();
    next = (Number(parsed.seq) || 0) + 1;
    await tx.siteSetting.update({ where: { key }, data: { value: JSON.stringify({ seq: next }) } });
  }
  const padded = String(next).padStart(4, '0');
  return `${prefix}/${fy}/${padded}`;
};

module.exports = { getFiscalYear, reserveNextInvoiceNumber };
