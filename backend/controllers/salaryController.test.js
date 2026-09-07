// Standalone test for the OT / short-hours / net-balance calculation.
// Run: node backend/controllers/salaryController.test.js
const { _computeSalary } = require('./salaryController');

const hm = (h, m) => h * 60 + m;
let failures = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '�’ FAIL'}  ${name}: got ${got}, want ${want}`);
};

const emp = (over = {}) => ({ standardHours: 9, dailyOtEnabled: true, basicSalary: 31000, joiningDate: null, lastDate: null, allowances: [], ...over });
const day = (d, mins) => ({ date: new Date(Date.UTC(2026, 7, d)), totalMinutes: mins, outTime: new Date(Date.UTC(2026, 7, d, 12)), status: 'approved' });
const MONTH = new Date('2026-08-01T00:00:00.000Z');
const MULT = { dailyMultiplier: 1.5, sundayMultiplier: 2.0, holidayMultiplier: 2.0 };
const run = (att, holidaySet = new Set(), e = emp()) => _computeSalary(e, att, 31, MONTH, [], MULT, holidaySet);

// --- Unit cases ---------------------------------------------------------
// Weekday over standard → daily OT, no short. (Mon 3 Aug 2026, 9h30m)
eq('weekday +30m -> daily OT 30, short 0', JSON.stringify([run([day(3, hm(9,30))]).dailyOtMinutes, run([day(3, hm(9,30))]).shortMinutes]), JSON.stringify([30, 0]));
// Weekday under standard → short, no OT. (Mon 3 Aug, 8h40m)
eq('weekday -20m -> daily OT 0, short 20', JSON.stringify([run([day(3, hm(8,40))]).dailyOtMinutes, run([day(3, hm(8,40))]).shortMinutes]), JSON.stringify([0, 20]));
// Sunday → all minutes are Sunday OT, never short. (Sun 9 Aug, 6h)
{ const c = run([day(9, hm(6,0))]); eq('sunday 6h -> sundayOT 360, short 0', `${c.sundayOtMinutes}/${c.shortMinutes}`, '360/0'); }
// Holiday → all minutes are Holiday OT, never short. (15 Aug holiday, 5h)
{ const c = run([day(15, hm(5,0))], new Set(['2026-08-15'])); eq('holiday 5h -> holidayOT 300, short 0', `${c.holidayOtMinutes}/${c.shortMinutes}`, '300/0'); }
// Short is tracked even when daily OT is disabled for the employee.
{ const c = run([day(3, hm(8,40))], new Set(), emp({ dailyOtEnabled: false })); eq('dailyOT off -> OT 0 but short 20', `${c.dailyOtMinutes}/${c.shortMinutes}`, '0/20'); }

// --- Full August 2026 scenario (per the operator's spec) ----------------
const duty = {
  1: hm(9,1), 4: hm(8,54), 5: hm(9,14), 6: hm(9,11), 7: hm(9,13), 8: hm(8,55),
  9: hm(7,7),              // Sunday
  10: hm(9,9), 11: hm(3,50), 13: hm(9,9), 14: hm(8,52),
  15: hm(7,15),            // holiday (Independence Day)
  16: hm(6,32),            // Sunday
  17: hm(8,57), 18: hm(8,51), 19: hm(8,45), 20: hm(8,45), 21: hm(8,57), 22: hm(8,39),
  24: hm(8,55), 25: hm(8,54), 26: hm(8,41), 27: hm(7,20), 29: hm(8,40), 31: hm(8,58),
};
const att = Object.entries(duty).map(([d, m]) => day(Number(d), m));
const c = run(att, new Set(['2026-08-15']));

eq('Aug Daily OT   = 0h57m (57)',   c.dailyOtMinutes,   57);
eq('Aug Sunday OT  = 13h39m (819)', c.sundayOtMinutes,  hm(13,39));
eq('Aug Holiday OT = 7h15m (435)',  c.holidayOtMinutes, hm(7,15));
eq('Aug Gross OT   = 21h51m (1311)',c.grossOtMinutes,   hm(21,51));
// Short = sum of each weekday's shortfall below 9h (the operator's per-day table).
eq('Aug Short Hrs  = 9h07m (547)',  c.shortMinutes,     hm(9,7));
eq('Aug Net Bal    = 12h44m (764)', c.netBalanceMinutes, hm(12,44));

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
