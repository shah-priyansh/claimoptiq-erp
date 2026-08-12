// Run: node backend/services/journalBalances.test.js
const { journalKey, foldJournalLines, drSide } = require('./journalBalances');

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✗ FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
};

eq('journalKey cash', journalKey('cash', null), 'cash:');
eq('journalKey bank', journalKey('bank', 'h'), 'bank:h');

const fold = foldJournalLines([
  { accountKind: 'ledger_account', accountId: 'w', debit: 390000, credit: 0 },
  { accountKind: 'bank', accountId: 'h', debit: 0, credit: 390000 },
  { accountKind: 'bank', accountId: 'h', debit: 500, credit: 0 },
]);
eq('fold ledger', fold.get('ledger_account:w'), 390000);
eq('fold bank net', fold.get('bank:h'), -389500);

eq('drSide positive', drSide(37757.52), { balance: 37757.52, side: 'Dr' });
eq('drSide negative', drSide(-390000), { balance: 390000, side: 'Cr' });
eq('drSide zero', drSide(0), { balance: 0, side: 'Dr' });

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
