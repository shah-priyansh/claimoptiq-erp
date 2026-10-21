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
eq('grievance -> 6471.9 (10%)',  calculateFilePrice(services, BILL, APPROVAL, 'grievance'), 6471.9);
// A universal service (empty claimTypes) applies to every claim type.
eq('universal svc applies to cashless', calculateFilePrice(
  [{ serviceName: 'X', isActive: true, billingType: 'percentage', calculationBasis: 'hospital_final_bill', percentageRate: 5, claimTypes: [] }],
  BILL, APPROVAL, 'cashless'), 3235.95);
// Backward compatible: no claimType passed -> sum everything (old behavior).
eq('no claimType -> sum all (10971.9)', calculateFilePrice(services, BILL, APPROVAL), 10971.9);

// New calc basis: settlement_amount drives the slab/percentage off the 5th arg
// (gross settlement filed BEFORE TDS).
const SETTLEMENT = 72000;
eq('settlement_amount -> slab 2000', calculateFilePrice(
  [{ serviceName: 'S', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'settlement_amount', slabMode: 'slab_wise', claimTypes: [],
     slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 1500 }, { rangeStart: 50001, rangeEnd: 100000, price: 2000 }] }],
  BILL, APPROVAL, 'cashless', SETTLEMENT), 2000);
eq('settlement_amount -> 10% = 7200', calculateFilePrice(
  [{ serviceName: 'S', isActive: true, billingType: 'percentage', calculationBasis: 'settlement_amount', percentageRate: 10, claimTypes: [] }],
  BILL, APPROVAL, 'cashless', SETTLEMENT), 7200);
// A 0 settlement is skipped (no auto slab match), matching the other bases.
eq('settlement_amount 0 -> 0', calculateFilePrice(
  [{ serviceName: 'S', isActive: true, billingType: 'per_claim_slab', calculationBasis: 'settlement_amount', claimTypes: [],
     slabs: [{ rangeStart: 0, rangeEnd: 50000, price: 1500 }] }],
  BILL, APPROVAL, 'cashless', 0), 0);
// Existing bases unaffected by the new 5th arg.
eq('final_approval still 5752.8', calculateFilePrice(
  [{ serviceName: 'F', isActive: true, billingType: 'percentage', calculationBasis: 'final_approval', percentageRate: 10, claimTypes: [] }],
  BILL, APPROVAL, 'cashless', SETTLEMENT), 5752.8);

console.log(failures ? `\n${failures} test(s) failed` : '\nAll tests passed');
process.exit(failures ? 1 : 0);
