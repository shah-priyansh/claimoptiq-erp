// Per-hospital, zero-pad-aware numbering for HospitalFinalBill.
//
// Hospital.hospitalBillStartNo is a digit string the admin types in the
// Hospital module, e.g. "000". Its length sets the zero-padding width and
// its numeric value sets the floor: "000" -> first bill "001", "002" ...
// "010", "011" ... "099", "100" (width grows naturally past that point,
// never truncates). A blank value starts at "1" with no padding (width 1).
//
// Mirrors invoiceSequence.js's atomicity guarantee: the running counter is
// stored per-hospital in SiteSetting and read-modify-written inside the
// caller's $transaction, so concurrent bill creations for the same hospital
// serialize on that row. Must be called inside a $transaction `tx`.

const parseBillStart = (raw) => {
  const str = String(raw || '').trim();
  const digits = /^\d+$/.test(str) ? str : '';
  if (!digits) return { seed: 0, width: 1 };
  return { seed: parseInt(digits, 10) || 0, width: digits.length };
};

// Atomically reserve the next bill number for a hospital. The seed acts as a
// floor: raising a hospital's configured start after bills already exist
// never makes the next number go backwards.
const reserveNextHospitalBillNumber = async (tx, hospitalId, rawStart) => {
  const { seed, width } = parseBillStart(rawStart);
  const key = `hospitalBill.seq.${hospitalId}`;
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
  return { billNo: next, billNoFormatted: String(next).padStart(width, '0') };
};

// Read-only preview of what the next bill number would be — no write, so it's
// safe to call from a GET (the bill builder UI shows this before save so the
// operator has an idea of the number; the actual number is only locked in by
// reserveNextHospitalBillNumber at save time, inside a $transaction).
const peekNextHospitalBillNumber = async (prisma, hospitalId, rawStart) => {
  const { seed, width } = parseBillStart(rawStart);
  const key = `hospitalBill.seq.${hospitalId}`;
  const existing = await prisma.siteSetting.findUnique({ where: { key } });
  const stored = (() => {
    if (!existing) return 0;
    try { return Number(JSON.parse(existing.value)?.seq) || 0; } catch { return 0; }
  })();
  const next = Math.max(stored, seed) + 1;
  return { billNo: next, billNoFormatted: String(next).padStart(width, '0') };
};

module.exports = { parseBillStart, reserveNextHospitalBillNumber, peekNextHospitalBillNumber };
