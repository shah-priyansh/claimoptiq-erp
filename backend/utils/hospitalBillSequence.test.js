// Standalone test for parseBillStart (pure). reserveNextHospitalBillNumber
// needs a live tx/DB and is covered by the manual verification script instead.
// Run: node backend/utils/hospitalBillSequence.test.js
const { parseBillStart } = require('./hospitalBillSequence');

let failures = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ FAIL'}  ${name}\n     got:  ${JSON.stringify(got)}\n     want: ${JSON.stringify(want)}`);
};

eq('blank -> seed 0, width 1', parseBillStart(''), { seed: 0, width: 1 });
eq('null -> seed 0, width 1', parseBillStart(null), { seed: 0, width: 1 });
eq('"000" -> seed 0, width 3', parseBillStart('000'), { seed: 0, width: 3 });
eq('"00" -> seed 0, width 2', parseBillStart('00'), { seed: 0, width: 2 });
eq('"100" -> seed 100, width 3', parseBillStart('100'), { seed: 100, width: 3 });
eq('"5" -> seed 5, width 1', parseBillStart('5'), { seed: 5, width: 1 });
eq('non-digits -> seed 0, width 1', parseBillStart('abc'), { seed: 0, width: 1 });
eq('whitespace padded digits', parseBillStart('  007  '), { seed: 7, width: 3 });

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
