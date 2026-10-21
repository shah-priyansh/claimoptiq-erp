// Run: node backend/utils/lineQty.test.js
const { parseLineQty, computeLineAmount, normalizeQtyRateLine } = require('./lineQty');

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✗ FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

// parseLineQty — plain numbers
eq('qty "2"', parseLineQty('2'), { qtyRaw: '2', qtyIsPercent: false, qtyValue: 2 });
eq('qty "1.5"', parseLineQty('1.5'), { qtyRaw: '1.5', qtyIsPercent: false, qtyValue: 1.5 });
eq('qty number 3', parseLineQty(3), { qtyRaw: '3', qtyIsPercent: false, qtyValue: 3 });

// parseLineQty — percents
eq('qty "50%"', parseLineQty('50%'), { qtyRaw: '50%', qtyIsPercent: true, qtyValue: 50 });
eq('qty "%" blank pct -> 0', parseLineQty('%'), { qtyRaw: '%', qtyIsPercent: true, qtyValue: 0 });

// parseLineQty — blank / missing defaults to a plain "1"
eq('qty null -> 1', parseLineQty(null), { qtyRaw: '1', qtyIsPercent: false, qtyValue: 1 });
eq('qty undefined -> 1', parseLineQty(undefined), { qtyRaw: '1', qtyIsPercent: false, qtyValue: 1 });
eq('qty "" -> 1', parseLineQty(''), { qtyRaw: '1', qtyIsPercent: false, qtyValue: 1 });
eq('qty "  " -> 1', parseLineQty('   '), { qtyRaw: '1', qtyIsPercent: false, qtyValue: 1 });

// computeLineAmount
eq('amount 500 x 2', computeLineAmount(500, 2, false), 1000);
eq('amount 2000 x 50%', computeLineAmount(2000, 50, true), 1000);
eq('amount 100 x 1', computeLineAmount(100, 1, false), 100);
eq('amount paise kept', computeLineAmount(899.37, 1, false), 899.37);
eq('amount rounds to paise', computeLineAmount(333.333, 3, false), 1000);
eq('amount string rate', computeLineAmount('500', 2, false), 1000);

// normalizeQtyRateLine — recomputes amount from rate + qty, never trusts client
eq('normalize number qty', normalizeQtyRateLine({ rate: '500', qty: '2' }),
  { rate: 500, qtyRaw: '2', qtyIsPercent: false, qtyValue: 2, amount: 1000 });
eq('normalize percent qty', normalizeQtyRateLine({ rate: 2000, qtyRaw: '50%' }),
  { rate: 2000, qtyRaw: '50%', qtyIsPercent: true, qtyValue: 50, amount: 1000 });
eq('normalize empty -> rate 0 qty 1', normalizeQtyRateLine({}),
  { rate: 0, qtyRaw: '1', qtyIsPercent: false, qtyValue: 1, amount: 0 });
eq('normalize ignores client amount', normalizeQtyRateLine({ rate: 100, qty: '2', amount: 999999 }),
  { rate: 100, qtyRaw: '2', qtyIsPercent: false, qtyValue: 2, amount: 200 });

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
