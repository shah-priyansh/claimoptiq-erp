import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { getClaimsAPI, updateClaimAPI, getHospitalsAPI, getClaimStatusesAPI, exportClaimsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlinePencil, HiOutlineChevronLeft, HiOutlineChevronRight, HiChevronDown, HiCheck, HiOutlineX, HiOutlineDocumentDownload, HiOutlineDownload } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency, calculateFilePrice } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ─── Field definitions (shared with Reports) ─────────────────────────────────
const BASE_FIELD_DEFS = [
  { key: 'patientName',    label: 'PATIENT NAME',          width: 22, pdfW: 28, defaultOn: true,  getValue: c => c.patientName || '' },
  { key: 'doctorName',     label: 'DOCTOR NAME',           width: 20, pdfW: 26, defaultOn: true,  getValue: c => c.doctorName || '' },
  { key: 'claimType',      label: 'CLAIM TYPE',            width: 14, pdfW: 18, defaultOn: true,  getValue: c => c.claimType || '' },
  { key: 'companyTpa',     label: 'COMPANY/TPA',           width: 30, pdfW: 35, defaultOn: true,  getValue: c => [c.insuranceCompany?.name, c.tpa?.name].filter(Boolean).join(' / ') },
  { key: 'ccnNo',          label: 'CCN NO',                width: 13, pdfW: 14, defaultOn: true,  getValue: c => c.ccnNo || '' },
  { key: 'policyNo',       label: 'POLICY NO',             width: 14, pdfW: 15, defaultOn: false, getValue: c => c.policyNo || '' },
  { key: 'clientId',       label: 'CLIENT ID',             width: 14, pdfW: 15, defaultOn: false, getValue: c => c.clientId || '' },
  { key: 'dateOfAdmit',    label: 'D.O.A.',                width: 13, pdfW: 16, defaultOn: true,  getValue: c => c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '' },
  { key: 'dateOfDischarge', label: 'D.O.D.',               width: 13, pdfW: 16, defaultOn: true,  getValue: c => c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '' },
  { key: 'hospitalBill',   label: 'HOSPITAL BILL',         width: 14, pdfW: 22, defaultOn: true,  isAmount: true, getValue: c => c.hospitalFinalBill || 0 },
  { key: 'approvalAmt',    label: 'FINAL APPROVAL AMOUNT', width: 20, pdfW: 26, defaultOn: true,  isAmount: true, getValue: c => c.finalApprovalAmount || 0 },
  { key: 'settlement',     label: 'SETTLEMENT AMOUNT',     width: 18, pdfW: 22, defaultOn: false, isAmount: true, getValue: c => c.settlementAmount || 0 },
  { key: 'tds',            label: 'TDS',                   width: 12, pdfW: 14, defaultOn: false, isAmount: true, getValue: c => c.tds || 0 },
  { key: 'bankTransfer',   label: 'BANK TRANSFER AMOUNT',  width: 18, pdfW: 22, defaultOn: false, isAmount: true, getValue: c => c.bankTransferAmount || 0 },
  { key: 'status',         label: 'STATUS',                width: 18, pdfW: 22, defaultOn: false, getValue: c => (c.status || '').replace(/_/g, ' ') },
];
const SA_FIELD_DEFS = [
  { key: 'referenceBy', label: 'REFERENCE BY', width: 18, pdfW: 28, defaultOn: true, superAdminOnly: true, getValue: c => c.hospital?.referenceBy || '' },
  { key: 'filePrice',   label: 'FILE PRICE',   width: 12, pdfW: 22, defaultOn: true, superAdminOnly: true, isAmount: true, getValue: null },
];
const FIELD_GROUPS = [
  { label: 'Patient Info', keys: ['patientName', 'doctorName', 'claimType', 'policyNo', 'clientId'] },
  { label: 'Payor',        keys: ['companyTpa', 'ccnNo'] },
  { label: 'Dates',        keys: ['dateOfAdmit', 'dateOfDischarge'] },
  { label: 'Financials',   keys: ['hospitalBill', 'approvalAmt', 'settlement', 'tds', 'bankTransfer'] },
  { label: 'Other',        keys: ['status', 'referenceBy', 'filePrice'] },
];

