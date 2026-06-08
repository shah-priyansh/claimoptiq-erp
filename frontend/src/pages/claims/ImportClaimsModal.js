import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx-js-style';
import {
  HiOutlineX, HiOutlineDownload, HiOutlineUpload, HiOutlineDocumentText,
  HiOutlineCheckCircle, HiOutlineExclamationCircle, HiOutlineInformationCircle,
} from 'react-icons/hi';
import {
  importClaimsAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI, getClaimStatusesAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';

// ── Column definitions for the template ────────────────────────────────────
// Order matters: this is the column order in the downloaded xlsx.
const COLUMNS = [
  { key: 'patientName',         label: 'Patient Name *',                width: 22, required: true },
  { key: 'patientMobile',       label: 'Patient Mobile',                width: 14 },
  { key: 'hospital',            label: 'Hospital Name *',               width: 24, note: 'Must match exactly (see Hospitals sheet). Leave blank if "Is Direct Patient" = Yes.' },
  { key: 'isDirectPatient',     label: 'Is Direct Patient (Yes/No)',    width: 12 },
  { key: 'doctorName',          label: 'Doctor Name',                   width: 18 },
  { key: 'claimType',           label: 'Claim Type *',                  width: 14, note: 'cashless / reimbursement / grievance', required: true },
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
];

// Strip trailing '*' / spaces from header → use to match xlsx columns to data keys
const labelToKey = (label) => {
  const cleaned = String(label || '').replace(/\*/g, '').trim().toLowerCase();
  const col = COLUMNS.find(c => c.label.replace(/\*/g, '').trim().toLowerCase() === cleaned);
  return col?.key || null;
};

const ImportClaimsModal = ({ open, onClose, onImported }) => {
  const { user } = useAuth();
  const isHospitalUser = !!user?.hospital;
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

  useEffect(() => {
    if (!open) return;
    setRefLoading(true);
    Promise.all([
      isHospitalUser ? Promise.resolve({ data: [] }) : getHospitalsAPI({ active: 'true' }).catch(() => ({ data: [] })),
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
    if (!open) {
      setStep('upload'); setRows([]); setFileName(''); setResult(null);
    }
  }, [open]);

  // ── Build & download the sample template ─────────────────────────────────
  const downloadTemplate = () => {
    const visibleCols = isHospitalUser
      ? COLUMNS.filter(c => c.key !== 'hospital' && c.key !== 'isDirectPatient')
      : COLUMNS;

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Claims (the actual import template) ─────────────────────
    const headerRow = visibleCols.map(c => c.label);
    const noteRow   = visibleCols.map(c => c.note || '');
    const exampleHospital = !isHospitalUser ? (hospitals[0]?.name || 'City Hospital') : '';
    const exampleInsurer  = insurers[0]?.name || 'Star Health Insurance';
    const exampleTpa      = tpas[0]?.name || 'MediAssist TPA';

    const sample1 = {
      patientName: 'Rahul Sharma',
      patientMobile: '9876543210',
      hospital: exampleHospital,
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
    };
    const sample2 = {
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
      ['• Claim Type (cashless / reimbursement / grievance)'],
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
      addRefSheet('Hospitals', hospitals.length ? hospitals : [{ name: 'No active hospitals — add hospitals first' }], [{ key: 'name', label: 'Hospital Name', width: 36 }]);
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

        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
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
    setImporting(true);
    try {
      const { data } = await importClaimsAPI(rows);
      setResult(data);
      setStep('result');
      if (data.successCount > 0) {
        toast.success(`Imported ${data.successCount} of ${data.totalRows} claim(s)`);
        onImported?.();
      } else {
        toast.error('No claims were imported — check the error list');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const resetAndUploadAgain = () => {
    setStep('upload'); setRows([]); setFileName(''); setResult(null);
  };

  if (!open) return null;

  return ReactDOM.createPortal(
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
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
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

              <label className="block">
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
              </label>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-900 flex gap-2">
                <HiOutlineExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>This is a preview. Validation runs on the server when you click Import. Invalid rows will be reported and skipped.</span>
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
                        <th className="px-2 py-2 text-left font-semibold text-gray-500">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.slice(0, 100).map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                          <td className="px-2 py-1.5 text-gray-800 font-medium">{r.patientName || <span className="text-red-500">missing</span>}</td>
                          <td className="px-2 py-1.5 text-gray-600">{r.hospital || (String(r.isDirectPatient || '').toLowerCase().startsWith('y') ? <span className="italic text-purple-600">Direct</span> : '-')}</td>
                          <td className="px-2 py-1.5 text-gray-600 capitalize">{r.claimType || '-'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{r.dateOfAdmit || '-'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{r.hospitalFinalBill || '-'}</td>
                          <td className="px-2 py-1.5 text-gray-600">{r.status || 'admitted'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > 100 && (
                  <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t border-gray-200 text-center">
                    Showing first 100 of {rows.length} rows
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Rows</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{result.totalRows}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-700">Imported</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{result.successCount}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-700">Failed</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">{result.errorCount}</p>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="border border-red-100 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 border-b border-red-100">
                    Rows with errors ({result.errors.length})
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-red-50">
                    {result.errors.map((e, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <p className="font-medium text-gray-800">Row {e.row}: {e.patientName || '(no name)'}</p>
                        <ul className="list-disc pl-4 mt-1 text-red-600 space-y-0.5">
                          {e.errors.map((msg, j) => <li key={j}>{msg}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

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
          {step === 'preview' && (
            <>
              <button onClick={resetAndUploadAgain} disabled={importing}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50">
                Back
              </button>
              <button onClick={handleImport} disabled={importing}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50">
                {importing ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                ) : (
                  <><HiOutlineUpload className="w-4 h-4" /> Import {rows.length} claim(s)</>
                )}
              </button>
            </>
          )}
          {step === 'result' && (
            <>
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
    </div>,
    document.body
  );
};

export default ImportClaimsModal;
