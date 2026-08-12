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
