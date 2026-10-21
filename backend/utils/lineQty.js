// Shared qty/rate line-item math. A single free-text qty field per line doubles
// as a plain multiplier or a percentage of the rate:
//   "2"   -> rate * 2
//   "50%" -> rate * 50 / 100
// This mirrors the HospitalFinalBillItem model (rate, qtyRaw, qtyIsPercent,
// qtyValue, amount) and is reused by claims, invoices and expenses so the
// amount is always recomputed server-side and never trusted from the client.
const { round2 } = require('./money');

// Blank/invalid numeric qty defaults to 1 (a plain charge line); blank/invalid
// percent defaults to 0. qtyRaw preserves the exact text so a form can redisplay
// it unchanged; qtyIsPercent/qtyValue are the parsed form used for the math.
function parseLineQty(rawQty) {
  const qtyRaw = String(rawQty ?? '1').trim();
  const isPercent = qtyRaw.includes('%');
  const parsed = parseFloat(qtyRaw.replace('%', ''));
  const qtyValue = Number.isFinite(parsed) ? parsed : (isPercent ? 0 : 1);
  return { qtyRaw: qtyRaw || '1', qtyIsPercent: isPercent, qtyValue };
}

// amount = rate * qtyValue, or rate * qtyValue / 100 when the qty is a percent.
function computeLineAmount(rate, qtyValue, qtyIsPercent) {
  const r = Number(rate) || 0;
  const q = Number(qtyValue) || 0;
  return round2(qtyIsPercent ? (r * q) / 100 : r * q);
}

// Normalize one raw line ({ rate, qtyRaw|qty }) into the stored shape
// { rate, qtyRaw, qtyIsPercent, qtyValue, amount }. Amount is always recomputed.
function normalizeQtyRateLine(raw = {}) {
  const rate = round2(Number(raw.rate) || 0);
  const { qtyRaw, qtyIsPercent, qtyValue } = parseLineQty(raw.qtyRaw ?? raw.qty);
  const amount = computeLineAmount(rate, qtyValue, qtyIsPercent);
  return { rate, qtyRaw, qtyIsPercent, qtyValue, amount };
}

module.exports = { parseLineQty, computeLineAmount, normalizeQtyRateLine };
