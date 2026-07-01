import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx-js-style';
import {
  HiOutlineX, HiOutlineDownload, HiOutlineUpload, HiOutlineDocumentText,
  HiOutlineCheckCircle, HiOutlineInformationCircle,
} from 'react-icons/hi';
import {
  importClaimsAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI, getClaimStatusesAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// ── Column definitions for the template ────────────────────────────────────
// Order matters: this is the column order in the downloaded xlsx.
const COLUMNS = [
  { key: 'srNo',                label: 'SR No',                         width: 8,  note: 'Optional — uses this exact number as the claim # in the database. Gaps from failed rows are preserved.' },
  { key: 'patientName',         label: 'Patient Name *',                width: 22, required: true },
  { key: 'patientMobile',       label: 'Patient Mobile',                width: 14 },
  { key: 'hospital',            label: 'Hospital Name *',               width: 24, note: 'Must match exactly (see Hospitals sheet). Leave blank if "Is Direct Patient" = Yes.' },
  { key: 'referenceBy',         label: 'Reference By',                  width: 18, note: 'Optional — must match the hospital\'s reference (see Hospitals sheet)', superAdminOnly: true },
  { key: 'isDirectPatient',     label: 'Is Direct Patient (Yes/No)',    width: 12 },
  { key: 'doctorName',          label: 'Doctor Name',                   width: 18 },
  { key: 'claimType',           label: 'Claim Type *',                  width: 14, note: 'cashless / cashless anywhere / reimbursement / grievance', required: true },
  { key: 'insuranceCompany',    label: 'Insurance Company',             width: 24, note: 'Must match exactly (see Insurance sheet)' },
  { key: 'tpa',                 label: 'TPA',                           width: 24, note: 'Must match exactly (see TPA sheet)' },
  { key: 'policyNo',            label: 'Policy No',                     width: 16 },
  { key: 'clientId',            label: 'Client ID',                     width: 14 },
  { key: 'ccnNo',               label: 'CCN No',                        width: 14 },
  { key: 'dateOfAdmit',         label: 'Date of Admit *',               width: 14, note: 'YYYY-MM-DD or DD/MM/YYYY', required: true },
  { key: 'dateOfDischarge',     label: 'Date of Discharge',             width: 14, note: 'YYYY-MM-DD or DD/MM/YYYY' },
  { key: 'month',               label: 'Month',                         width: 12, note: 'Defaults to Date of Admit if blank' },
  { key: 'status',              label: 'Status',                        width: 14, note: 'Status slug (see Statuses sheet). Defaults to admitted.' },
  { key: 'hospitalFinalBill',   label: 'Hospital Final Bill',           width: 16 },
  { key: 'mouDiscount',         label: 'MOU Discount',                  width: 14 },
  { key: 'deduction',           label: 'Deduction',                     width: 14 },
  { key: 'finalApprovalAmount', label: 'Final Approval Amount',         width: 18 },
  { key: 'finalApprovalDate',   label: 'Final Approval Date',           width: 16 },
  { key: 'fileReceivedDate',    label: 'File Received Date',            width: 16 },
  { key: 'submitMode',          label: 'Submit Mode',                   width: 12, note: 'courier / online (or blank)' },
  { key: 'courierSubmitDate',   label: 'Courier Submit Date',           width: 16 },
  { key: 'onlineSubmitDate',    label: 'Online Submit Date',            width: 16 },
  { key: 'courierCompanyName',  label: 'Courier Company Name',          width: 18 },
  { key: 'podNumber',           label: 'POD Number',                    width: 14 },
  { key: 'settlementAmount',    label: 'Settlement Amount',             width: 16 },
  { key: 'settlementAmountDeduction', label: 'Settlement Deduction',    width: 16 },
  { key: 'mouDiscountOnSettlement', label: 'MOU Discount on Settlement', width: 18 },
  { key: 'tds',                 label: 'TDS',                           width: 10 },
  { key: 'bankTransferAmount',  label: 'Bank Transfer Amount',          width: 16 },
  { key: 'settlementDate',      label: 'Settlement Date',               width: 14 },
  { key: 'neftNo',              label: 'NEFT No',                       width: 14 },
  { key: 'treatmentType',       label: 'Treatment Type',                width: 16 },
  { key: 'diagnosis',           label: 'Diagnosis',                     width: 22 },
  { key: 'surgeryName',         label: 'Surgery Name',                  width: 20 },
  { key: 'remarks',             label: 'Remarks',                       width: 24 },
  { key: 'rejectedReason',      label: 'Rejected Reason',               width: 22 },
  { key: 'filePrice',           label: 'File Price',                    width: 14, note: 'Optional — overrides hospital\'s default billing for this claim', superAdminOnly: true },
];

// Persist the import result to localStorage so the user can return after
// closing the modal or refreshing the page and still download the failed rows.
const persistResult = (result, failedSourceRows, fileName) => {
  try {
    localStorage.setItem(
      'claimImportResult_v1',
      JSON.stringify({ result, failedSourceRows, fileName, savedAt: Date.now() }),
    );
  } catch { /* quota exceeded — silently drop */ }
};

// Strip trailing '*' / spaces from header → use to match xlsx columns to data keys
const labelToKey = (label) => {
  const cleaned = String(label || '').replace(/\*/g, '').trim().toLowerCase();
  const col = COLUMNS.find(c => c.label.replace(/\*/g, '').trim().toLowerCase() === cleaned);
  return col?.key || null;
};

// ── Shared parsing/matching helpers (mirror backend so preview is honest) ──
// "0" / "0.00" treated as blank — common Excel artefact where empty cells were filled with zeros.
const PLACEHOLDER_RE = /^(-+|—+|n\/a|na|null|none|n\.a\.?|0+(\.0+)?)$/i;
const cleanCell = (val) => {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  if (!s || PLACEHOLDER_RE.test(s)) return '';
  return s;
};
const norm = (s) => String(s || '').trim().toLowerCase();
const STOPWORDS = new Set(['ltd', 'limited', 'pvt', 'private', 'co', 'company', 'corp', 'corporation', 'inc', 'incorporated', 'the', 'and', 'of', '&']);
const canonical = (s) => {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[.,()/\-_'"]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .join(' ');
};
const MONTHS_MAP = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const parseDateLoose = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === 'number' && val > 25569) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  const s = cleanCell(val);
  if (!s) return null;
  if (/^\d{5,}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25569) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d;
    }
  }
  const mon = s.match(/^([A-Za-z]{3,9})[\/\-.\s](\d{2,4})$/);
  if (mon) {
    const idx = MONTHS_MAP[mon[1].slice(0, 3).toLowerCase()];
    if (idx !== undefined) {
      const yr = mon[2].length === 2 ? 2000 + Number(mon[2]) : Number(mon[2]);
      return new Date(yr, idx, 1);
    }
  }
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    let day = Number(a), month = Number(b);
    if (month > 12 && day <= 12) { [day, month] = [month, day]; }
    if (!day || !month || day > 31 || month > 12) return null;
    const d = new Date(Number(yy), month - 1, day);
    return isNaN(d.getTime()) || d.getMonth() !== month - 1 ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};
