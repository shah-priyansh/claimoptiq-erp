// Standalone test for the hospital rate-version resolver.
// Run: node backend/utils/rateVersions.test.js
const { monthKeyNum, resolveRateVersion, resolveClaimFilePrice } = require('./rateVersions');

let failures = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ FAIL'}  ${name}: got ${got}, want ${want}`);
};
const eqJson = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

// --- month-key equivalence across storage conventions -------------------
// UTC-first-of-month and IST-local-first-of-month of the same intended
// month (Nov 2026) must resolve to the same key. This is the off-by-one
// guard for bulk-imported claims whose `month` is stored as IST-local
// midnight (prior day ~18:30 UTC).
eq('UTC Nov == IST-local Nov',
  monthKeyNum(new Date('2026-11-01T00:00:00Z')),
  monthKeyNum(new Date(2026, 10, 1)));

// --- resolveRateVersion: latest dated version <= claim month wins -------
const svcBase = [{ serviceName: 'BASE', isActive: true, billingType: 'percentage', calculationBasis: 'hospital_final_bill', percentageRate: 5, claimTypes: [] }];
const svcNov = [{ serviceName: 'NOV', isActive: true, billingType: 'percentage', calculationBasis: 'hospital_final_bill', percentageRate: 10, claimTypes: [] }];
const V = [
  { effectiveFromMonth: null, billingServices: svcBase },
  { effectiveFromMonth: new Date('2026-11-01T00:00:00Z'), billingServices: svcNov },
];

eqJson('Oct claim -> base', resolveRateVersion(V, new Date('2026-10-01T00:00:00Z')), svcBase);
eqJson('Nov claim -> v1', resolveRateVersion(V, new Date('2026-11-01T00:00:00Z')), svcNov);
// off-by-one guard: import-style IST-local Date construction must still pick Nov
eqJson('import Nov -> v1', resolveRateVersion(V, new Date(2026, 10, 1)), svcNov);
eqJson('Dec claim -> v1', resolveRateVersion(V, new Date('2026-12-01T00:00:00Z')), svcNov);

// --- base-only hospital (no dated versions) ------------------------------
eqJson('no dated -> base',
  resolveRateVersion([{ effectiveFromMonth: null, billingServices: svcBase }], new Date('2030-01-01T00:00:00Z')),
  svcBase);

// --- empty / null-hospital ------------------------------------------------
eqJson('no versions -> []', resolveRateVersion([], new Date('2026-11-01T00:00:00Z')), []);

// --- claimMonth null/undefined -> base's billingServices or [] ----------
eqJson('null claimMonth -> base', resolveRateVersion(V, null), svcBase);
eqJson('undefined claimMonth, no base -> []', resolveRateVersion([{ effectiveFromMonth: new Date('2026-11-01T00:00:00Z'), billingServices: svcNov }], undefined), []);

// --- resolveClaimFilePrice: override wins --------------------------------
eq('override wins', resolveClaimFilePrice(
  { filePriceOverridden: true, filePrice: 999, hospitalId: 'h', month: new Date('2026-11-01T00:00:00Z') },
  { h: V }), 999);

// --- resolveClaimFilePrice: null hospital -> 0 (no services), no throw --
eq('null hospital -> 0', resolveClaimFilePrice(
  { hospitalId: null, month: new Date('2026-11-01T00:00:00Z'), hospitalFinalBill: 50000, claimType: 'cashless' },
  {}), 0);

// --- resolveClaimFilePrice: picks version then calculateFilePrice -------
// Reuse a slab service across base/Nov versions and assert the number flows
// through calculateFilePrice for the version in effect for the claim month.
const slabBase = [{ serviceName: 'TPA DESK', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'hospital_final_bill', slabMode: 'slab_wise', claimTypes: [],
  slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 1500 }, { rangeStart: 50001, rangeEnd: 100000, price: 2000 }] }];
const slabNov = [{ serviceName: 'TPA DESK', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'hospital_final_bill', slabMode: 'slab_wise', claimTypes: [],
  slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 1800 }, { rangeStart: 50001, rangeEnd: 100000, price: 2500 }] }];
const Vslab = [
  { effectiveFromMonth: null, billingServices: slabBase },
  { effectiveFromMonth: new Date('2026-11-01T00:00:00Z'), billingServices: slabNov },
];
eq('Oct claim, hospitalFinalBill 64719 -> base slab 2000', resolveClaimFilePrice(
  { hospitalId: 'h2', month: new Date('2026-10-01T00:00:00Z'), hospitalFinalBill: 64719, claimType: 'cashless' },
  { h2: Vslab }), 2000);
eq('Nov claim, hospitalFinalBill 64719 -> Nov slab 2500', resolveClaimFilePrice(
  { hospitalId: 'h2', month: new Date('2026-11-01T00:00:00Z'), hospitalFinalBill: 64719, claimType: 'cashless' },
  { h2: Vslab }), 2500);
// filePriceOverridden true but filePrice falsy -> override does NOT win, falls through to calc
eq('overridden flag but no filePrice -> falls through to calc', resolveClaimFilePrice(
  { filePriceOverridden: true, filePrice: 0, hospitalId: 'h2', month: new Date('2026-10-01T00:00:00Z'), hospitalFinalBill: 64719, claimType: 'cashless' },
  { h2: Vslab }), 2000);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
