// Standalone test for the FCC backup filing-tree path composition.
// Run: node backend/utils/fccBackupPath.test.js
const p = require('./fccBackupPath');

let failures = 0;
const eq = (name, got, want) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? '✔' : '✘ FAIL'}  ${name}\n     got:  ${got}\n     want: ${want}`);
};

// ── groupForClaimType ────────────────────────────────────────────────────────
eq('cashless -> Cashless Claim', p.groupForClaimType('cashless'), 'Cashless Claim');
eq('cashless_anywhere -> Cashless Claim', p.groupForClaimType('cashless_anywhere'), 'Cashless Claim');
eq('reimbursement -> Reimbursement Claim', p.groupForClaimType('reimbursement'), 'Reimbursement Claim');
eq('grievance -> Reimbursement Claim', p.groupForClaimType('grievance'), 'Reimbursement Claim');
eq('unknown -> Reimbursement Claim', p.groupForClaimType('weird'), 'Reimbursement Claim');

// ── payerNameForClaim (TPA vs insurer priority) ──────────────────────────────
eq('cashless prefers TPA',
  p.payerNameForClaim({ claimType: 'cashless', tpa: { name: 'MediAssist' }, insuranceCompany: { name: 'Star Health' } }),
  'MediAssist');
eq('cashless falls back to insurer',
  p.payerNameForClaim({ claimType: 'cashless', tpa: null, insuranceCompany: { name: 'Star Health' } }),
  'Star Health');
eq('reimbursement prefers insurer',
  p.payerNameForClaim({ claimType: 'reimbursement', tpa: { name: 'MediAssist' }, insuranceCompany: { name: 'Star Health' } }),
  'Star Health');
eq('reimbursement falls back to TPA',
  p.payerNameForClaim({ claimType: 'reimbursement', tpa: { name: 'MediAssist' }, insuranceCompany: null }),
  'MediAssist');
eq('no payer -> null',
  p.payerNameForClaim({ claimType: 'cashless', tpa: null, insuranceCompany: null }),
  null);

// ── subfolderForCategory ─────────────────────────────────────────────────────
eq('cashless admission -> Direct Admit DOC', p.subfolderForCategory('cashless', 'admission'), 'Direct Admit DOC');
eq('cashless discharge -> Discharge Folder', p.subfolderForCategory('cashless', 'discharge'), 'Discharge Folder');
eq('cashless pod -> Discharge Folder', p.subfolderForCategory('cashless', 'pod'), 'Discharge Folder');
eq('cashless settlement -> Discharge Folder', p.subfolderForCategory('cashless', 'settlement_proof'), 'Discharge Folder');
eq('cashless other -> Discharge Folder', p.subfolderForCategory('cashless', 'other'), 'Discharge Folder');
eq('cashless missing category -> Discharge Folder', p.subfolderForCategory('cashless', null), 'Discharge Folder');
eq('reimbursement admission -> no subfolder', p.subfolderForCategory('reimbursement', 'admission'), '');
eq('grievance discharge -> no subfolder', p.subfolderForCategory('grievance', 'discharge'), '');

// ── sanitizeSegment ──────────────────────────────────────────────────────────
eq('strips slashes', p.sanitizeSegment('A/B\\C'), 'A B C');
eq('strips colon/star/qmark', p.sanitizeSegment('Star: Health*?'), 'Star Health');
eq('collapses whitespace', p.sanitizeSegment('  John   Doe  '), 'John Doe');
eq('trims trailing dot', p.sanitizeSegment('Hospital.'), 'Hospital');
eq('empty -> fallback', p.sanitizeSegment('', 'Unknown Patient'), 'Unknown Patient');
eq('null -> fallback', p.sanitizeSegment(null, 'Unknown Hospital'), 'Unknown Hospital');
eq('keeps internal dots (filenames)', p.sanitizeSegment('discharge.summary.pdf', 'file'), 'discharge.summary.pdf');

// ── documentFolderPath (full tree) ───────────────────────────────────────────
const cashlessClaim = {
  claimType: 'cashless',
  patientName: 'Ramesh Patel',
  hospital: { name: 'Sunshine Hospital' },
  tpa: { name: 'MediAssist' },
  insuranceCompany: { name: 'Star Health' },
};
eq('cashless admission full path',
  p.documentFolderPath(cashlessClaim, 'admission'),
  'First Care Consultancy/Hospital TPA Desk/Cashless Claim/Sunshine Hospital/Ramesh Patel - MediAssist/Direct Admit DOC');
eq('cashless discharge full path',
  p.documentFolderPath(cashlessClaim, 'settlement_proof'),
  'First Care Consultancy/Hospital TPA Desk/Cashless Claim/Sunshine Hospital/Ramesh Patel - MediAssist/Discharge Folder');

const reimbClaim = {
  claimType: 'reimbursement',
  patientName: 'Sita Shah',
  hospital: { name: 'City Care' },
  tpa: null,
  insuranceCompany: { name: 'HDFC Ergo' },
};
eq('reimbursement full path (no subfolder)',
  p.documentFolderPath(reimbClaim, 'discharge'),
  'First Care Consultancy/Hospital TPA Desk/Reimbursement Claim/City Care/Sita Shah - HDFC Ergo');

const directPatientClaim = {
  claimType: 'grievance',
  patientName: 'Anon',
  isDirectPatient: true,
  hospital: null,
  tpa: { name: 'Vidal' },
  insuranceCompany: null,
};
eq('direct patient with no hospital',
  p.documentFolderPath(directPatientClaim, 'other'),
  'First Care Consultancy/Hospital TPA Desk/Reimbursement Claim/Direct Patient/Anon - Vidal');

console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
process.exit(failures === 0 ? 0 : 1);
