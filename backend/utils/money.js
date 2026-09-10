// Shared money rounding. Amounts across the app carry paise (e.g. a ₹899.37
// petrol bill, GST that lands on a fraction of a rupee), so money is rounded to
// 2 decimals — NEVER to whole rupees, which silently dropped the paise and left
// balances that never reconciled. Use this for every rupee value; leave counts,
// minutes, percentages, and pagination on plain Math.round/Math.floor.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

module.exports = { round2 };
