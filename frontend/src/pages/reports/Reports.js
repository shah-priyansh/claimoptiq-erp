import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI, bulkBillAPI, getReferencesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlineDownload, HiChevronDown, HiOutlineX, HiOutlineSearch } from 'react-icons/hi';
import { formatCurrency, calculateFilePrice, formatDate as _formatDate } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import JSZip from 'jszip';

// ─── Field definitions ────────────────────────────────────────────────────────
// Order here drives the export sequence (Excel + PDF), and matches the columns
// in the operations team's reference workbook so imports/exports stay aligned.
const fmtDateCell = (d) => _formatDate(d, '');
const BASE_FIELD_DEFS = [
  { key: 'month',                     label: 'MONTH',                  width: 12, pdfW: 14, defaultOn: false, getValue: c => c.month || '' },
  { key: 'hospital',                  label: 'HOSPITAL',               width: 26, pdfW: 32, defaultOn: true,  nonHospitalOnly: true, getValue: c => c.isDirectPatient ? 'Direct Patient' : (c.hospital?.name || '-') },
  { key: 'doctorName',                label: 'DOCTOR NAME',            width: 20, pdfW: 26, defaultOn: true,  getValue: c => c.doctorName || '' },
  { key: 'patientName',               label: 'PATIENT NAME',           width: 22, pdfW: 28, defaultOn: true,  getValue: c => c.patientName || '' },
  { key: 'patientMobile',             label: 'PATIENT MOBILE',         width: 14, pdfW: 18, defaultOn: false, getValue: c => c.patientMobile || '' },
  { key: 'isDirectPatient',           label: 'DIRECT PATIENT',         width: 12, pdfW: 14, defaultOn: false, getValue: c => c.isDirectPatient ? 'Yes' : 'No' },
  { key: 'claimType',                 label: 'CLAIM TYPE',             width: 14, pdfW: 18, defaultOn: true,  getValue: c => c.claimType || '' },
  { key: 'insuranceCompany',          label: 'COMPANY NAME',           width: 22, pdfW: 26, defaultOn: true,  getValue: c => c.insuranceCompany?.name || '' },
  { key: 'tpa',                       label: 'TPA NAME',               width: 18, pdfW: 22, defaultOn: true,  getValue: c => c.tpa?.name || '' },
  { key: 'ccnNo',                     label: 'CCN NO',                 width: 13, pdfW: 14, defaultOn: true,  getValue: c => c.ccnNo || '' },
  { key: 'policyNo',                  label: 'POLICY NO',              width: 14, pdfW: 15, defaultOn: false, getValue: c => c.policyNo || '' },
  { key: 'clientId',                  label: 'CLIENT ID',              width: 14, pdfW: 15, defaultOn: false, getValue: c => c.clientId || '' },
  { key: 'treatmentType',             label: 'TREATMENT TYPE',         width: 14, pdfW: 18, defaultOn: false, getValue: c => c.treatmentType || '' },
  { key: 'diagnosis',                 label: 'DIAGNOSIS',              width: 22, pdfW: 28, defaultOn: false, getValue: c => c.diagnosis || '' },
  { key: 'surgeryName',               label: 'SURGERY NAME',           width: 20, pdfW: 24, defaultOn: false, getValue: c => c.surgeryName || '' },
  { key: 'dateOfAdmit',               label: 'D.O.A.',                 width: 13, pdfW: 16, defaultOn: true,  getValue: c => fmtDateCell(c.dateOfAdmit) },
  { key: 'dateOfDischarge',           label: 'D.O.D.',                 width: 13, pdfW: 16, defaultOn: true,  getValue: c => fmtDateCell(c.dateOfDischarge) },
  { key: 'hospitalBill',              label: 'HOSPITAL BILL',          width: 14, pdfW: 22, defaultOn: true,  isAmount: true, getValue: c => c.hospitalFinalBill || 0 },
  { key: 'mouDiscount',               label: 'MOU DISCOUNT',           width: 14, pdfW: 18, defaultOn: false, isAmount: true, getValue: c => c.mouDiscount || 0 },
  { key: 'deduction',                 label: 'DEDUCTION',              width: 12, pdfW: 16, defaultOn: false, isAmount: true, getValue: c => c.deduction || 0 },
  { key: 'approvalAmt',               label: 'FINAL APPROVAL AMOUNT',  width: 20, pdfW: 26, defaultOn: true,  isAmount: true, getValue: c => c.finalApprovalAmount || 0 },
  { key: 'finalApprovalDate',         label: 'FINAL APPROVAL DATE',    width: 14, pdfW: 18, defaultOn: false, getValue: c => fmtDateCell(c.finalApprovalDate) },
  { key: 'fileReceivedDate',          label: 'FILE RECEIVED DATE',     width: 14, pdfW: 18, defaultOn: false, getValue: c => fmtDateCell(c.fileReceivedDate) },
  { key: 'submitMode',                label: 'SUBMIT MODE',            width: 12, pdfW: 14, defaultOn: false, getValue: c => c.submitMode || '' },
  { key: 'courierSubmitDate',         label: 'COURIER SUBMIT DATE',    width: 14, pdfW: 18, defaultOn: false, getValue: c => fmtDateCell(c.courierSubmitDate) },
  { key: 'onlineSubmitDate',          label: 'ONLINE SUBMIT DATE',     width: 14, pdfW: 18, defaultOn: false, getValue: c => fmtDateCell(c.onlineSubmitDate) },
  { key: 'courierCompanyName',        label: 'COURIER COMPANY',        width: 16, pdfW: 20, defaultOn: false, getValue: c => c.courierCompanyName || '' },
  { key: 'podNumber',                 label: 'POD NUMBER',             width: 14, pdfW: 16, defaultOn: false, getValue: c => c.podNumber || '' },
  { key: 'settlement',                label: 'SETTLEMENT AMOUNT',      width: 18, pdfW: 22, defaultOn: false, isAmount: true, getValue: c => c.settlementAmount || 0 },
  { key: 'settlementAmountDeduction', label: 'SETTLEMENT DEDUCTION',   width: 16, pdfW: 20, defaultOn: false, isAmount: true, getValue: c => c.settlementAmountDeduction || 0 },
  { key: 'mouDiscountOnSettlement',   label: 'MOU DISC ON SETTLEMENT', width: 18, pdfW: 22, defaultOn: false, isAmount: true, getValue: c => c.mouDiscountOnSettlement || 0 },
  { key: 'tds',                       label: 'TDS',                    width: 12, pdfW: 14, defaultOn: false, isAmount: true, getValue: c => c.tds || 0 },
  { key: 'bankTransfer',              label: 'BANK TRANSFER AMOUNT',   width: 18, pdfW: 22, defaultOn: false, isAmount: true, getValue: c => c.bankTransferAmount || 0 },
  { key: 'settlementDate',            label: 'SETTLEMENT DATE',        width: 14, pdfW: 18, defaultOn: false, getValue: c => fmtDateCell(c.settlementDate) },
  { key: 'neftNo',                    label: 'NEFT NO',                width: 14, pdfW: 16, defaultOn: false, getValue: c => c.neftNo || '' },
  { key: 'remarks',                   label: 'REMARKS',                width: 22, pdfW: 28, defaultOn: false, getValue: c => c.remarks || '' },
  { key: 'rejectedReason',            label: 'REJECTED REASON',        width: 20, pdfW: 26, defaultOn: false, getValue: c => c.rejectedReason || '' },
  { key: 'status',                    label: 'STATUS',                 width: 18, pdfW: 22, defaultOn: false, getValue: c => (c.status || '').replace(/_/g, ' ') },
  { key: 'referenceBy',               label: 'REFERENCE BY',           width: 18, pdfW: 28, defaultOn: true,  superAdminOnly: true, getValue: c => c.hospital?.referenceBy || '' },
  { key: 'filePrice',                 label: 'FILE PRICE',             width: 12, pdfW: 22, defaultOn: true,  superAdminOnly: true, isAmount: true, getValue: null },
];

