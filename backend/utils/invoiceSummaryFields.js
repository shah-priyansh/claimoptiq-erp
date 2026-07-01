// Single source of truth for the columns the Claims Summary table (page 2 of
// the invoice PDF) can render. Each entry pairs a key with how to read it
// from a Claim row + how to lay it out on the PDF. Frontend has a mirror of
// the keys/labels/groups for the column-picker modal.

const fmtDate = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-');
};

const _monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtMonth = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return `${_monthAbbr[dt.getUTCMonth()]}/${dt.getUTCFullYear()}`;
};

const FIELDS = [
  // Patient
  { key: 'patientName',  label: 'Patient',          group: 'Patient', flex: 2.0, align: 'left',  get: (c) => c.patientName || '-' },
  { key: 'doctorName',   label: 'Doctor',           group: 'Patient', flex: 1.6, align: 'left',  get: (c) => c.doctorName || '-' },
  { key: 'patientMobile',label: 'Mobile',           group: 'Patient', flex: 1.2, align: 'left',  get: (c) => c.patientMobile || '-' },
  { key: 'claimType',    label: 'Claim Type',       group: 'Patient', flex: 1.1, align: 'left',  get: (c) => c.claimType || '-' },
  { key: 'policyNo',     label: 'Policy No',        group: 'Patient', flex: 1.2, align: 'left',  get: (c) => c.policyNo || '-' },
  { key: 'clientId',     label: 'Client ID',        group: 'Patient', flex: 1.1, align: 'left',  get: (c) => c.clientId || '-' },
  { key: 'directPatient',label: 'Direct',           group: 'Patient', flex: 0.7, align: 'center',get: (c) => c.isDirectPatient ? 'Yes' : 'No' },

  // Hospital
  { key: 'hospital',     label: 'Hospital',         group: 'Hospital', flex: 2.0, align: 'left', get: (c) => c.hospital?.name || (c.isDirectPatient ? 'Direct' : '-') },

  // Payor
  { key: 'insuranceCompany', label: 'Insurance', group: 'Payor', flex: 1.6, align: 'left', get: (c) => c.insuranceCompany?.name || '-' },
  { key: 'tpa',              label: 'TPA',       group: 'Payor', flex: 1.4, align: 'left', get: (c) => c.tpa?.name || '-' },
  { key: 'ccnNo',            label: 'CCN No.',   group: 'Payor', flex: 1.1, align: 'left', get: (c) => c.ccnNo || '-' },

  // Treatment
  { key: 'treatmentType',label: 'Treatment',        group: 'Treatment', flex: 1.2, align: 'left', get: (c) => c.treatmentType || '-' },
  { key: 'diagnosis',    label: 'Diagnosis',        group: 'Treatment', flex: 1.6, align: 'left', get: (c) => c.diagnosis || '-' },
  { key: 'surgeryName',  label: 'Surgery',          group: 'Treatment', flex: 1.4, align: 'left', get: (c) => c.surgeryName || '-' },

  // Dates
  { key: 'month',             label: 'Month',          group: 'Dates', flex: 0.9, align: 'center', get: (c) => fmtMonth(c.month) },
  { key: 'dateOfAdmit',       label: 'D.O.A.',         group: 'Dates', flex: 0.9, align: 'center', get: (c) => fmtDate(c.dateOfAdmit) },
  { key: 'dateOfDischarge',   label: 'D.O.D.',         group: 'Dates', flex: 0.9, align: 'center', get: (c) => fmtDate(c.dateOfDischarge) },
  { key: 'finalApprovalDate', label: 'Approval Date',  group: 'Dates', flex: 1.0, align: 'center', get: (c) => fmtDate(c.finalApprovalDate) },
  { key: 'fileReceivedDate',  label: 'File Received',  group: 'Dates', flex: 1.0, align: 'center', get: (c) => fmtDate(c.fileReceivedDate) },
  { key: 'settlementDate',    label: 'Settlement Date',group: 'Dates', flex: 1.0, align: 'center', get: (c) => fmtDate(c.settlementDate) },

  // Submission
  { key: 'submitMode',        label: 'Submit Mode',    group: 'Submission', flex: 1.0, align: 'left',   get: (c) => c.submitMode || '-' },
  { key: 'courierSubmitDate', label: 'Courier Date',   group: 'Submission', flex: 0.9, align: 'center', get: (c) => fmtDate(c.courierSubmitDate) },
  { key: 'onlineSubmitDate',  label: 'Online Date',    group: 'Submission', flex: 0.9, align: 'center', get: (c) => fmtDate(c.onlineSubmitDate) },
  { key: 'courierCompanyName',label: 'Courier Company',group: 'Submission', flex: 1.2, align: 'left',   get: (c) => c.courierCompanyName || '-' },
  { key: 'podNumber',         label: 'POD No.',        group: 'Submission', flex: 1.0, align: 'left',   get: (c) => c.podNumber || '-' },

  // Financials
  { key: 'hospitalFinalBill',         label: 'Hospital Bill',    group: 'Financials', flex: 1.2, align: 'right', isAmount: true, get: (c) => Number(c.hospitalFinalBill) || 0 },
  { key: 'mouDiscount',               label: 'MOU Discount',     group: 'Financials', flex: 1.1, align: 'right', isAmount: true, get: (c) => Number(c.mouDiscount) || 0 },
  { key: 'deduction',                 label: 'Deduction',        group: 'Financials', flex: 1.0, align: 'right', isAmount: true, get: (c) => Number(c.deduction) || 0 },
  { key: 'finalApprovalAmount',       label: 'Final Approval',   group: 'Financials', flex: 1.2, align: 'right', isAmount: true, get: (c) => Number(c.finalApprovalAmount) || 0 },
  { key: 'settlementAmount',          label: 'Settlement Amount',group: 'Financials', flex: 1.2, align: 'right', isAmount: true, get: (c) => Number(c.settlementAmount) || 0 },
  { key: 'settlementAmountDeduction', label: 'Settle Deduction', group: 'Financials', flex: 1.1, align: 'right', isAmount: true, get: (c) => Number(c.settlementAmountDeduction) || 0 },
  { key: 'mouDiscountOnSettlement',   label: 'MOU Disc on Settle',group: 'Financials',flex: 1.2, align: 'right', isAmount: true, get: (c) => Number(c.mouDiscountOnSettlement) || 0 },
  { key: 'tds',                       label: 'TDS',              group: 'Financials', flex: 0.9, align: 'right', isAmount: true, get: (c) => Number(c.tds) || 0 },
  { key: 'bankTransferAmount',        label: 'Bank Transfer',    group: 'Financials', flex: 1.2, align: 'right', isAmount: true, get: (c) => Number(c.bankTransferAmount) || 0 },
  // tpaFee comes from the invoice line, not the claim — handled by the renderer.
  // Shown to the user as "File Price" — the per-claim TPA Desk amount.
  { key: 'tpaFee',                    label: 'File Price',       group: 'Financials', flex: 1.2, align: 'right', isAmount: true, get: null },

  // Other
  { key: 'neftNo',         label: 'NEFT No.',       group: 'Other', flex: 1.0, align: 'left', get: (c) => c.neftNo || '-' },
  { key: 'remarks',        label: 'Remarks',        group: 'Other', flex: 1.6, align: 'left', get: (c) => c.remarks || '-' },
  { key: 'rejectedReason', label: 'Rejected Reason',group: 'Other', flex: 1.4, align: 'left', get: (c) => c.rejectedReason || '-' },
  { key: 'status',         label: 'Status',         group: 'Other', flex: 0.9, align: 'left', get: (c) => (c.status || '').replace(/_/g, ' ') },
];

const DEFAULT_KEYS = [
  'patientName',
  'doctorName',
  'insuranceCompany',
  'ccnNo',
  'tpa',
  'dateOfDischarge',
  'finalApprovalDate',
  'tpaFee',
];

const GROUPS = ['Patient', 'Hospital', 'Payor', 'Treatment', 'Dates', 'Submission', 'Financials', 'Other'];

const parseSelected = (raw) => {
  if (!raw) return DEFAULT_KEYS.slice();
  const arr = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  return arr.length ? arr : DEFAULT_KEYS.slice();
};

const resolveColumns = (selectedKeys) => {
  const set = new Set(selectedKeys);
  return FIELDS.filter((f) => set.has(f.key));
};

module.exports = { FIELDS, GROUPS, DEFAULT_KEYS, parseSelected, resolveColumns };