const buildLookup = (list) => {
  const exact = new Map(), canon = new Map(), canonCount = new Map();
  list.forEach(x => {
    exact.set(norm(x.name), x);
    const c = canonical(x.name);
    if (c) canonCount.set(c, (canonCount.get(c) || 0) + 1);
  });
  list.forEach(x => {
    const c = canonical(x.name);
    if (c && canonCount.get(c) === 1) canon.set(c, x);
  });
  return { find: (input) => exact.get(norm(input)) || canon.get(canonical(input)) || null };
};
const VALID_CLAIM_TYPES = ['cashless', 'cashless_anywhere', 'reimbursement', 'grievance'];

const ImportClaimsModal = ({ open, onClose, onImported }) => {
  const { user, roleSlug } = useAuth();
  const isHospitalUser = !!user?.hospital;
  const isSuperAdmin = roleSlug === 'super_admin';
  const fileInputRef = useRef(null);

  const [step, setStep] = useState('upload'); // upload | preview | result
  const [hospitals, setHospitals] = useState([]);
  const [insurers, setInsurers] = useState([]);
  const [tpas, setTpas] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [refLoading, setRefLoading] = useState(false);

  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  // Source row data for the rows that failed, keyed by source-file row number.
  // Persisted so the user can download the failed-rows xlsx after closing the
  // modal or refreshing the page.
  const [failedSourceRows, setFailedSourceRows] = useState({});
  const [previewLimit, setPreviewLimit] = useState(200);
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [autoCreateMasters, setAutoCreateMasters] = useState(false);
  // Bypasses the CCN + name/hospital/admit-date duplicate checks. Used when
  // re-importing the failed-rows export after fixing data.
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, batch: 0, batches: 0, imported: 0, failed: 0, etaSec: null });
  // `cancelRef` is the synchronous source of truth read inside the import loop.
  // `cancelling` mirrors it as React state so the UI can re-render the button
  // immediately (refs don't trigger re-renders).
  const cancelRef = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  // Holds the AbortController for the in-flight batch request, so the user
  // doesn't have to wait for the current batch to finish before cancel takes effect.
  const inFlightAbortRef = useRef(null);

  // Hydrate the last import result from localStorage on first mount, so the
  // failed rows survive modal close / page refresh until the user clears them.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('claimImportResult_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.result) {
        setResult(parsed.result);
        setFailedSourceRows(parsed.failedSourceRows || {});
        setFileName(parsed.fileName || '');
        setStep('result');
      }
    } catch { /* ignore — corrupt entry */ }
  }, []);

  useEffect(() => {
    if (!open) return;
    setRefLoading(true);
    Promise.all([
      isHospitalUser ? Promise.resolve({ data: [] }) : getHospitalsAPI({ all: 'true', active: 'true' }).catch(() => ({ data: [] })),
      getInsuranceAPI().catch(() => ({ data: [] })),
      getTPAAPI().catch(() => ({ data: [] })),
      getClaimStatusesAPI().catch(() => ({ data: [] })),
    ]).then(([h, i, t, s]) => {
      setHospitals(h.data || []);
      setInsurers((i.data || []).filter(x => x.isActive));
      setTpas((t.data || []).filter(x => x.isActive));
      setStatuses((s.data || []).filter(x => x.isActive));
    }).finally(() => setRefLoading(false));
  }, [open, isHospitalUser]);

  useEffect(() => {
    if (open) return;
    // Reset upload/preview state when the modal closes — but keep `result` and
    // `failedSourceRows` so the user can come back and download the failed rows.
    // If a result is currently shown, leave step on 'result' so reopening shows it.
    setRows([]); setPreviewLimit(200); setOnlyIssues(false); setAutoCreateMasters(false);
    if (!result) { setStep('upload'); setFileName(''); }
  }, [open, result]);

  // ── Pre-validate rows against loaded masters (mirrors backend logic) ──
  const validation = React.useMemo(() => {
    if (!rows.length) return { rowIssues: [], summary: { ok: 0, badRows: 0, byType: {} } };
    const hLookup = buildLookup(hospitals);
    const iLookup = buildLookup(insurers);
    const tLookup = buildLookup(tpas);
    const statusSet = new Set(statuses.map(s => s.slug));
    const summary = { ok: 0, badRows: 0, byType: {} };
    const bump = (k) => { summary.byType[k] = (summary.byType[k] || 0) + 1; };

    const seenSrNos = new Map();
    rows.forEach((r, idx) => {
      const raw = cleanCell(r.srNo);
      if (!raw) return;
      const n = Number(raw);
      if (Number.isInteger(n) && n > 0) {
        if (!seenSrNos.has(n)) seenSrNos.set(n, []);
        seenSrNos.get(n).push(idx);
      }
    });

    const rowIssues = rows.map((r, idx) => {
      const issues = [];
      const fuzzy  = [];
      const srRaw = cleanCell(r.srNo);
      if (srRaw) {
        const n = Number(srRaw);
        if (!Number.isInteger(n) || n <= 0) {
          issues.push({ type: 'srNo', label: `SR No invalid: "${r.srNo}" — must be a positive integer` });
          bump('srNo');
        } else if ((seenSrNos.get(n) || []).length > 1) {
          issues.push({ type: 'srNo', label: `SR No ${n} appears in multiple rows` });
          bump('srNo');
        }
      }
      if (!cleanCell(r.patientName)) { issues.push({ type: 'patient',    label: 'Patient name missing' }); bump('patient'); }
      if (!parseDateLoose(r.dateOfAdmit)) {
        issues.push({ type: 'date', label: `Date of Admit invalid${r.dateOfAdmit ? `: "${r.dateOfAdmit}"` : ''}` });
        bump('date');
      }
      const ct = norm(cleanCell(r.claimType)).replace(/\s+/g, '_');
      if (!ct) { issues.push({ type: 'type', label: 'Claim type missing' }); bump('type'); }
      else if (!VALID_CLAIM_TYPES.includes(ct)) { issues.push({ type: 'type', label: `Claim type invalid: "${r.claimType}"` }); bump('type'); }

      const direct = ['yes', 'true', '1', 'direct'].includes(cleanCell(r.isDirectPatient).toLowerCase());
      const hName = cleanCell(r.hospital);
      if (!isHospitalUser && !direct) {
        if (!hName) { issues.push({ type: 'hospital', label: 'Hospital missing' }); bump('hospital'); }
        else {
          const h = hLookup.find(hName);
          if (!h) { issues.push({ type: 'hospital', label: `Hospital not found: "${hName}"` }); bump('hospital'); }
          else if (norm(h.name) !== norm(hName)) fuzzy.push({ type: 'hospital', label: `Hospital auto-matched: "${hName}" → "${h.name}"` });
        }
      }
      const insName = cleanCell(r.insuranceCompany);
      if (insName) {
        const ins = iLookup.find(insName);
        if (!ins) { issues.push({ type: 'insurance', label: `Insurance not found: "${insName}"` }); bump('insurance'); }
        else if (norm(ins.name) !== norm(insName)) fuzzy.push({ type: 'insurance', label: `Insurance auto-matched: "${insName}" → "${ins.name}"` });
      }
      const tName = cleanCell(r.tpa);
      if (tName) {
        const tp = tLookup.find(tName);
        if (!tp) { issues.push({ type: 'tpa', label: `TPA not found: "${tName}"` }); bump('tpa'); }
        else if (norm(tp.name) !== norm(tName)) fuzzy.push({ type: 'tpa', label: `TPA auto-matched: "${tName}" → "${tp.name}"` });
      }
      const sName = norm(cleanCell(r.status));
      if (sName && !statusSet.has(sName)) { issues.push({ type: 'status', label: `Status invalid: "${r.status}"` }); bump('status'); }

      if (issues.length) summary.badRows += 1;
      else summary.ok += 1;
      return { issues, fuzzy };
    });
    return { rowIssues, summary };
  }, [rows, hospitals, insurers, tpas, statuses, isHospitalUser]);

  // ── Build & download the sample template ─────────────────────────────────
  const downloadTemplate = () => {
    const visibleCols = COLUMNS.filter(c => {
      if (isHospitalUser && (c.key === 'hospital' || c.key === 'isDirectPatient')) return false;
      if (c.superAdminOnly && !isSuperAdmin) return false;
      return true;
    });

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Claims (the actual import template) ─────────────────────
    const headerRow = visibleCols.map(c => c.label);
    const noteRow   = visibleCols.map(c => c.note || '');
    const exampleHospital = !isHospitalUser ? (hospitals[0]?.name || 'City Hospital') : '';
    const exampleInsurer  = insurers[0]?.name || 'Star Health Insurance';
    const exampleTpa      = tpas[0]?.name || 'MediAssist TPA';

    const exampleReference = !isHospitalUser ? (hospitals[0]?.referenceBy || '') : '';
    const sample1 = {
      srNo: 500,
      patientName: 'Rahul Sharma',
      patientMobile: '9876543210',
      hospital: exampleHospital,
      referenceBy: exampleReference,
      isDirectPatient: 'No',
      doctorName: 'Dr. Mehta',
      claimType: 'cashless',
      insuranceCompany: exampleInsurer,
      tpa: exampleTpa,
      policyNo: 'POL-2024-00123',
      clientId: 'CL-9988',
      ccnNo: 'CCN-44521',
      dateOfAdmit: '2025-03-12',
      dateOfDischarge: '2025-03-18',
      month: '2025-03-01',
      status: 'settled',
      hospitalFinalBill: 145000,
      mouDiscount: 5000,
      deduction: 2000,
      finalApprovalAmount: 138000,
      finalApprovalDate: '2025-03-20',
      fileReceivedDate: '2025-03-22',
      submitMode: 'online',
      courierSubmitDate: '',
      onlineSubmitDate: '2025-03-23',
      courierCompanyName: '',
      podNumber: '',
      settlementAmount: 138000,
      settlementAmountDeduction: 0,
      mouDiscountOnSettlement: 0,
      tds: 0,
      bankTransferAmount: 138000,
      settlementDate: '2025-04-05',
      neftNo: 'NEFT-7788991',
      treatmentType: 'Surgery',
      diagnosis: 'Acute Appendicitis',
      surgeryName: 'Appendectomy',
      remarks: 'Routine case',
      rejectedReason: '',
      filePrice: 1500,
    };
    const sample2 = {
      srNo: 501,
      patientName: 'Priya Patel',
      patientMobile: '9123456780',
      hospital: '',
      isDirectPatient: !isHospitalUser ? 'Yes' : '',
      doctorName: 'Dr. Shah',
      claimType: 'reimbursement',
      insuranceCompany: exampleInsurer,
      tpa: '',
      policyNo: 'POL-2024-00456',
      clientId: '',
      ccnNo: 'CCN-44522',
      dateOfAdmit: '2025-04-02',
      dateOfDischarge: '2025-04-05',
      month: '',
      status: 'admitted',
      hospitalFinalBill: 62000,
      finalApprovalAmount: 0,
      treatmentType: 'Medical',
      diagnosis: 'Viral Fever',
      remarks: 'Direct patient — no hospital',
    };

    const aoa = [headerRow, noteRow,
      visibleCols.map(c => sample1[c.key] ?? ''),
      visibleCols.map(c => sample2[c.key] ?? ''),
      // a couple of blank rows so users can type immediately
      ...Array.from({ length: 8 }, () => visibleCols.map(() => '')),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = visibleCols.map(c => ({ wch: c.width }));

    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    visibleCols.forEach((c, i) => {
      const headerRef = XLSX.utils.encode_cell({ r: 0, c: i });
      ws[headerRef].s = {
        font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: c.required ? 'DC2626' : '2563EB' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      };
      const noteRef = XLSX.utils.encode_cell({ r: 1, c: i });
      if (ws[noteRef]) {
        ws[noteRef].s = {
          font: { italic: true, sz: 8, color: { rgb: '6B7280' } },
          fill: { patternType: 'solid', fgColor: { rgb: 'F9FAFB' } },
          alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
          border,
        };
      }
      for (let r = 2; r < aoa.length; r++) {
        const ref = XLSX.utils.encode_cell({ r, c: i });
        if (!ws[ref]) ws[ref] = { v: '', t: 's' };
        ws[ref].s = {
          font: { sz: 10 },
          alignment: { horizontal: 'left', vertical: 'center' },
          border: { top: { style: 'thin', color: { rgb: 'E5E7EB' } }, bottom: { style: 'thin', color: { rgb: 'E5E7EB' } }, left: { style: 'thin', color: { rgb: 'E5E7EB' } }, right: { style: 'thin', color: { rgb: 'E5E7EB' } } },
          fill: r < 4 ? { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } } : undefined,
        };
      }
    });
    ws['!rows'] = [{ hpt: 28 }, { hpt: 36 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Claims');

    // ── Sheet 2: Instructions ────────────────────────────────────────────
    const instructions = [
      ['ClaimOptiq — Bulk Claims Import Template'],
      [''],
      ['How to use'],
      ['1. Fill in the "Claims" sheet (one claim per row). Header row 2 contains hints — leave it as-is.'],
      ['2. Required columns are highlighted in RED. Optional columns are in BLUE.'],
      ['3. Names for Hospital, Insurance Company, and TPA must match the reference sheets exactly.'],
      ['4. Use date format YYYY-MM-DD (e.g. 2025-03-12) or DD/MM/YYYY (e.g. 12/03/2025).'],
      ['5. Numeric columns: enter numbers only, no currency symbols or commas.'],
      ['6. Save as .xlsx (or .csv) and upload using the Import button on the Claims page.'],
      [''],
      ['Required fields'],
      ['• Patient Name'],
      ['• Claim Type (cashless / cashless anywhere / reimbursement / grievance)'],
      ['• Date of Admit'],
      ['• Hospital Name (unless "Is Direct Patient" = Yes — Super Admin only)'],
      [''],
      ['Validation'],
      ['• Each row is validated individually. Valid rows are imported; invalid rows are reported and skipped.'],
      ['• Maximum 2000 rows per import.'],
    ];
    const wsHelp = XLSX.utils.aoa_to_sheet(instructions);
    wsHelp['!cols'] = [{ wch: 100 }];
    if (wsHelp['A1']) wsHelp['A1'].s = { font: { bold: true, sz: 14, color: { rgb: '1E3A8A' } } };
    [3, 11, 17].forEach(rowIdx => {
      const ref = XLSX.utils.encode_cell({ r: rowIdx - 1, c: 0 });
      if (wsHelp[ref]) wsHelp[ref].s = { font: { bold: true, sz: 11, color: { rgb: '2563EB' } } };
    });
    XLSX.utils.book_append_sheet(wb, wsHelp, 'Instructions');

    // ── Sheet 3-5: Reference data ────────────────────────────────────────
    const addRefSheet = (name, items, columns) => {
      const data = [columns.map(c => c.label), ...items.map(row => columns.map(c => row[c.key] ?? ''))];
      const refWs = XLSX.utils.aoa_to_sheet(data);
      refWs['!cols'] = columns.map(c => ({ wch: c.width || 24 }));
      columns.forEach((_, i) => {
        const ref = XLSX.utils.encode_cell({ r: 0, c: i });
        if (refWs[ref]) refWs[ref].s = {
          font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
          fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      });
      XLSX.utils.book_append_sheet(wb, refWs, name);
    };

    if (!isHospitalUser) {
      addRefSheet(
        'Hospitals',
        hospitals.length ? hospitals : [{ name: 'No active hospitals — add hospitals first' }],
        isSuperAdmin && hospitals.length
          ? [{ key: 'name', label: 'Hospital Name (use this in import)', width: 36 }, { key: 'referenceBy', label: 'Reference By', width: 22 }]
          : [{ key: 'name', label: 'Hospital Name', width: 36 }]
      );
    }
    const contactCols = [
      { key: 'name', label: 'Name (use this in import)', width: 36 },
      { key: 'contactPerson', label: 'Contact Person', width: 22 },
      { key: 'mobile', label: 'Mobile', width: 16 },
      { key: 'email', label: 'Email', width: 26 },
    ];
    addRefSheet('Insurance', insurers.length ? insurers : [{ name: 'No active insurance companies' }],
      insurers.length ? [{ ...contactCols[0], label: 'Insurance Company Name (use this in import)' }, ...contactCols.slice(1)] : [contactCols[0]]);
    addRefSheet('TPA', tpas.length ? tpas : [{ name: 'No active TPAs' }],
      tpas.length ? [{ ...contactCols[0], label: 'TPA Name (use this in import)' }, ...contactCols.slice(1)] : [contactCols[0]]);
    addRefSheet('Statuses', statuses.length ? statuses : [{ slug: 'admitted', label: 'Admitted' }], [
      { key: 'slug', label: 'Status Slug (use this in Status column)', width: 36 },
      { key: 'label', label: 'Display Label', width: 24 },
    ]);

    XLSX.writeFile(wb, `claim-import-template.xlsx`);
    toast.success('Template downloaded');
  };

  // ── File parsing ─────────────────────────────────────────────────────────
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        // Prefer the "Claims" sheet, else first sheet
        const sheetName = wb.SheetNames.find(n => n.toLowerCase() === 'claims') || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) { toast.error('No data found in file'); return; }

        // raw:true keeps date cells as JS Date objects (locale-independent serial
        // conversion). With raw:false, XLSX would reformat dates to text using the
        // cell's display format — so a date in a US `m/d/yyyy`-formatted cell came
        // through as "12/6/2026" and the DD/MM parser flipped it to June 12.
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
        if (aoa.length < 2) { toast.error('File is empty or missing header row'); return; }

        const headers = aoa[0].map(h => labelToKey(h));
        const knownCount = headers.filter(Boolean).length;
        if (knownCount < 3) {
          toast.error('Could not match columns — make sure you used the downloaded template');
          return;
        }

        // Skip the hint/note row if it looks like one (any cell contains known hint text)
        let dataStart = 1;
        const possibleNote = aoa[1] || [];
        const looksLikeNote = possibleNote.some(cell => /YYYY-MM-DD|cashless.*reimbursement|see .* sheet/i.test(String(cell)));
        if (looksLikeNote) dataStart = 2;

        const parsed = [];
        for (let i = dataStart; i < aoa.length; i++) {
          const row = aoa[i];
          if (!row || row.every(v => v === '' || v === null || v === undefined)) continue;
          const obj = {};
          headers.forEach((key, idx) => { if (key) obj[key] = row[idx]; });
          // Skip rows that have no patient name AND no key identifier — likely blank
          if (!obj.patientName || !String(obj.patientName).trim()) continue;
          parsed.push(obj);
        }

        if (!parsed.length) { toast.error('No valid data rows found'); return; }
        if (parsed.length > 2000) { toast.error('Maximum 2000 rows per import'); return; }

        setRows(parsed);
        setFileName(file.name);
        setStep('preview');
      } catch (err) {
        toast.error('Failed to parse file — make sure it is a valid xlsx/csv');
      }
    };
    reader.onerror = () => toast.error('Failed to read file');
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    const BATCH_SIZE = 100;
    const batches = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) batches.push(rows.slice(i, i + BATCH_SIZE));

    cancelRef.current = false;
    setCancelling(false);
    inFlightAbortRef.current = null;
    setImporting(true);
    setProgress({ done: 0, total: rows.length, batch: 0, batches: batches.length, imported: 0, failed: 0, etaSec: null });

    const aggregated = {
      message: '',
      created: [],
      errors: [],
      fuzzyMatches: { hospitals: [], insurers: [], tpas: [] },
      autoCreated:  { hospitals: [], insurers: [], tpas: [] },
      reactivated:  { hospitals: [], insurers: [], tpas: [] },
      totalRows:    rows.length,
      successCount: 0,
      errorCount:   0,
      duplicateCount: 0,
    };
    const mergeFuzzy = (target, incoming) => {
      const seen = new Set(target.map(x => x.from));
      incoming.forEach(x => { if (!seen.has(x.from)) { target.push(x); seen.add(x.from); } });
    };
    const mergeAuto = (target, incoming) => {
      const seen = new Set(target);
      incoming.forEach(n => { if (!seen.has(n)) { target.push(n); seen.add(n); } });
    };

    const start = Date.now();
    try {
      for (let i = 0; i < batches.length; i++) {
        if (cancelRef.current) break;
        const batch = batches[i];
        // Backend numbers each batch starting at row 2 (it doesn't know about
        // batching). Shift the row numbers back into the source file's coordinate
        // system so error reports and the failed-rows export point at the right rows.
        const rowOffset = i * BATCH_SIZE;
        // Per-batch AbortController so Cancel can interrupt the in-flight request
        // instead of having to wait for it to finish.
        const controller = new AbortController();
        inFlightAbortRef.current = controller;
        // Auto-create flag only meaningful first time — subsequent batches will see masters already present.
        let data;
        try {
          ({ data } = await importClaimsAPI(
            batch,
            {
              autoCreateMasters: isSuperAdmin && autoCreateMasters,
              allowDuplicates: isSuperAdmin && allowDuplicates,
            },
            { signal: controller.signal },
          ));
        } catch (err) {
          if (cancelRef.current && (err.code === 'ERR_CANCELED' || err.name === 'CanceledError' || err.name === 'AbortError')) break;
          // Don't abort the whole import just because one batch failed (network
          // blip, 4xx, 5xx). Record every row in the batch as failed and move
          // on so the remaining batches still upload.
          const batchMsg = err.response?.data?.message || err.message || 'Batch failed';
          // Use batch-local row numbers; the `shifted()` call below adds rowOffset.
          const batchErrors = batch.map((r, idx) => ({
            row: idx + 2,
            patientName: r?.patientName || '',
            errors: [batchMsg],
          }));
          data = {
            created: [],
            errors: batchErrors,
            successCount: 0,
            errorCount: batch.length,
            duplicateCount: 0,
            fuzzyMatches: { hospitals: [], insurers: [], tpas: [] },
            autoCreated:  { hospitals: [], insurers: [], tpas: [] },
            reactivated:  { hospitals: [], insurers: [], tpas: [] },
          };
        } finally {
          inFlightAbortRef.current = null;
        }
        const shifted = (arr) => (arr || []).map(e => ({ ...e, row: (e.row || 0) + rowOffset }));
        aggregated.created.push(...shifted(data.created));
        aggregated.errors.push(...shifted(data.errors));
        aggregated.successCount   += data.successCount   || 0;
        aggregated.errorCount     += data.errorCount     || 0;
        aggregated.duplicateCount += data.duplicateCount || 0;
        if (data.fuzzyMatches) {
          mergeFuzzy(aggregated.fuzzyMatches.hospitals, data.fuzzyMatches.hospitals || []);
          mergeFuzzy(aggregated.fuzzyMatches.insurers,  data.fuzzyMatches.insurers  || []);
          mergeFuzzy(aggregated.fuzzyMatches.tpas,      data.fuzzyMatches.tpas      || []);
        }
        if (data.autoCreated) {
          mergeAuto(aggregated.autoCreated.hospitals, data.autoCreated.hospitals || []);
          mergeAuto(aggregated.autoCreated.insurers,  data.autoCreated.insurers  || []);
          mergeAuto(aggregated.autoCreated.tpas,      data.autoCreated.tpas      || []);
        }
        if (data.reactivated) {
          mergeAuto(aggregated.reactivated.hospitals, data.reactivated.hospitals || []);
          mergeAuto(aggregated.reactivated.insurers,  data.reactivated.insurers  || []);
          mergeAuto(aggregated.reactivated.tpas,      data.reactivated.tpas      || []);
        }

        const done = (i + 1) * BATCH_SIZE > rows.length ? rows.length : (i + 1) * BATCH_SIZE;
        const elapsedSec = (Date.now() - start) / 1000;
        const etaSec = done > 0 ? Math.round((elapsedSec / done) * (rows.length - done)) : null;
        setProgress({
          done, total: rows.length, batch: i + 1, batches: batches.length,
          imported: aggregated.successCount, failed: aggregated.errorCount, etaSec,
        });
      }

      aggregated.message = cancelRef.current
        ? `Cancelled at ${aggregated.successCount} of ${rows.length} claim(s)`
        : `Imported ${aggregated.successCount} of ${rows.length} claim(s)`;
      const failedMap = {};
      aggregated.errors.forEach(e => {
        const src = rows[e.row - 2];
        if (src) failedMap[e.row] = src;
      });
      setResult(aggregated);
      setFailedSourceRows(failedMap);
      persistResult(aggregated, failedMap, fileName);
      setStep('result');
      if (aggregated.successCount > 0) {
        toast.success(aggregated.message);
        onImported?.();
      } else {
        toast.error('No claims were imported — check the error list');
      }
    } catch (err) {
      aggregated.message = err.response?.data?.message || 'Import failed';
      // Still surface what we got so far
      if (aggregated.successCount + aggregated.errorCount > 0) {
        const failedMap = {};
        aggregated.errors.forEach(e => {
          const src = rows[e.row - 2];
          if (src) failedMap[e.row] = src;
        });
        setResult(aggregated);
        setFailedSourceRows(failedMap);
        persistResult(aggregated, failedMap, fileName);
        setStep('result');
      }
      toast.error(aggregated.message);
    } finally {
      setImporting(false);
      cancelRef.current = false;
      setCancelling(false);
      inFlightAbortRef.current = null;
    }
  };

  const cancelImport = () => {
    cancelRef.current = true;
    setCancelling(true);
    // Abort the current batch so the user doesn't wait for it to complete.
    inFlightAbortRef.current?.abort();
  };

  // Keep the prior result around (it's persisted) — user can still find it by
  // reopening; "Import Another File" just navigates back to the upload step.
  const resetAndUploadAgain = () => {
    setStep('upload'); setRows([]); setFileName('');
  };

  // Wipes the persisted result — used by the "Clear" button on the result step.
  const clearImportResult = () => {
    setResult(null); setFailedSourceRows({});
    setStep('upload'); setRows([]); setFileName('');
    try { localStorage.removeItem('claimImportResult_v1'); } catch { /* ignore */ }
  };

  // Build an xlsx containing only the rows that failed, prefixed with an Errors
  // column so the user can fix them and re-upload. Column order matches the
  // import template.
  const downloadFailedRows = () => {
    if (!result?.errors?.length) return;
    const cols = COLUMNS.filter(c => isSuperAdmin || !c.superAdminOnly);
    const headers = ['Errors', ...cols.map(c => c.label)];
    const data = result.errors.map(e => {
      const src = failedSourceRows[e.row] || {};
      return [
        (e.errors || []).join(' | '),
        ...cols.map(c => {
          const v = src[c.key];
          return v === null || v === undefined ? '' : v;
        }),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 50 }, ...cols.map(c => ({ wch: c.width || 16 }))];
    const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE2E2' } } };
    headers.forEach((_, idx) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
      if (ws[addr]) ws[addr].s = headerStyle;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `claim-import-failed-${stamp}.xlsx`);
  };

  if (!open) return null;

  return ReactDOM.createPortal(
    <>
      {importing && (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-8 w-full max-w-sm text-center shadow-xl">
            <div className="w-14 h-14 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin mx-auto mb-5" />
            <p className="text-base font-bold text-gray-800">Importing…</p>
            <p className="text-sm text-gray-500 mt-1">
              {progress.done.toLocaleString()} of {progress.total.toLocaleString()} claim{progress.total > 1 ? 's' : ''}
            </p>
            <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-600 rounded-full transition-all duration-500"
                style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-[11px]">
              <div className="bg-gray-50 rounded-md py-1.5">
                <p className="text-gray-500">Batch</p>
                <p className="font-bold text-gray-800">{progress.batch}/{progress.batches}</p>
              </div>
              <div className="bg-emerald-50 rounded-md py-1.5">
                <p className="text-emerald-600">Imported</p>
                <p className="font-bold text-emerald-700">{progress.imported.toLocaleString()}</p>
              </div>
              <div className="bg-rose-50 rounded-md py-1.5">
                <p className="text-rose-600">Failed</p>
                <p className="font-bold text-rose-700">{progress.failed.toLocaleString()}</p>
              </div>
            </div>
            {progress.etaSec !== null && progress.etaSec > 0 && (
              <p className="text-xs text-gray-500 mt-3">
                ~{progress.etaSec >= 60 ? `${Math.floor(progress.etaSec / 60)}m ${progress.etaSec % 60}s` : `${progress.etaSec}s`} remaining
              </p>
            )}
            <p className="text-xs text-gray-400 mt-3">Please don't close this page</p>
            <button
              onClick={cancelImport}
              disabled={cancelling}
              className="mt-4 w-full px-4 py-2 text-xs bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelling ? 'Stopping…' : 'Cancel import'}
            </button>
          </div>
        </div>
      )}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
              <HiOutlineUpload className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">Import Claims</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {step === 'upload' && 'Download the sample template, fill it in, then upload'}
                {step === 'preview' && `${rows.length} row(s) ready to import from ${fileName}`}
                {step === 'result' && 'Import complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={importing} title={importing ? 'Use Cancel button below to stop import' : 'Close'}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
                <HiOutlineInformationCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 space-y-1.5">
                  <p className="font-medium">How it works</p>
                  <ol className="list-decimal pl-4 space-y-0.5 text-xs text-blue-800">
                    <li>Download the sample <code className="px-1 py-0.5 bg-blue-100 rounded">.xlsx</code> template.</li>
                    <li>Fill in your existing claims (one per row). The template includes reference sheets for hospital, insurance, TPA and status names.</li>
                    <li>Upload the filled file below. Valid rows are imported; invalid rows are reported and skipped.</li>
                  </ol>
                </div>
              </div>

              <button
                onClick={downloadTemplate}
                disabled={refLoading}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
              >
                <HiOutlineDownload className="w-5 h-5" />
                {refLoading ? 'Preparing template…' : 'Download Sample Template'}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-400">then upload your file</span></div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="hidden"
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary-400', 'bg-primary-50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-400', 'bg-primary-50'); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.classList.remove('border-primary-400', 'bg-primary-50');
                  handleFile(e.dataTransfer.files?.[0]);
                }}
                className="border-2 border-dashed border-gray-300 rounded-xl px-6 py-10 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors"
              >
                <HiOutlineDocumentText className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">Click to choose a file, or drag &amp; drop</p>
                <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, or .csv</p>
              </div>
            </div>
          )}

          {step === 'preview' && !importing && (() => {
            const { rowIssues, summary } = validation;
            const typeColor = {
              patient:   'bg-rose-100 text-rose-700',
              date:      'bg-orange-100 text-orange-700',
              type:      'bg-amber-100 text-amber-700',
              hospital:  'bg-emerald-100 text-emerald-700',
              insurance: 'bg-blue-100 text-blue-700',
              tpa:       'bg-purple-100 text-purple-700',
              status:    'bg-cyan-100 text-cyan-700',
            };
            const fuzzyColor = 'bg-indigo-50 text-indigo-700 border border-indigo-100';
            const visibleRows = rows
              .map((r, i) => ({ r, i, issues: rowIssues[i]?.issues || [], fuzzy: rowIssues[i]?.fuzzy || [] }))
              .filter(x => !onlyIssues || x.issues.length > 0);
            const shown = visibleRows.slice(0, previewLimit);

            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <p className="text-emerald-700 font-semibold">Ready to import</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-0.5">{summary.ok}</p>
                  </div>
                  <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
                    <p className="text-rose-700 font-semibold">Need fixes</p>
                    <p className="text-2xl font-bold text-rose-700 mt-0.5">{summary.badRows}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-gray-600 font-semibold">Total rows</p>
                    <p className="text-2xl font-bold text-gray-800 mt-0.5">{rows.length}</p>
                  </div>
                </div>

                {summary.badRows > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-900 space-y-1.5">
                    <p className="font-semibold">{summary.badRows} row(s) need updates before they can import:</p>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(summary.byType).map(([t, n]) => (
                        <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${typeColor[t] || 'bg-gray-100 text-gray-700'}`}>
                          {t}: {n}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-amber-700">Valid rows will still be imported when you click Import — invalid rows are skipped and listed in the result.</p>
                  </div>
                )}

                {isSuperAdmin && (() => {
                  const missing = { hospitals: new Set(), insurers: new Set(), tpas: new Set() };
                  rowIssues.forEach((ri, i) => {
                    ri.issues.forEach(it => {
                      if (it.type === 'hospital' && it.label.startsWith('Hospital not found:')) missing.hospitals.add(cleanCell(rows[i].hospital));
                      if (it.type === 'insurance')                                                 missing.insurers.add(cleanCell(rows[i].insuranceCompany));
                      if (it.type === 'tpa')                                                       missing.tpas.add(cleanCell(rows[i].tpa));
                    });
                  });
                  missing.hospitals.delete(''); missing.insurers.delete(''); missing.tpas.delete('');
                  const total = missing.hospitals.size + missing.insurers.size + missing.tpas.size;
                  if (total === 0) return null;
                  return (
                    <div className={`border rounded-lg p-3 text-xs space-y-2 ${autoCreateMasters ? 'bg-indigo-50 border-indigo-200' : 'bg-gray-50 border-gray-200'}`}>
                      <label className="flex items-start gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={autoCreateMasters}
                          onChange={e => setAutoCreateMasters(e.target.checked)}
                          className="rounded mt-0.5"
                        />
                        <div className="flex-1">
                          <p className="font-semibold text-gray-800">Auto-create {total} missing master record(s) on import</p>
                          <div className="flex flex-wrap gap-1.5 mt-1">
                            {missing.hospitals.size > 0 && <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[11px]">{missing.hospitals.size} new hospital(s)</span>}
                            {missing.insurers.size  > 0 && <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 text-[11px]">{missing.insurers.size} new insurer(s)</span>}
                            {missing.tpas.size      > 0 && <span className="px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 text-[11px]">{missing.tpas.size} new TPA(s)</span>}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-1.5">⚠ This creates master records (incl. missing claim statuses) exactly as written in your file. Typos become duplicates — verify spellings first.</p>
                        </div>
                      </label>
                    </div>
                  );
                })()}

                {isSuperAdmin && (
                  <div className={`border rounded-lg p-3 text-xs space-y-2 ${allowDuplicates ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-200'}`}>
                    <label className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={allowDuplicates}
                        onChange={e => setAllowDuplicates(e.target.checked)}
                        className="rounded mt-0.5"
                      />
                      <div className="flex-1">
                        <p className="font-semibold text-gray-800">Skip duplicate detection</p>
                        <p className="text-[11px] text-gray-600 mt-1">Bypass the CCN-already-exists + same-patient/hospital/admit-date checks. Use when re-importing a failed-rows export where the originals are already in the DB.</p>
                        <p className="text-[11px] text-rose-700 mt-1">⚠ Importing genuinely duplicate rows will create twin claim records — only enable for known good data.</p>
                      </div>
                    </label>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
                    <input type="checkbox" checked={onlyIssues} onChange={e => { setOnlyIssues(e.target.checked); setPreviewLimit(200); }} className="rounded" />
                    Show only rows with issues
                  </label>
                  <span className="text-[11px] text-gray-400">Auto-matched names (close variants) are imported as-is — see indigo chips.</span>
                </div>

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-[50vh]">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Patient</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Hospital</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Type</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">DOA</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Bill</th>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500 min-w-[240px]">What needs updating</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {shown.map(({ r, i, issues, fuzzy }) => (
                          <tr key={i} className={`hover:bg-gray-50 ${issues.length ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                            <td className="px-2 py-1.5 text-gray-800 font-medium">{r.patientName || <span className="text-red-500">missing</span>}</td>
                            <td className="px-2 py-1.5 text-gray-600">{r.hospital || (String(r.isDirectPatient || '').toLowerCase().startsWith('y') ? <span className="italic text-purple-600">Direct</span> : '-')}</td>
                            <td className="px-2 py-1.5 text-gray-600 capitalize">{r.claimType || '-'}</td>
                            <td className="px-2 py-1.5 text-gray-600">{r.dateOfAdmit || '-'}</td>
                            <td className="px-2 py-1.5 text-gray-600">{r.hospitalFinalBill || '-'}</td>
                            <td className="px-2 py-1.5">
                              {issues.length === 0 && fuzzy.length === 0 && <span className="text-emerald-600 text-[11px]">✓ OK</span>}
                              <div className="flex flex-wrap gap-1">
                                {issues.map((it, j) => (
                                  <span key={`i${j}`} className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${typeColor[it.type] || 'bg-gray-100 text-gray-700'}`} title={it.label}>
                                    {it.label}
                                  </span>
                                ))}
                                {fuzzy.map((it, j) => (
                                  <span key={`f${j}`} className={`px-1.5 py-0.5 rounded text-[10.5px] font-medium ${fuzzyColor}`} title={it.label}>
                                    ↪ {it.label}
                                  </span>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {visibleRows.length > previewLimit && (
                    <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t border-gray-200 flex items-center justify-between">
                      <span>Showing first {previewLimit} of {visibleRows.length}{onlyIssues ? ' rows with issues' : ' rows'}</span>
                      <button
                        onClick={() => setPreviewLimit(visibleRows.length)}
                        className="px-2.5 py-1 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-medium"
                      >
                        Show all {visibleRows.length}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Rows</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{result.totalRows}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-700">Imported</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{result.successCount}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-600">Duplicates skipped</p>
                  <p className="text-2xl font-bold text-slate-700 mt-1">{result.duplicateCount || 0}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-700">Other errors</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">{Math.max(0, (result.errorCount || 0) - (result.duplicateCount || 0))}</p>
                </div>
              </div>

              {result.autoCreated && (result.autoCreated.hospitals.length + result.autoCreated.insurers.length + result.autoCreated.tpas.length) > 0 && (
                <details open className="border border-emerald-100 rounded-lg overflow-hidden">
                  <summary className="bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 cursor-pointer hover:bg-emerald-100">
                    Auto-created master records ({result.autoCreated.hospitals.length + result.autoCreated.insurers.length + result.autoCreated.tpas.length})
                  </summary>
                  <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2 text-xs">
                    {[
                      ['Hospitals',           result.autoCreated.hospitals],
                      ['Insurance Companies', result.autoCreated.insurers],
                      ['TPAs',                result.autoCreated.tpas],
                    ].filter(([, arr]) => arr.length).map(([label, arr]) => (
                      <div key={label}>
                        <p className="font-semibold text-gray-700">{label} ({arr.length})</p>
                        <ul className="list-disc pl-4 mt-0.5 text-gray-600 space-y-0.5">
                          {arr.map((name, i) => <li key={i}>{name}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {result.reactivated && (result.reactivated.hospitals.length + result.reactivated.insurers.length + result.reactivated.tpas.length) > 0 && (
                <details open className="border border-amber-100 rounded-lg overflow-hidden">
                  <summary className="bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 cursor-pointer hover:bg-amber-100">
                    Reactivated master records ({result.reactivated.hospitals.length + result.reactivated.insurers.length + result.reactivated.tpas.length})
                  </summary>
                  <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2 text-xs">
                    {[
                      ['Hospitals',           result.reactivated.hospitals],
                      ['Insurance Companies', result.reactivated.insurers],
                      ['TPAs',                result.reactivated.tpas],
                    ].filter(([, arr]) => arr.length).map(([label, arr]) => (
                      <div key={label}>
                        <p className="font-semibold text-gray-700">{label} ({arr.length})</p>
                        <ul className="list-disc pl-4 mt-0.5 text-gray-600 space-y-0.5">
                          {arr.map((name, i) => <li key={i}>{name}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {result.fuzzyMatches && (result.fuzzyMatches.hospitals.length + result.fuzzyMatches.insurers.length + result.fuzzyMatches.tpas.length) > 0 && (
                <details className="border border-indigo-100 rounded-lg overflow-hidden">
                  <summary className="bg-indigo-50 px-3 py-2 text-xs font-semibold text-indigo-700 cursor-pointer hover:bg-indigo-100">
                    Auto-matched names ({result.fuzzyMatches.hospitals.length + result.fuzzyMatches.insurers.length + result.fuzzyMatches.tpas.length})
                  </summary>
                  <div className="max-h-48 overflow-y-auto px-3 py-2 space-y-2 text-xs">
                    {[
                      ['Hospitals',           result.fuzzyMatches.hospitals],
                      ['Insurance Companies', result.fuzzyMatches.insurers],
                      ['TPAs',                result.fuzzyMatches.tpas],
                    ].filter(([, arr]) => arr.length).map(([label, arr]) => (
                      <div key={label}>
                        <p className="font-semibold text-gray-700">{label}</p>
                        <ul className="list-disc pl-4 mt-0.5 text-gray-600 space-y-0.5">
                          {arr.map((m, i) => <li key={i}><span className="font-mono">{m.from}</span> → <span className="font-mono text-indigo-700">{m.to}</span></li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {result.errors?.length > 0 && (() => {
                const classifyError = (msg) => {
                  const m = String(msg);
                  if (/^Duplicate/i.test(m))          return { type: 'Duplicate', color: 'bg-slate-100 text-slate-700' };
                  if (/^Insurance Company/i.test(m)) return { type: 'Insurance', color: 'bg-blue-100 text-blue-700' };
                  if (/^TPA/i.test(m))                return { type: 'TPA',       color: 'bg-purple-100 text-purple-700' };
                  if (/^Hospital/i.test(m))           return { type: 'Hospital',  color: 'bg-emerald-100 text-emerald-700' };
                  if (/^Reference By/i.test(m))       return { type: 'Reference', color: 'bg-amber-100 text-amber-700' };
                  if (/Date of Admit|Submit Mode|Claim Type|Patient Name/i.test(m)) return { type: 'Required', color: 'bg-rose-100 text-rose-700' };
                  if (/^Status/i.test(m))             return { type: 'Status',    color: 'bg-cyan-100 text-cyan-700' };
                  return { type: 'Other', color: 'bg-gray-100 text-gray-700' };
                };
                const grouped = new Map();
                result.errors.forEach(e => {
                  e.errors.forEach(msg => {
                    if (!grouped.has(msg)) grouped.set(msg, []);
                    grouped.get(msg).push({ row: e.row, patientName: e.patientName });
                  });
                });
                const summary = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);

                return (
                  <div className="space-y-3">
                    <div className="border border-red-100 rounded-lg overflow-hidden">
                      <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 border-b border-red-100 flex items-center justify-between">
                        <span>Issues to fix ({summary.length} unique, {result.errors.length} row(s) affected)</span>
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-red-50">
                        {summary.map(([msg, rows], i) => {
                          const cls = classifyError(msg);
                          return (
                            <div key={i} className="px-3 py-2.5 text-xs">
                              <div className="flex items-start gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase flex-shrink-0 ${cls.color}`}>{cls.type}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-800 break-words">{msg}</p>
                                  <p className="text-[11px] text-gray-500 mt-1">
                                    {rows.length} row{rows.length > 1 ? 's' : ''}: {rows.slice(0, 5).map(r => `#${r.row}${r.patientName ? ` (${r.patientName})` : ''}`).join(', ')}
                                    {rows.length > 5 && ` + ${rows.length - 5} more`}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <details className="border border-gray-200 rounded-lg overflow-hidden">
                      <summary className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100">
                        Show full per-row list ({result.errors.length})
                      </summary>
                      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                        {result.errors.map((e, i) => (
                          <div key={i} className="px-3 py-2 text-xs">
                            <p className="font-medium text-gray-800">Row {e.row}: {e.patientName || '(no name)'}</p>
                            <ul className="list-disc pl-4 mt-1 text-red-600 space-y-0.5">
                              {e.errors.map((msg, j) => <li key={j}>{msg}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })()}

              {result.successCount > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 flex gap-2 text-xs text-emerald-800">
                  <HiOutlineCheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{result.successCount} claim(s) added to the system. Close this dialog to see them in the list.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          {step === 'upload' && (
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
              Cancel
            </button>
          )}
          {step === 'preview' && !importing && (
            <>
              <button onClick={resetAndUploadAgain}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
                Back
              </button>
              <button onClick={handleImport}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold">
                <HiOutlineUpload className="w-4 h-4" /> Import {rows.length} claim(s)
              </button>
            </>
          )}
          {step === 'result' && (
            <>
              {result?.errors?.length > 0 && (
                <button onClick={downloadFailedRows}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-medium">
                  <HiOutlineDownload className="w-4 h-4" />
                  Download Failed Rows ({result.errors.length})
                </button>
              )}
              <button onClick={clearImportResult}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
                Clear
              </button>
              <button onClick={resetAndUploadAgain}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
                Import Another File
              </button>
              <button onClick={onClose}
                className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold">
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </>,
    document.body
  );
};

export default ImportClaimsModal;
