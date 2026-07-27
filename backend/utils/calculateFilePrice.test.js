// Standalone test for calculateFilePrice claim-type filtering.
// Run: node backend/utils/calculateFilePrice.test.js
const calculateFilePrice = require('./calculateFilePrice');

// Mirrors AARUSHI ORTHOPEDIC HOSPITAL's real config (claim #4624):
// three per-claim services intended for different claim types.
const services = [
  { serviceName: 'EMPANELMENT TIE-UP', isActive: true, billingType: 'fixed_onetime', calculationBasis: 'none', claimTypes: [] },
  { serviceName: 'TPA DESK SERVICE - CASHLESS', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'hospital_final_bill', slabMode: 'both', slabIncrementRange: 50000, slabIncrementPrice: 500, claimTypes: ['cashless', 'cashless_anywhere'], slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 1500 }, { rangeStart: 50001, rangeEnd: 100000, price: 2000 }] },
  { serviceName: 'TPA DESK SERVICE - REIMBURSEMENT', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'hospital_final_bill', slabMode: 'both', slabIncrementRange: 50000, slabIncrementPrice: 500, claimTypes: ['reimbursement'], slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 2000 }, { rangeStart: 50001, rangeEnd: 100000, price: 2500 }] },
  { serviceName: 'TPA DESK SERVICE - GRIEVANCE', isActive: true, billingType: 'percentage', calculationBasis: 'hospital_final_bill', percentageRate: 10, claimTypes: ['grievance'] },
];
const BILL = 64719;
const APPROVAL = 57528;

let failures = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '�’ FAIL'}  ${name}: got ${got}, want ${want}`);
};

// The reported bug: a Cashless claim must only pay the CASHLESS slab.
eq('cashless -> 2000',            calculateFilePrice(services, BILL, APPROVAL, 'cashless'), 2000);
eq('cashless_anywhere -> 2000',  calculateFilePrice(services, BILL, APPROVAL, 'cashless_anywhere'), 2000);
eq('reimbursement -> 2500',      calculateFilePrice(services, BILL, APPROVAL, 'reimbursement'), 2500);
eq('grievance -> 6472 (10%)',    calculateFilePrice(services, BILL, APPROVAL, 'grievance'), 6472);
// A universal service (empty claimTypes) applies to every claim type.
eq('universal svc applies to cashless', calculateFilePrice(
  [{ serviceName: 'X', isActive: true, billingType: 'percentage', calculationBasis: 'hospital_final_bill', percentageRate: 5, claimTypes: [] }],
  BILL, APPROVAL, 'cashless'), 3236);
// Backward compatible: no claimType passed -> sum everything (old behavior).
eq('no claimType -> sum all (10972)', calculateFilePrice(services, BILL, APPROVAL), 10972);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
