// Standalone test for the catch-up candidate ordering (backupService.pickCatchUp).
// Run: node backend/services/backupCatchUp.test.js
const { pickCatchUp, CLAIM_DOC, SUBMISSION } = require('./backupService');

let failures = 0;
const check = (name, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✔' : '✘ FAIL'}  ${name}`);
};

const docs = [
  { id: 'd-old-failed', at: '2026-01-01', tried: true },
  { id: 'd-new', at: '2026-03-01', tried: false },
  { id: 'd-old', at: '2026-01-15', tried: false },
];
const subs = [
  { id: 's-mid', at: '2026-02-01', tried: false },
  { id: 's-failed', at: '2026-01-05', tried: true },
];

const all = pickCatchUp(docs, subs, 10);
check('never-tried files come before previously-failed ones',
  all.map((r) => r.id).join(',') === 'd-old,s-mid,d-new,d-old-failed,s-failed');
check('each row keeps its source type',
  all.find((r) => r.id === 's-mid').sourceType === SUBMISSION
  && all.find((r) => r.id === 'd-new').sourceType === CLAIM_DOC);

const capped = pickCatchUp(docs, subs, 2);
check('cap applies across both tables', capped.map((r) => r.id).join(',') === 'd-old,s-mid');

check('empty input gives no work', pickCatchUp([], [], 5).length === 0);
// Postgres EXISTS comes back as a real boolean, but be safe with 0/1 too.
check('tried flag accepts 0/1', pickCatchUp([{ id: 'a', at: '2026-01-01', tried: 1 }, { id: 'b', at: '2026-02-01', tried: 0 }], [], 5)[0].id === 'b');

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