const DEFAULT_SELECTED    = BASE_FIELD_DEFS.filter(f => f.defaultOn && !f.superAdminOnly).map(f => f.key);
const DEFAULT_SELECTED_SA = BASE_FIELD_DEFS.filter(f => f.defaultOn).map(f => f.key);

// ─── Component ────────────────────────────────────────────────────────────────
const Reports = () => {
  const { user, roleSlug } = useAuth();
  const confirm = useConfirm();
  const isHospitalUser = !!user?.hospital;
  const isSuperAdmin = roleSlug === 'super_admin';

  const [hospitals, setHospitals] = useState([]);
  const [referenceMaster, setReferenceMaster] = useState([]);
  const [filters, setFilters] = useState({ hospital: '', dateFrom: '', dateTo: '', status: '', directPatient: '', reference: '' });

  useEffect(() => {
    getReferencesAPI({ active: 'true' })
      .then(({ data }) => setReferenceMaster(data || []))
      .catch(() => setReferenceMaster([]));
  }, []);

  // Distinct, sorted union of legacy referenceBy strings + active Reference master names.
  const referenceOptions = React.useMemo(() => {
    const seen = new Set();
    hospitals.forEach(h => { if (h.referenceBy && h.referenceBy.trim()) seen.add(h.referenceBy.trim()); });
    referenceMaster.forEach(r => { if (r.name && r.name.trim()) seen.add(r.name.trim()); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b)).map(r => ({ value: r, label: r }));
  }, [hospitals, referenceMaster]);
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [billingLoading, setBillingLoading] = useState(false);

  const [billMode, setBillMode] = useState(false);
  const [selectedClaimIds, setSelectedClaimIds] = useState([]);

  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef(null);

  // Field selection modal
  const [fieldModal, setFieldModal] = useState({ open: false, pendingAction: null });
  const [fieldSearch, setFieldSearch] = useState('');
  const [selectedFields, setSelectedFields] = useState(isSuperAdmin ? DEFAULT_SELECTED_SA : DEFAULT_SELECTED);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenuOpen]);

  useEffect(() => {
    if (!isHospitalUser) {
      getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    }
    getClaimStatusesAPI()
      .then(({ data }) => setClaimStatuses(data.filter(s => s.isActive !== false && (!s.superAdminOnly || isSuperAdmin))))
      .catch(() => {})
      .finally(() => setStatusesLoading(false));
  }, [isHospitalUser]);

  const getFilePrice = useCallback(
    (c) => c.filePrice || calculateFilePrice(c.hospital?.billingServices || [], c.hospitalFinalBill || 0, c.finalApprovalAmount || 0),
    []
  );

  // Build field defs available for this user
  const allFieldDefs = BASE_FIELD_DEFS
    .filter(f => (!f.superAdminOnly || isSuperAdmin) && (!f.nonHospitalOnly || !isHospitalUser))
    .map(f => f.key === 'filePrice' ? { ...f, getValue: c => getFilePrice(c) } : f);

  const activeFieldDefs = allFieldDefs.filter(f => selectedFields.includes(f.key));

  // ── Data ──────────────────────────────────────────────────────────────────

  const fetchClaims = async () => {
    const params = { limit: 10000 };
    if (filters.hospital) params.hospital = filters.hospital;
    if (filters.dateFrom) params.dateFrom = filters.dateFrom;
    if (filters.dateTo) params.dateTo = filters.dateTo;
    if (filters.status) params.status = filters.status;
    if (filters.directPatient) params.directPatient = filters.directPatient;
    if (filters.reference && isSuperAdmin) params.reference = filters.reference;
    const { data } = await getClaimsAPI(params);
    return data.claims;
  };

  const generateReport = async () => {
    setLoading(true);
    try { setClaims(await fetchClaims()); }
    catch { toast.error('Failed to generate report'); }
    finally { setLoading(false); }
  };

  // ── Bill mode ─────────────────────────────────────────────────────────────

  const handleGenerateBill = async () => {
    setSelectedClaimIds([]);
    setBillMode(true);
    if (claims.length > 0) return;
    setLoading(true);
    try { setClaims(await fetchClaims()); }
    catch { toast.error('Failed to generate report'); }
    finally { setLoading(false); }
  };

  const handleCancelBillMode = () => { setBillMode(false); setSelectedClaimIds([]); };

  const handleInitialBill = async () => {
    const ids = selectedClaimIds;
    if (!ids.length) return;
    const ok = await confirm(
      `This will mark ${ids.length} claim${ids.length !== 1 ? 's' : ''} as Billed. Continue?`,
      { title: 'Initial Bill', confirmLabel: 'Mark as Billed', variant: 'primary' }
    );
    if (!ok) return;
    setBillingLoading(true);
    try {
      await bulkBillAPI(ids, true);
      setClaims(prev => prev.map(c => ids.includes(c._id) ? { ...c, isBilled: true } : c));
      setSelectedClaimIds([]);
      setBillMode(false);
      toast.success(`${ids.length} claim${ids.length !== 1 ? 's' : ''} marked as Billed`);
    } catch { toast.error('Failed to mark claims as billed'); }
    finally { setBillingLoading(false); }
  };

  const handleToggleBillStatus = async (claim) => {
    if (!isSuperAdmin || billMode) return;
    const targetIsBilled = !claim.isBilled;
    const ok = await confirm(
      targetIsBilled
        ? `Mark claim of "${claim.patientName}" as Billed?`
        : `Move claim of "${claim.patientName}" back to Pending (Unbilled)?`,
      {
        title: targetIsBilled ? 'Mark as Billed' : 'Move to Pending',
        confirmLabel: targetIsBilled ? 'Mark as Billed' : 'Move to Unbilled',
        variant: 'primary',
      }
    );
    if (!ok) return;
    setBillingLoading(true);
    try {
      await bulkBillAPI([claim._id], targetIsBilled);
      setClaims(prev => prev.map(c => c._id === claim._id ? { ...c, isBilled: targetIsBilled } : c));
      toast.success(targetIsBilled ? 'Claim marked as Billed' : 'Claim moved to Pending (Unbilled)');
    } catch { toast.error('Failed to update bill status'); }
    finally { setBillingLoading(false); }
  };

  const allSelected = claims.length > 0 && claims.every(c => selectedClaimIds.includes(c._id));
  const someSelected = selectedClaimIds.length > 0;
  const toggleSelectAll = () => { if (allSelected) setSelectedClaimIds([]); else setSelectedClaimIds(claims.map(c => c._id)); };
  const toggleClaim = (id) => setSelectedClaimIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  // ── Export helpers ────────────────────────────────────────────────────────

  const groupByHospital = (data = claims) => {
    const byHosp = {};
    data.forEach(c => {
      const hosp = c.isDirectPatient ? 'Direct Patients' : (c.hospital?.name || 'Unknown');
      if (!byHosp[hosp]) byHosp[hosp] = {};
      const mk = c.month ? new Date(c.month).toISOString().slice(0, 7) : '0000-00';
      if (!byHosp[hosp][mk]) byHosp[hosp][mk] = { month: c.month, items: [] };
      byHosp[hosp][mk].items.push(c);
    });
    return Object.entries(byHosp)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hospital, months]) => ({
        hospital,
        monthGroups: Object.values(months).sort((a, b) => (a.month || '').localeCompare(b.month || '')),
      }));
  };

  const monthLabel = (month) => {
    if (!month) return 'CLAIM';
    const d = new Date(month);
    return `CLAIM - ${d.toLocaleString('en', { month: 'short' }).toUpperCase()} - ${d.getFullYear()}`;
  };

  const fmtAmt = (v) => (typeof v === 'number' && v > 0) ? formatCurrency(v) : (v || '-');

  const safeHospitalName = (name) =>
    name.replace(/[^a-zA-Z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 30);

  // ── Excel builder (dynamic fields) ───────────────────────────────────────

  const buildExcelWB = (groups, fields = activeFieldDefs) => {
    const COLS = [{ key: '_sr', label: 'SR', width: 5 }, ...fields];
    const N = COLS.length;
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);

    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    const wsData = [];
    const merges = [];
    const rowMeta = [];

    const grandTotals = {};
    amountIndices.forEach(i => { grandTotals[i] = 0; });
    const firstAmtIdx = amountIndices.length > 0 ? amountIndices[0] : N;

    groups.forEach(({ hospital, monthGroups }) => {
      const hospTotals = {};
      amountIndices.forEach(i => { hospTotals[i] = 0; });

      monthGroups.forEach(({ month, items }) => {
        // Hospital header row
        const rHosp = wsData.length;
        wsData.push([hospital.toUpperCase(), ...Array(N - 1).fill('')]);
        merges.push({ s: { r: rHosp, c: 0 }, e: { r: rHosp, c: N - 1 } });
        rowMeta.push({ row: rHosp, type: 'hospital' });

        // Subtitle row
        const rSub = wsData.length;
        wsData.push([monthLabel(month), ...Array(N - 1).fill('')]);
        merges.push({ s: { r: rSub, c: 0 }, e: { r: rSub, c: N - 1 } });
        rowMeta.push({ row: rSub, type: 'subtitle' });

        // Header row
        wsData.push(COLS.map(f => f.label || 'SR'));
        rowMeta.push({ row: wsData.length - 1, type: 'header' });

        const monthTotals = {};
        amountIndices.forEach(i => { monthTotals[i] = 0; });

        // Data rows
        items.forEach((c, idx) => {
          const row = COLS.map((f, ci) => {
            if (ci === 0) return idx + 1; // SR
            return f.getValue(c);
          });
          amountIndices.forEach(i => { monthTotals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
          rowMeta.push({ row: wsData.length, type: 'data' });
          wsData.push(row);
        });

        amountIndices.forEach(i => { hospTotals[i] += monthTotals[i]; });

        // Monthly total row
        const rTotal = wsData.length;
        const totalRow = Array(N).fill('');
        totalRow[0] = 'TOTAL';
        amountIndices.forEach(i => { totalRow[i] = monthTotals[i]; });
        if (firstAmtIdx > 1) merges.push({ s: { r: rTotal, c: 0 }, e: { r: rTotal, c: firstAmtIdx - 1 } });
        rowMeta.push({ row: rTotal, type: 'total' });
        wsData.push(totalRow);
        wsData.push(Array(N).fill(''));
      });

      if (monthGroups.length > 1) {
        const rSubtotal = wsData.length;
        const subtotalRow = Array(N).fill('');
        subtotalRow[0] = `${hospital.toUpperCase()} SUBTOTAL`;
        amountIndices.forEach(i => { subtotalRow[i] = hospTotals[i]; });
        if (firstAmtIdx > 1) merges.push({ s: { r: rSubtotal, c: 0 }, e: { r: rSubtotal, c: firstAmtIdx - 1 } });
        rowMeta.push({ row: rSubtotal, type: 'subtotal' });
        wsData.push(subtotalRow);
        wsData.push(Array(N).fill(''));
      }

      amountIndices.forEach(i => { grandTotals[i] += hospTotals[i]; });
    });

    if (groups.length > 1) {
      const rGrand = wsData.length;
      const grandRow = Array(N).fill('');
      grandRow[0] = 'GRAND TOTAL';
      amountIndices.forEach(i => { grandRow[i] = grandTotals[i]; });
      if (firstAmtIdx > 1) merges.push({ s: { r: rGrand, c: 0 }, e: { r: rGrand, c: firstAmtIdx - 1 } });
      rowMeta.push({ row: rGrand, type: 'grandtotal' });
      wsData.push(grandRow);
      wsData.push(Array(N).fill(''));
    }

    const rFooter = wsData.length;
    wsData.push(['Prepared by: First Care Consultancy', ...Array(N - 1).fill('')]);
    merges.push({ s: { r: rFooter, c: 0 }, e: { r: rFooter, c: N - 1 } });
    rowMeta.push({ row: rFooter, type: 'footer' });

    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!merges'] = merges;
    ws['!cols'] = COLS.map(f => ({ wch: f.width || 5 }));

    const applyStyle = (r, c, style) => {
      const ref = XLSX.utils.encode_cell({ r, c });
      if (!ws[ref]) ws[ref] = { v: '', t: 's' };
      ws[ref].s = style;
    };

    rowMeta.forEach(({ row, type }) => {
      const styles = {
        hospital: { font: { bold: true, sz: 12, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'center', vertical: 'center' } },
        subtitle:  { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'center', vertical: 'center' }, border },
        header:    { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border },
        footer:    { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'left', vertical: 'center' } },
      };
      for (let c = 0; c < N; c++) {
        const isAmt = amountIndices.includes(c);
        if (type === 'data') {
          applyStyle(row, c, { font: { sz: 9, name: 'Arial' }, alignment: { horizontal: isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'total') {
          applyStyle(row, c, { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'FEF9C3' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'subtotal') {
          applyStyle(row, c, { font: { bold: true, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'FED7AA' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'grandtotal') {
          applyStyle(row, c, { font: { bold: true, sz: 11, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (styles[type]) {
          applyStyle(row, c, styles[type]);
        }
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Claim Report');
    return wb;
  };

  // ── PDF builder (dynamic fields) ─────────────────────────────────────────

  const buildPDFDoc = (groups, fields = activeFieldDefs) => {
    const COLS = [{ key: '_sr', label: 'SR', pdfW: 8 }, ...fields];
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);

    // Auto-promote to A3 landscape when the column-width sum would overflow A4.
    // Only proportionally scale (and shrink font) if A3 still isn't enough.
    const MARGIN_X = 14;
    const rawWidths = COLS.map(f => f.pdfW || 8);
    const rawSum = rawWidths.reduce((s, w) => s + w, 0);
    const A4_AVAILABLE = 297 - MARGIN_X * 2;
    const useA3 = rawSum > A4_AVAILABLE;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: useA3 ? 'a3' : 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const AVAILABLE = pageWidth - MARGIN_X * 2;
    const scale = rawSum > AVAILABLE ? AVAILABLE / rawSum : 1;
    const COL_WIDTHS = rawWidths.map(w => w * scale);
    const TABLE_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);
    const columnStyles = COL_WIDTHS.reduce((acc, w, i) => { acc[i] = { cellWidth: w }; return acc; }, {});

    const headFontSize = scale >= 0.95 ? 8 : scale >= 0.8 ? 7 : 6.5;
    const bodyFontSize = scale >= 0.95 ? 8 : scale >= 0.8 ? 7 : 6.5;
    const cellPadding  = scale >= 0.95 ? 2 : 1.5;

    const today = _formatDate(new Date());
    const totalClaimsCount = groups.reduce((s, g) => s + g.monthGroups.reduce((m, mg) => m + mg.items.length, 0), 0);

    doc.setTextColor(17, 24, 39);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Claim Report', MARGIN_X, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    doc.text(`Generated: ${today}`, pageWidth - MARGIN_X, 14, { align: 'right' });
    doc.text(`${totalClaimsCount} claim${totalClaimsCount !== 1 ? 's' : ''}  •  ${groups.length} hospital${groups.length !== 1 ? 's' : ''}`, pageWidth - MARGIN_X, 19, { align: 'right' });
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, 22, pageWidth - MARGIN_X, 22);
    doc.setTextColor(17, 24, 39);

    let startY = 28;
    const grandTotals = {};
    amountIndices.forEach(i => { grandTotals[i] = 0; });

    const firstAmtIdx = amountIndices.length > 0 ? amountIndices[0] : COLS.length;
    const renderSummaryRow = (label, totalsMap, palette) => {
      if (startY > pageHeight - 30) { doc.addPage(); startY = 14; }
      const base = { fillColor: palette.fill, textColor: palette.text, fontStyle: 'bold', fontSize: palette.fontSize, lineColor: palette.line || [156, 163, 175], lineWidth: palette.lineWidth || 0.3, cellPadding: 2 };
      const summaryRow = [{ content: label, colSpan: Math.max(firstAmtIdx, 1), styles: { ...base, halign: 'right' } }];
      for (let i = firstAmtIdx; i < COLS.length; i++) {
        summaryRow.push(amountIndices.includes(i)
          ? { content: fmtAmt(totalsMap[i] || 0), styles: { ...base, halign: 'right' } }
          : { content: '', styles: { ...base } });
      }

      autoTable(doc, {
        startY,
        body: [summaryRow],
        theme: 'grid',
        columnStyles,
        tableWidth: TABLE_WIDTH,
        margin: { left: MARGIN_X, right: MARGIN_X },
      });
      startY = doc.lastAutoTable.finalY + 4;
    };

    groups.forEach(({ hospital, monthGroups }) => {
      const hospTotals = {};
      amountIndices.forEach(i => { hospTotals[i] = 0; });

      monthGroups.forEach(({ month, items }) => {
        autoTable(doc, {
          startY,
          body: [[hospital.toUpperCase()]],
          theme: 'plain',
          styles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 10, cellPadding: 2.5, halign: 'center' },
          tableWidth: TABLE_WIDTH,
          margin: { left: MARGIN_X, right: MARGIN_X },
        });
        startY = doc.lastAutoTable.finalY;

        autoTable(doc, {
          startY,
          body: [[monthLabel(month)]],
          theme: 'plain',
          styles: { fontStyle: 'bold', fontSize: 9, halign: 'center', cellPadding: 1.2, lineColor: [156, 163, 175], lineWidth: 0.3, fillColor: [243, 244, 246], textColor: [17, 24, 39] },
          tableLineColor: [156, 163, 175], tableLineWidth: 0.3,
          tableWidth: TABLE_WIDTH,
          margin: { left: MARGIN_X, right: MARGIN_X },
        });
        startY = doc.lastAutoTable.finalY;

        const monthTotals = {};
        amountIndices.forEach(i => { monthTotals[i] = 0; });

        const bodyRows = items.map((c, idx) => {
          const row = COLS.map((f, ci) => {
            if (ci === 0) return idx + 1;
            return f.getValue(c);
          });
          amountIndices.forEach(i => { monthTotals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
          return row.map((v, i) => amountIndices.includes(i) ? fmtAmt(v) : (v ?? ''));
        });

        amountIndices.forEach(i => { hospTotals[i] += monthTotals[i]; });

        const totalFill = [243, 244, 246];
        const totalStyles = { halign: 'right', fillColor: totalFill, fontStyle: 'bold', textColor: [17, 24, 39] };
        const totalRowObj = [{ content: 'TOTAL', colSpan: Math.max(firstAmtIdx, 1), styles: totalStyles }];
        for (let i = firstAmtIdx; i < COLS.length; i++) {
          totalRowObj.push(amountIndices.includes(i)
            ? { content: fmtAmt(monthTotals[i]), styles: totalStyles }
            : { content: '', styles: totalStyles });
        }
        bodyRows.push(totalRowObj);

        autoTable(doc, {
          startY,
          head: [COLS.map(f => f.label || 'SR')],
          body: bodyRows,
          theme: 'grid',
          styles: { lineColor: [156, 163, 175], lineWidth: 0.2, overflow: 'linebreak', cellPadding },
          headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: headFontSize, halign: 'center', valign: 'middle', lineColor: [37, 99, 235], lineWidth: 0.3 },
          bodyStyles: { fontSize: bodyFontSize, textColor: [31, 41, 55], lineColor: [209, 213, 219], lineWidth: 0.2, valign: 'middle' },
          columnStyles,
          tableWidth: TABLE_WIDTH,
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index < items.length && amountIndices.includes(data.column.index)) {
              data.cell.styles.halign = 'right';
            }
          },
          margin: { left: MARGIN_X, right: MARGIN_X },
        });
        startY = doc.lastAutoTable.finalY + 4;
        if (startY > pageHeight - 30) { doc.addPage(); startY = 14; }
      });

      if (monthGroups.length > 1) {
        renderSummaryRow(`${hospital.toUpperCase()} SUBTOTAL`, hospTotals, { fontSize: 8, fill: [229, 231, 235], text: [17, 24, 39] });
      }
      amountIndices.forEach(i => { grandTotals[i] += hospTotals[i]; });
      startY += 2;
    });

    if (groups.length > 1) {
      renderSummaryRow('GRAND TOTAL', grandTotals, { fontSize: 9, fill: [37, 99, 235], text: [255, 255, 255], line: [37, 99, 235], lineWidth: 0.5 });
    }

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, startY + 2, pageWidth - MARGIN_X, startY + 2);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(31, 41, 55);
    doc.text('Prepared by: First Care Consultancy', MARGIN_X, startY + 7);

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN_X, pageHeight - 6, { align: 'right' });
    }
    return doc;
  };

  // ── Export runners ────────────────────────────────────────────────────────

  const runExport = async (action, fields) => {
    const dateStr = new Date().toISOString().slice(0, 10);
    const groups = groupByHospital();

    if (action === 'per-excel') {
      if (!groups.length) return;
      if (groups.length === 1) {
        const wb = buildExcelWB(groups, fields);
        XLSX.writeFile(wb, `claim_${safeHospitalName(groups[0].hospital)}_${dateStr}.xlsx`);
        return;
      }
      const zip = new JSZip();
      groups.forEach(({ hospital, monthGroups }) => {
        const wb = buildExcelWB([{ hospital, monthGroups }], fields);
        zip.file(`claim_${safeHospitalName(hospital)}_${dateStr}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `claim_report_${dateStr}.zip` });
      a.click(); URL.revokeObjectURL(a.href);
      return;
    }

    if (action === 'per-pdf') {
      if (!groups.length) return;
      if (groups.length === 1) {
        buildPDFDoc(groups, fields).save(`claim_${safeHospitalName(groups[0].hospital)}_${dateStr}.pdf`);
        return;
      }
      const zip = new JSZip();
      groups.forEach(({ hospital, monthGroups }) => {
        zip.file(`claim_${safeHospitalName(hospital)}_${dateStr}.pdf`, buildPDFDoc([{ hospital, monthGroups }], fields).output('arraybuffer'));
      });
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `claim_report_${dateStr}.zip` });
      a.click(); URL.revokeObjectURL(a.href);
      return;
    }

    // all-excel / all-pdf: fetch fresh
    setLoading(true);
    try {
      const fresh = await fetchClaims();
      setClaims(fresh);
      if (!fresh.length) { toast.info('No claims match the current filters'); return; }
      const freshGroups = groupByHospital(fresh);
      if (action === 'all-excel') {
        XLSX.writeFile(buildExcelWB(freshGroups, fields), `claim_report_all_${dateStr}.xlsx`);
      } else {
        buildPDFDoc(freshGroups, fields).save(`claim_report_all_${dateStr}.pdf`);
      }
    } catch { toast.error('Failed to export'); }
    finally { setLoading(false); }
  };

  const openFieldModal = (action) => {
    setExportMenuOpen(false);
    setFieldModal({ open: true, pendingAction: action });
  };

  const handleModalExport = async (format) => {
    const fields = activeFieldDefs;
    const action = fieldModal.pendingAction.replace(/-(excel|pdf)$/, `-${format}`);
    setFieldModal({ open: false, pendingAction: null });
    await runExport(action, fields);
  };

  // ── Summary ───────────────────────────────────────────────────────────────

  const getFileP = getFilePrice;
  const formatAmount = (a) => a ? formatCurrency(a) : '-';
  const totalBill = claims.reduce((s, c) => s + (c.hospitalFinalBill || 0), 0);
  const totalSettlement = claims.reduce((s, c) => s + (c.bankTransferAmount || 0), 0);
  const totalFilePriceSum = claims.reduce((s, c) => s + getFileP(c), 0);
  const tableColCount = (isHospitalUser ? 9 : 10) + (isSuperAdmin ? 3 : 0) + (billMode ? 1 : 0);

  // ── Field modal helpers ───────────────────────────────────────────────────

  const toggleField = (key) => {
    setSelectedFields(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };
  const selectAllFields = () => setSelectedFields(allFieldDefs.map(f => f.key));
  const deselectAllFields = () => setSelectedFields([]);
  const selectGroupKeys = (keys) => setSelectedFields(prev => Array.from(new Set([...prev, ...keys])));
  const deselectGroupKeys = (keys) => setSelectedFields(prev => prev.filter(k => !keys.includes(k)));
  const closeFieldModal = () => { setFieldModal({ open: false, pendingAction: null }); setFieldSearch(''); };

  const FIELD_GROUPS = [
    { label: 'Patient Info', keys: ['patientName', 'patientMobile', 'isDirectPatient', 'doctorName', 'claimType', 'policyNo', 'clientId'] },
    { label: 'Payor', keys: ['insuranceCompany', 'tpa', 'ccnNo'] },
    { label: 'Treatment', keys: ['treatmentType', 'diagnosis', 'surgeryName'] },
    { label: 'Dates', keys: ['dateOfAdmit', 'dateOfDischarge', 'month', 'fileReceivedDate', 'finalApprovalDate', 'settlementDate'] },
    { label: 'Submission', keys: ['submitMode', 'courierSubmitDate', 'onlineSubmitDate', 'courierCompanyName', 'podNumber'] },
    { label: 'Financials', keys: ['hospitalBill', 'mouDiscount', 'deduction', 'approvalAmt', 'settlement', 'settlementAmountDeduction', 'mouDiscountOnSettlement', 'tds', 'bankTransfer'] },
    { label: 'Other', keys: ['status', 'neftNo', 'remarks', 'rejectedReason', ...(isSuperAdmin ? ['referenceBy', 'filePrice'] : [])] },
  ];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Title row */}
      <div className="flex items-center justify-end mb-1">
        {isSuperAdmin && (
          billMode ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">{selectedClaimIds.length} selected</span>
              <button onClick={handleCancelBillMode} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Cancel</button>
              <button onClick={handleInitialBill} disabled={!someSelected || billingLoading}
                className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {billingLoading ? 'Processing...' : 'Initial Bill'}
              </button>
            </div>
          ) : (
            <button onClick={handleGenerateBill} disabled={loading}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Loading...' : 'Generate Bill'}
            </button>
          )
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 mt-6">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : isSuperAdmin ? 'lg:grid-cols-7' : 'lg:grid-cols-6'}`}>
          {!isHospitalUser && (
            <SearchableSelect
              options={hospitals.map(h => ({ value: h._id, label: h.name }))}
              value={filters.hospital}
              onChange={val => setFilters({ ...filters, hospital: val, directPatient: val ? 'false' : filters.directPatient })}
              placeholder="All Hospitals"
              searchPlaceholder="Search hospitals..."
              allowClear
            />
          )}
          {isSuperAdmin && (
            <SearchableSelect
              options={referenceOptions}
              value={filters.reference}
              onChange={val => setFilters({ ...filters, reference: val, directPatient: val ? 'false' : filters.directPatient })}
              placeholder={referenceOptions.length ? 'All References' : 'No references'}
              searchPlaceholder="Search references..."
              allowClear
            />
          )}
          {!isHospitalUser && (
            <SearchableSelect
              options={[
                { value: 'false', label: 'Hospital Patients' },
                { value: 'true', label: 'Direct Patients' },
              ]}
              value={filters.directPatient}
              onChange={val => setFilters({ ...filters, directPatient: val, hospital: val === 'true' ? '' : filters.hospital, reference: val === 'true' ? '' : filters.reference })}
              placeholder="All Patients"
              searchPlaceholder="Search..."
              allowClear
            />
          )}
          <input type="date" value={filters.dateFrom} onChange={e => setFilters({ ...filters, dateFrom: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          <input type="date" value={filters.dateTo} onChange={e => setFilters({ ...filters, dateTo: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          <SearchableSelect
            options={claimStatuses.map(s => ({ value: s.slug, label: s.label, badgeClass: STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700' }))}
            value={filters.status}
            onChange={val => setFilters({ ...filters, status: val })}
            placeholder="All Status"
            searchPlaceholder="Search status..."
            isLoading={statusesLoading}
            allowClear
          />
          <div className="flex gap-2">
            <button onClick={generateReport} disabled={loading}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Loading...' : 'Generate'}
            </button>
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen(o => !o)}
                disabled={loading}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap h-full"
              >
                <HiOutlineDownload className="w-4 h-4" /> Export <HiChevronDown className={`w-4 h-4 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 w-52 py-1">
                  {isHospitalUser ? (
                    <>
                      <button onClick={() => openFieldModal('per-excel')} disabled={!claims.length}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                      </button>
                      <button onClick={() => openFieldModal('per-pdf')} disabled={!claims.length}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-rose-600" /> PDF
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">All Hospitals (single file)</div>
                      <button onClick={() => openFieldModal('all-excel')} disabled={loading}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                      </button>
                      <button onClick={() => openFieldModal('all-pdf')} disabled={loading}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-rose-600" /> PDF
                      </button>
                      <div className="border-t border-gray-100 my-1" />
                      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Per Hospital (separate files)</div>
                      <button onClick={() => openFieldModal('per-excel')} disabled={!claims.length}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                      </button>
                      <button onClick={() => openFieldModal('per-pdf')} disabled={!claims.length}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50">
                        <HiOutlineDownload className="w-4 h-4 text-rose-600" /> PDF
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {claims.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 mb-6 ${isSuperAdmin ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{claims.length}</p>
            <p className="text-xs text-gray-500">Total Claims</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{formatAmount(totalBill)}</p>
            <p className="text-xs text-gray-500">Total Hospital Bills</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-800">{formatAmount(totalSettlement)}</p>
            <p className="text-xs text-gray-500">Total Bank Transfers</p>
          </div>
          {isSuperAdmin && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
              <p className="text-2xl font-bold text-green-600">{formatAmount(totalFilePriceSum)}</p>
              <p className="text-xs text-gray-500">Total Revenue (File Price)</p>
            </div>
          )}
        </div>
      )}

      {/* Results Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {billMode && (
                  <th className="py-3 px-3 w-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleSelectAll}
                      className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                  </th>
                )}
                {['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', ...(isSuperAdmin ? ['Reference By', 'Bill Status', 'File Price'] : [])].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.length === 0 ? (
                <tr><td colSpan={tableColCount} className="py-8 text-center text-gray-400">
                  {loading ? 'Loading...' : 'Click "Generate" to view report'}
                </td></tr>
              ) : claims.map(c => (
                <tr key={c._id} className={`hover:bg-gray-50 text-sm ${billMode && selectedClaimIds.includes(c._id) ? 'bg-purple-50' : ''}`}>
                  {billMode && (
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selectedClaimIds.includes(c._id)} onChange={() => toggleClaim(c._id)}
                        className="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer" />
                    </td>
                  )}
                  <td className="py-2 px-3 text-gray-500">{c.srNo}</td>
                  <td className="py-2 px-3 font-medium text-gray-800 whitespace-nowrap">{c.patientName}</td>
                  {!isHospitalUser && (
                    <td className="py-2 px-3 text-gray-600 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        <span>{c.hospital?.name || '-'}</span>
                        {c.isDirectPatient && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">Direct</span>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="py-2 px-3 capitalize">{c.claimType}</td>
                  <td className="py-2 px-3">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-2 px-3">{formatAmount(c.finalApprovalAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.settlementAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.tds)}</td>
                  <td className="py-2 px-3">{formatAmount(c.bankTransferAmount)}</td>
                  <td className="py-2 px-3 capitalize">{c.status.replace('_', ' ')}</td>
                  {isSuperAdmin && (
                    <>
                      <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{c.hospital?.referenceBy || '-'}</td>
                      <td className="py-2 px-3">
                        <button
                          type="button"
                          onClick={() => handleToggleBillStatus(c)}
                          disabled={billMode || billingLoading}
                          title={billMode ? '' : (c.isBilled ? 'Click to move back to Pending (Unbilled)' : 'Click to mark as Billed')}
                          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                            c.isBilled ? 'bg-teal-100 text-teal-800 hover:bg-teal-200' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          } ${billMode || billingLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          {c.isBilled ? 'Billed' : 'Unbilled'}
                        </button>
                      </td>
                      <td className="py-2 px-3">{formatAmount(getFileP(c))}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Field Selection Modal */}
      {fieldModal.open && (() => {
        const searchLower = fieldSearch.trim().toLowerCase();
        const matches = (f) => !searchLower || f.label.toLowerCase().includes(searchLower);
        const visibleGroups = FIELD_GROUPS.map(group => {
          const groupFields = allFieldDefs.filter(f => group.keys.includes(f.key));
          const filtered = groupFields.filter(matches);
          return { ...group, groupFields, filtered };
        }).filter(g => g.filtered.length > 0);
        const noResults = !visibleGroups.length;
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900">Select Export Fields</h3>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-semibold">
                    {selectedFields.length} / {allFieldDefs.length} selected
                  </span>
                  <button onClick={selectAllFields} className="text-xs text-primary-600 hover:text-primary-700 font-medium">Select all</button>
                  <span className="text-gray-300 text-xs">·</span>
                  <button onClick={deselectAllFields} className="text-xs text-gray-500 hover:text-gray-700 font-medium">Clear all</button>
                </div>
              </div>
              <button onClick={closeFieldModal}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="relative">
                <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={fieldSearch}
                  onChange={e => setFieldSearch(e.target.value)}
                  placeholder="Search fields..."
                  className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 focus:bg-white transition-colors"
                />
                {fieldSearch && (
                  <button onClick={() => setFieldSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                    <HiOutlineX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Field groups */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
              {noResults && (
                <div className="text-center py-12 text-sm text-gray-500">
                  No fields match "<span className="font-medium text-gray-700">{fieldSearch}</span>"
                </div>
              )}
              {visibleGroups.map(({ label, groupFields, filtered }) => {
                const groupKeys = groupFields.map(f => f.key);
                const selectedInGroup = groupKeys.filter(k => selectedFields.includes(k)).length;
                const allInGroup = selectedInGroup === groupKeys.length && groupKeys.length > 0;
                const toggleGroup = () => allInGroup ? deselectGroupKeys(groupKeys) : selectGroupKeys(groupKeys);
                return (
                  <div key={label}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
                        <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                          {selectedInGroup}/{groupKeys.length}
                        </span>
                      </div>
                      <button onClick={toggleGroup}
                        className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 uppercase tracking-wide">
                        {allInGroup ? 'Clear group' : 'Select group'}
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                      {filtered.map(field => (
                        <label key={field.key}
                          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                            selectedFields.includes(field.key)
                              ? 'border-primary-200 bg-primary-50'
                              : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={selectedFields.includes(field.key)}
                            onChange={() => toggleField(field.key)}
                            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                          />
                          <span className={`text-xs font-medium truncate ${selectedFields.includes(field.key) ? 'text-primary-700' : 'text-gray-600'}`}>
                            {field.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button onClick={closeFieldModal}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium">
                Cancel
              </button>
              <button
                onClick={() => handleModalExport('excel')}
                disabled={!selectedFields.length}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-medium disabled:opacity-50 shadow-sm"
              >
                <HiOutlineDownload className="w-4 h-4" /> Excel
              </button>
              <button
                onClick={() => handleModalExport('pdf')}
                disabled={!selectedFields.length}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-medium disabled:opacity-50 shadow-sm"
              >
                <HiOutlineDownload className="w-4 h-4" /> PDF
              </button>
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
};

export default Reports;
