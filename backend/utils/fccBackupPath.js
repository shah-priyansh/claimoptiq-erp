// Composes the First Care Consultancy filing-tree path for a claim's documents,
// used by the "settled claims backup" ZIP download (claimController.downloadSettledBackup).
//
// The tree (from the operations team's manual filing convention):
//
//   First Care Consultancy/
//   └── Hospital TPA Desk/
//       ├── Cashless Claim/                 <- cashless + cashless_anywhere
//       │   └── [Hospital]/
//       │       └── [Patient] - [TPA]/      <- TPA name, else insurance company
//       │           ├── Direct Admit DOC/   <- category: admission
//       │           └── Discharge Folder/   <- everything else
//       └── Reimbursement Claim/            <- reimbursement + grievance
//           └── [Hospital]/
//               └── [Patient] - [Insurer]/  <- insurance company, else TPA
//                   └── (all docs, no subfolders)
//
// Pure + I/O-free so it can be unit-tested in isolation (fccBackupPath.test.js).

const ROOT = ['First Care Consultancy', 'Hospital TPA Desk'];
const GROUP_CASHLESS = 'Cashless Claim';
const GROUP_REIMBURSEMENT = 'Reimbursement Claim';
const CASHLESS_TYPES = new Set(['cashless', 'cashless_anywhere']);

// Strip characters illegal in Windows/macOS/Linux paths and inside a ZIP, so a
// patient/hospital name never breaks the folder structure. Collapses runs of
// whitespace, trims trailing dots/spaces (Windows rejects them), and caps length.
const sanitizeSegment = (value, fallback = 'Unknown') => {
  let s = String(value == null ? '' : value)
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, ' ') // path/zip-illegal chars -> space
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '') // no trailing dot/space (Windows)
    .trim();
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s || fallback;
};

// cashless / cashless_anywhere -> "Cashless Claim"; everything else
// (reimbursement, grievance, unknown) -> "Reimbursement Claim".
const groupForClaimType = (claimType) =>
  (CASHLESS_TYPES.has(String(claimType || '').toLowerCase())
    ? GROUP_CASHLESS
    : GROUP_REIMBURSEMENT);

// The payer whose name goes after the dash in the patient folder. Cashless files
// are keyed by TPA (falling back to insurer); reimbursement by insurer (falling
// back to TPA) — matching how the ops team files them.
const payerNameForClaim = (claim) => {
  const tpa = claim.tpa && claim.tpa.name;
  const insurer = claim.insuranceCompany && claim.insuranceCompany.name;
  const isCashless = groupForClaimType(claim.claimType) === GROUP_CASHLESS;
  return (isCashless ? (tpa || insurer) : (insurer || tpa)) || null;
};

const hospitalSegment = (claim) =>
  sanitizeSegment(
    claim.hospital && claim.hospital.name,
    claim.isDirectPatient ? 'Direct Patient' : 'Unknown Hospital',
  );

// "[Patient] - [Payer]" folder name (each part sanitized independently).
const patientPayerSegment = (claim) => {
  const patient = sanitizeSegment(claim.patientName, 'Unknown Patient');
  const payer = sanitizeSegment(payerNameForClaim(claim), 'Unknown Payer');
  return `${patient} - ${payer}`;
};

// The subfolder a document sits in under the patient folder. Only cashless
// claims split into Direct Admit DOC vs Discharge Folder; reimbursement keeps
// everything together ('' = no subfolder).
const subfolderForCategory = (claimType, category) => {
  if (groupForClaimType(claimType) !== GROUP_CASHLESS) return '';
  return String(category || '').toLowerCase() === 'admission'
    ? 'Direct Admit DOC'
    : 'Discharge Folder';
};

// Full POSIX folder path (no filename) for a document of `category` on `claim`.
const documentFolderPath = (claim, category) => {
  const segs = [
    ...ROOT,
    groupForClaimType(claim.claimType),
    hospitalSegment(claim),
    patientPayerSegment(claim),
  ];
  const sub = subfolderForCategory(claim.claimType, category);
  if (sub) segs.push(sub);
  return segs.join('/');
};

module.exports = {
  ROOT,
  GROUP_CASHLESS,
  GROUP_REIMBURSEMENT,
  sanitizeSegment,
  groupForClaimType,
  payerNameForClaim,
  hospitalSegment,
  patientPayerSegment,
  subfolderForCategory,
  documentFolderPath,
};