const ClaimList = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { can, user, roleSlug } = useAuth();
  const isSuperAdmin = roleSlug === 'super_admin';
  const isHospitalUser = !!user?.hospital;

  const [claims, setClaims] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [rejectionPending, setRejectionPending] = useState(null);
  const [rejectionInput, setRejectionInput] = useState('');

  const initStatus = new URLSearchParams(location.search).get('status') || '';
  const [filters, setFilters] = useState({
    search: '', hospital: '', status: initStatus, claimType: '', month: '',
    dateFrom: '', dateTo: '', directPatient: '', page: 1,
  });
  const [searchInput, setSearchInput] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters(f => f.search === searchInput ? f : { ...f, search: searchInput, page: 1 });
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Export dropdown + field modal
  const exportMenuRef = useRef(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [fieldModal, setFieldModal] = useState({ open: false, pendingFormat: null });

  const allFieldDefs = isSuperAdmin
    ? [...BASE_FIELD_DEFS, ...SA_FIELD_DEFS.map(f =>
        f.key === 'filePrice'
          ? { ...f, getValue: c => c.filePrice || calculateFilePrice(c.hospital?.billingServices || [], c.hospitalFinalBill || 0, c.finalApprovalAmount || 0) }
          : f
      )]
    : BASE_FIELD_DEFS;

  const defaultSelected = allFieldDefs.filter(f => f.defaultOn).map(f => f.key);
  const [selectedFields, setSelectedFields] = useState(defaultSelected);
  const activeFieldDefs = allFieldDefs.filter(f => selectedFields.includes(f.key));

  const toggleField = (key) => setSelectedFields(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const selectAllFields = () => setSelectedFields(allFieldDefs.map(f => f.key));
  const deselectAllFields = () => setSelectedFields([]);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenuOpen]);

  useEffect(() => {
    const hospitalsP = isHospitalUser
      ? Promise.resolve({ data: [] })
      : getHospitalsAPI({ active: 'true' }).catch(() => ({ data: [] }));
    const statusesP = getClaimStatusesAPI().catch(() => ({ data: [] }));
    Promise.all([hospitalsP, statusesP]).then(([h, s]) => {
      setHospitals(h.data);
      setClaimStatuses(s.data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin)));
    }).finally(() => setFiltersLoading(false));
  }, [isHospitalUser, isSuperAdmin]);

  useEffect(() => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getClaimsAPI(params)
      .then(({ data }) => { setClaims(data.claims); setTotal(data.total); setPages(data.pages); })
      .catch(() => toast.error('Failed to fetch claims'))
      .finally(() => setLoading(false));
  }, [filters]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '-';
  const formatAmount = (a) => a ? formatCurrency(a) : '-';
  const fmtAmt = (v) => (typeof v === 'number' && v > 0) ? formatCurrency(v) : (v || '-');

  // ── Status change ─────────────────────────────────────────────────────────

  const handleStatusChange = async (claimId, newStatus, currentStatus, rejectedReason) => {
    if (newStatus === 'rejected' && rejectedReason === undefined) {
      setRejectionInput('');
      setRejectionPending({ claimId, currentStatus });
      return;
    }
    setUpdatingId(claimId);
    try {
      const extra = newStatus === 'rejected'
        ? { rejectedReason: rejectedReason || '' }
        : currentStatus === 'rejected'
        ? { rejectedReason: '' }
        : {};
      await updateClaimAPI(claimId, { status: newStatus, ...extra });
      setClaims(prev => prev.map(c =>
        c._id === claimId
          ? { ...c, status: newStatus, ...(extra.rejectedReason !== undefined ? { rejectedReason: extra.rejectedReason } : {}) }
          : c
      ));
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleConfirmRejection = () => {
    if (!rejectionInput.trim()) { toast.error('Please enter a rejection reason'); return; }
    const { claimId, currentStatus } = rejectionPending;
    setRejectionPending(null);
    handleStatusChange(claimId, 'rejected', currentStatus, rejectionInput.trim());
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const fetchAllClaims = async () => {
    const params = { limit: 10000 };
    Object.entries(filters).forEach(([k, v]) => { if (v && k !== 'page') params[k] = v; });
    const { data } = await exportClaimsAPI(params);
    return data;
  };

  const groupByHospital = (data, groupByMonth = true) => {
    const byHosp = {};
    data.forEach(c => {
      const hosp = c.isDirectPatient ? 'Direct Patients' : (c.hospital?.name || 'Unknown');
      if (!byHosp[hosp]) byHosp[hosp] = {};
      const mk = groupByMonth
        ? (c.month ? new Date(c.month).toISOString().slice(0, 7) : '0000-00')
        : '_all';
      if (!byHosp[hosp][mk]) byHosp[hosp][mk] = { month: groupByMonth ? c.month : null, items: [] };
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

  // Excel export
  const buildExcel = (data, fields) => {
    const COLS = [{ key: '_sr', label: 'SR', width: 5 }, ...fields];
    const N = COLS.length;
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);
    const nonAmountCount = COLS.filter(f => !f.isAmount).length;
    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };

    const groups = groupByHospital(data, !isHospitalUser);
    const wsData = [];
    const merges = [];
    const rowMeta = [];
    const grandTotals = {};
    amountIndices.forEach(i => { grandTotals[i] = 0; });

    groups.forEach(({ hospital, monthGroups }) => {
      const hospTotals = {};
      amountIndices.forEach(i => { hospTotals[i] = 0; });

      monthGroups.forEach(({ month, items }) => {
        const rHosp = wsData.length;
        wsData.push([hospital.toUpperCase(), ...Array(N - 1).fill('')]);
        merges.push({ s: { r: rHosp, c: 0 }, e: { r: rHosp, c: N - 1 } });
        rowMeta.push({ row: rHosp, type: 'hospital' });

        if (month) {
          const rSub = wsData.length;
          wsData.push([monthLabel(month), ...Array(N - 1).fill('')]);
          merges.push({ s: { r: rSub, c: 0 }, e: { r: rSub, c: N - 1 } });
          rowMeta.push({ row: rSub, type: 'subtitle' });
        }

        wsData.push(COLS.map(f => f.label || 'SR'));
        rowMeta.push({ row: wsData.length - 1, type: 'header' });

        const monthTotals = {};
        amountIndices.forEach(i => { monthTotals[i] = 0; });

        items.forEach((c, idx) => {
          const row = COLS.map((f, ci) => {
            if (ci === 0) return idx + 1;
            return f.getValue(c);
          });
          amountIndices.forEach(i => { monthTotals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
          rowMeta.push({ row: wsData.length, type: 'data' });
          wsData.push(row);
        });

        amountIndices.forEach(i => { hospTotals[i] += monthTotals[i]; });

        const rTotal = wsData.length;
        const totalRow = Array(N).fill('');
        totalRow[0] = 'TOTAL';
        amountIndices.forEach(i => { totalRow[i] = monthTotals[i]; });
        merges.push({ s: { r: rTotal, c: 0 }, e: { r: rTotal, c: nonAmountCount - 1 } });
        rowMeta.push({ row: rTotal, type: 'total' });
        wsData.push(totalRow);
        wsData.push(Array(N).fill(''));
      });

      if (monthGroups.length > 1) {
        const rSub2 = wsData.length;
        const subtotalRow = Array(N).fill('');
        subtotalRow[0] = `${hospital.toUpperCase()} SUBTOTAL`;
        amountIndices.forEach(i => { subtotalRow[i] = hospTotals[i]; });
        merges.push({ s: { r: rSub2, c: 0 }, e: { r: rSub2, c: nonAmountCount - 1 } });
        rowMeta.push({ row: rSub2, type: 'subtotal' });
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
      merges.push({ s: { r: rGrand, c: 0 }, e: { r: rGrand, c: nonAmountCount - 1 } });
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
      for (let c = 0; c < N; c++) {
        const isAmt = amountIndices.includes(c);
        if (type === 'hospital') {
          applyStyle(row, c, { font: { bold: true, sz: 12, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'center', vertical: 'center' } });
        } else if (type === 'subtitle') {
          applyStyle(row, c, { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'center', vertical: 'center' }, border });
        } else if (type === 'header') {
          applyStyle(row, c, { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border });
        } else if (type === 'data') {
          applyStyle(row, c, { font: { sz: 9, name: 'Arial' }, alignment: { horizontal: isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'total') {
          applyStyle(row, c, { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'FEF9C3' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'subtotal') {
          applyStyle(row, c, { font: { bold: true, sz: 10, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'FED7AA' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'grandtotal') {
          applyStyle(row, c, { font: { bold: true, sz: 11, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'footer') {
          applyStyle(row, c, { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'left', vertical: 'center' } });
        }
      }
    });

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Claims');
    return wb;
  };

  // PDF export
  const buildPDF = (data, fields) => {
    const groups = groupByHospital(data, !isHospitalUser);
    const COLS = [{ key: '_sr', label: 'SR', pdfW: 8 }, ...fields];
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);
    const nonAmountCount = COLS.filter(f => !f.isAmount).length;
    const COL_WIDTHS = COLS.map(f => f.pdfW || 8);
    const TABLE_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);
    const columnStyles = COL_WIDTHS.reduce((acc, w, i) => { acc[i] = { cellWidth: w }; return acc; }, {});

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const today = new Date().toLocaleDateString('en-IN');
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const totalCount = data.length;

    doc.setTextColor(17, 24, 39);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Claims Export', 14, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    doc.text(`Generated: ${today}`, pageWidth - 14, 14, { align: 'right' });
    doc.text(`${totalCount} claim${totalCount !== 1 ? 's' : ''}`, pageWidth - 14, 19, { align: 'right' });
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.5);
    doc.line(14, 22, pageWidth - 14, 22);

    let startY = 28;
    const grandTotals = {};
    amountIndices.forEach(i => { grandTotals[i] = 0; });

    const renderSummaryRow = (label, totalsMap, palette) => {
      if (startY > pageHeight - 30) { doc.addPage(); startY = 14; }
      const base = { fillColor: palette.fill, textColor: palette.text, fontStyle: 'bold', fontSize: palette.fontSize, lineColor: palette.line || [156, 163, 175], lineWidth: palette.lineWidth || 0.3, cellPadding: 2 };
      const summaryRow = [
        { content: label, colSpan: nonAmountCount, styles: { ...base, halign: 'right' } },
        ...amountIndices.map(i => ({ content: fmtAmt(totalsMap[i] || 0), styles: { ...base, halign: 'right' } })),
      ];
      autoTable(doc, { startY, body: [summaryRow], theme: 'grid', columnStyles, tableWidth: TABLE_WIDTH, margin: { left: 14, right: 14 } });
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
          margin: { left: 14, right: 14 },
        });
        startY = doc.lastAutoTable.finalY;

        if (month) {
          autoTable(doc, {
            startY,
            body: [[monthLabel(month)]],
            theme: 'plain',
            styles: { fontStyle: 'bold', fontSize: 9, halign: 'center', cellPadding: 1.2, lineColor: [156, 163, 175], lineWidth: 0.3, fillColor: [243, 244, 246], textColor: [17, 24, 39] },
            tableLineColor: [156, 163, 175], tableLineWidth: 0.3,
            tableWidth: TABLE_WIDTH,
            margin: { left: 14, right: 14 },
          });
          startY = doc.lastAutoTable.finalY;
        }

        const monthTotals = {};
        amountIndices.forEach(i => { monthTotals[i] = 0; });

        const bodyRows = items.map((c, idx) => {
          const row = COLS.map((f, ci) => { if (ci === 0) return idx + 1; return f.getValue(c); });
          amountIndices.forEach(i => { monthTotals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
          return row.map((v, i) => amountIndices.includes(i) ? fmtAmt(v) : (v ?? ''));
        });

        amountIndices.forEach(i => { hospTotals[i] += monthTotals[i]; });

        const totalFill = [243, 244, 246];
        bodyRows.push([
          { content: 'TOTAL', colSpan: nonAmountCount, styles: { halign: 'right', fillColor: totalFill, fontStyle: 'bold', textColor: [17, 24, 39] } },
          ...amountIndices.map(i => ({ content: fmtAmt(monthTotals[i]), styles: { halign: 'right', fillColor: totalFill, fontStyle: 'bold', textColor: [17, 24, 39] } })),
        ]);

        autoTable(doc, {
          startY,
          head: [COLS.map(f => f.label || 'SR')],
          body: bodyRows,
          theme: 'grid',
          styles: { lineColor: [156, 163, 175], lineWidth: 0.2 },
          headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7, halign: 'center', lineColor: [37, 99, 235], lineWidth: 0.3 },
          bodyStyles: { fontSize: 7, textColor: [31, 41, 55], lineColor: [209, 213, 219], lineWidth: 0.2 },
          columnStyles,
          tableWidth: TABLE_WIDTH,
          didParseCell: (data) => {
            if (data.section === 'body' && data.row.index < items.length && amountIndices.includes(data.column.index)) {
              data.cell.styles.halign = 'right';
            }
          },
          margin: { left: 14, right: 14 },
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
    doc.line(14, startY + 2, pageWidth - 14, startY + 2);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(31, 41, 55);
    doc.text('Prepared by: First Care Consultancy', 14, startY + 7);

    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(107, 114, 128);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth - 14, pageHeight - 6, { align: 'right' });
    }
    return doc;
  };

  const openFieldModal = (format) => {
    setExportMenuOpen(false);
    setFieldModal({ open: true, pendingFormat: format });
  };

  const handleModalExport = async (format) => {
    setFieldModal({ open: false, pendingFormat: null });
    setExporting(true);
    try {
      const data = await fetchAllClaims();
      if (!data.length) { toast.info('No claims to export'); return; }
      const fields = activeFieldDefs;
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'excel') {
        XLSX.writeFile(buildExcel(data, fields), `claims_${stamp}.xlsx`);
        toast.success(`Exported ${data.length} claim(s)`);
      } else {
        buildPDF(data, fields).save(`claims_${stamp}.pdf`);
        toast.success(`Downloaded PDF — ${data.length} claim(s)`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  // ── Status badge ──────────────────────────────────────────────────────────

  const StatusBadge = ({ c, loading }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);
    const searchRef = useRef(null);

    const st = claimStatuses.find(s => s.slug === c.status);
    const isUpdating = updatingId === c._id;
    const colorCls = STATUS_COLOR_MAP[st?.color] || 'bg-gray-100 text-gray-700';
    const label = st?.label || (c.status || '').replace(/_/g, ' ');

    const filtered = search
      ? claimStatuses.filter(s => s.label.toLowerCase().includes(search.toLowerCase()))
      : claimStatuses;

    const openDrop = (e) => {
      e.stopPropagation();
      const r = btnRef.current.getBoundingClientRect();
      const dropdownHeight = 320;
      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      const openUp = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      const top = openUp ? Math.max(8, r.top - dropdownHeight - 6) : r.bottom + 6;
      const left = Math.min(r.left, window.innerWidth - 232);
      setPos({ top, left });
      setSearch('');
      setIsOpen(true);
      setTimeout(() => searchRef.current?.focus(), 30);
    };

    if (!can('claims', 'edit')) {
      return (
        <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${colorCls}`}>
          {label}
        </span>
      );
    }

    return (
      <div onClick={e => e.stopPropagation()}>
        <button
          ref={btnRef}
          onClick={openDrop}
          disabled={isUpdating}
          className={`inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full text-xs font-semibold transition-opacity ${colorCls} ${isUpdating ? 'opacity-60' : ''}`}
        >
          {isUpdating ? (
            <><div className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" /><span>Saving…</span></>
          ) : (
            <><span>{label}</span><HiChevronDown className="w-3.5 h-3.5 opacity-50" /></>
          )}
        </button>

        {isOpen && ReactDOM.createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div style={{ top: pos.top, left: pos.left }} className="fixed z-50 w-56 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 overflow-hidden">
              <p className="px-4 pt-3 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">Update Status</p>
              <div className="px-3 pb-2">
                <div className="relative">
                  <HiOutlineSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto overscroll-contain border-t border-gray-100">
                {loading ? (
                  <div className="flex items-center justify-center gap-2 py-6">
                    <div className="w-4 h-4 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
                    <span className="text-xs text-gray-400">Loading...</span>
                  </div>
                ) : filtered.length === 0 ? (
                  <p className="px-4 py-4 text-xs text-gray-400 text-center">No results</p>
                ) : filtered.map(s => {
                  const cls = STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700';
                  const isActive = s.slug === c.status;
                  return (
                    <button
                      key={s._id}
                      onClick={() => { handleStatusChange(c._id, s.slug, c.status); setIsOpen(false); }}
                      className={`w-full px-3 py-2 flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                    >
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{s.label}</span>
                      {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </>,
          document.body
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-4 mb-6">
        <div className="flex items-center gap-2">
          {can('claims', 'export') && (
            <div className="relative" ref={exportMenuRef}>
              <button
                onClick={() => setExportMenuOpen(o => !o)}
                disabled={exporting || loading}
                className="flex items-center gap-2 bg-white border border-green-600 text-green-700 hover:bg-green-50 px-4 py-3 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
              >
                <HiOutlineDocumentDownload className="w-5 h-5" />
                {exporting ? 'Exporting…' : 'Export'}
                <HiChevronDown className={`w-4 h-4 transition-transform ${exportMenuOpen ? 'rotate-180' : ''}`} />
              </button>
              {exportMenuOpen && (
                <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 w-44 py-1">
                  <button
                    onClick={() => openFieldModal('excel')}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    <HiOutlineDownload className="w-4 h-4 text-emerald-600" /> Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => openFieldModal('pdf')}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 flex items-center gap-2"
                  >
                    <HiOutlineDownload className="w-4 h-4 text-rose-600" /> PDF
                  </button>
                </div>
              )}
            </div>
          )}
          {can('claims', 'create') && (
            <button onClick={() => navigate('/claims/new')}
              className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg text-sm font-medium">
              <HiOutlinePlus className="w-5 h-5" /> New Claim
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-7'}`}>
          <div className="relative sm:col-span-2">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
            <input
              placeholder="Search patient, policy, CCN..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          {!isHospitalUser && (
            <SearchableSelect
              options={hospitals.map(h => ({ value: h._id, label: h.name }))}
              value={filters.hospital}
              onChange={val => setFilters({ ...filters, hospital: val, directPatient: val ? 'false' : filters.directPatient, page: 1 })}
              placeholder="All Hospitals"
              searchPlaceholder="Search hospitals..."
              isLoading={filtersLoading}
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
              onChange={val => setFilters({ ...filters, directPatient: val, hospital: val === 'true' ? '' : filters.hospital, page: 1 })}
              placeholder="All Patients"
              searchPlaceholder="Search..."
              allowClear
            />
          )}
          <SearchableSelect
            options={claimStatuses.map(s => ({ value: s.slug, label: s.label, badgeClass: STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700' }))}
            value={filters.status}
            onChange={val => setFilters({ ...filters, status: val, page: 1 })}
            placeholder="All Status"
            searchPlaceholder="Search status..."
            isLoading={filtersLoading}
            allowClear
          />
          <SearchableSelect
            options={[
              { value: 'cashless', label: 'Cashless' },
              { value: 'reimbursement', label: 'Reimbursement' },
              { value: 'grievance', label: 'Grievance' },
            ]}
            value={filters.claimType}
            onChange={val => setFilters({ ...filters, claimType: val, page: 1 })}
            placeholder="All Types"
            searchPlaceholder="Search type..."
            allowClear
          />
          <input
            type="date"
            value={filters.dateFrom}
            onChange={e => setFilters({ ...filters, dateFrom: e.target.value, page: 1 })}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-700"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={e => setFilters({ ...filters, dateTo: e.target.value, page: 1 })}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-700"
          />
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Mobile Cards */}
        <div className="md:hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Loading...</div>
          ) : claims.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No claims found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {claims.map((c) => (
                <div key={c._id} className="p-4 active:bg-gray-50 cursor-pointer" onClick={() => navigate(`/claims/${c._id}`)}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{c.patientName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.policyNo || 'No policy number'}</p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <StatusBadge c={c} loading={filtersLoading} />
                      {can('claims', 'edit') && (
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/claims/${c._id}/edit`); }}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    {!isHospitalUser && (
                      <>
                        <span className="font-medium text-gray-600">{c.hospital?.name || '-'}</span>
                        {c.isDirectPatient && <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">Direct</span>}
                        <span>·</span>
                      </>
                    )}
                    <span className="capitalize">{c.claimType}</span>
                    <span>·</span>
                    <span>{formatDate(c.dateOfAdmit)}</span>
                    {c.hospitalFinalBill && (<><span>·</span><span className="font-medium">{formatAmount(c.hospitalFinalBill)}</span></>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">SR</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Patient</th>
                {!isHospitalUser && <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Hospital</th>}
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">DOA</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Bill</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={isHospitalUser ? 7 : 8} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : claims.length === 0 ? (
                <tr><td colSpan={isHospitalUser ? 7 : 8} className="py-8 text-center text-gray-400">No claims found</td></tr>
              ) : claims.map((c) => (
                <tr key={c._id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/claims/${c._id}`)}>
                  <td className="py-3 px-3 text-sm text-gray-500">{c.srNo}</td>
                  <td className="py-3 px-3">
                    <p className="text-sm font-medium text-gray-800">{c.patientName}</p>
                    <p className="text-xs text-gray-400">{c.policyNo || '-'}</p>
                  </td>
                  {!isHospitalUser && (
                    <td className="py-3 px-3 text-sm text-gray-600">
                      <div className="flex items-center gap-1.5">
                        <span>{c.hospital?.name || '-'}</span>
                        {c.isDirectPatient && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700">Direct</span>
                        )}
                      </div>
                    </td>
                  )}
                  <td className="py-3 px-3"><span className="text-xs font-medium capitalize">{c.claimType}</span></td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatDate(c.dateOfAdmit)}</td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-3 px-3"><StatusBadge c={c} loading={filtersLoading} /></td>
                  <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {can('claims', 'edit') && (
                        <button onClick={() => navigate(`/claims/${c._id}/edit`)}
                          className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      )}
                      <button onClick={() => navigate(`/claims/${c._id}`)}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <HiOutlineEye className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200">
            <p className="text-sm text-gray-500">Page {filters.page} of {pages} ({total} claims)</p>
            <div className="flex gap-2">
              <button onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                disabled={filters.page <= 1}
                className="p-2.5 border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">
                <HiOutlineChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                disabled={filters.page >= pages}
                className="p-2.5 border border-gray-300 rounded-lg disabled:opacity-50 hover:bg-gray-50">
                <HiOutlineChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Rejection Reason Modal */}
      {rejectionPending && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-red-500 to-red-400" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <HiOutlineX className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Rejection Reason</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Enter why this claim is being rejected</p>
                </div>
              </div>
              <textarea
                autoFocus
                rows={3}
                value={rejectionInput}
                onChange={e => setRejectionInput(e.target.value)}
                placeholder="Enter rejection reason…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-red-400 resize-none"
              />
              <div className="flex gap-2 mt-4">
                <button onClick={() => setRejectionPending(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button onClick={handleConfirmRejection}
                  className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors">
                  Mark as Rejected
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Field Selection Modal */}
      {fieldModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Select Export Fields</h3>
                <p className="text-xs text-gray-400 mt-0.5">{selectedFields.length} of {allFieldDefs.length} fields selected</p>
              </div>
              <button onClick={() => setFieldModal({ open: false, pendingFormat: null })}
                className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-50">
              <button onClick={selectAllFields} className="text-xs text-primary-600 hover:underline font-medium">Select all</button>
              <span className="text-gray-300">·</span>
              <button onClick={deselectAllFields} className="text-xs text-gray-500 hover:underline font-medium">Deselect all</button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
              {FIELD_GROUPS.map(group => {
                const groupFields = allFieldDefs.filter(f => group.keys.includes(f.key));
                if (!groupFields.length) return null;
                return (
                  <div key={group.label}>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">{group.label}</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {groupFields.map(field => (
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
                          <span className={`text-xs font-medium ${selectedFields.includes(field.key) ? 'text-primary-700' : 'text-gray-600'}`}>
                            {field.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
              <button onClick={() => setFieldModal({ open: false, pendingFormat: null })}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">
                Cancel
              </button>
              <button
                onClick={() => handleModalExport(fieldModal.pendingFormat)}
                disabled={!selectedFields.length}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50 ${
                  fieldModal.pendingFormat === 'pdf'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <HiOutlineDownload className="w-4 h-4" />
                {fieldModal.pendingFormat === 'pdf' ? 'Download PDF' : 'Download Excel'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClaimList;
