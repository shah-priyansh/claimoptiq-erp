import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { getClaimsAPI, updateClaimAPI, getHospitalsAPI, getClaimStatusesAPI, exportClaimsAPI, deleteClaimAPI, deleteAllClaimsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlinePencil, HiOutlineTrash, HiChevronDown, HiCheck, HiOutlineX, HiOutlineDocumentDownload, HiOutlineDownload, HiOutlineUpload, HiOutlinePrinter, HiOutlineDotsVertical } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency, calculateFilePrice, formatDate as _formatDate } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import PaginationBar from '../../components/ui/PaginationBar';
import * as XLSX from 'xlsx-js-style';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ImportClaimsModal from './ImportClaimsModal';

// Claim-type display config — keeps label, dot color, and outlined-tag style in sync.
// Type uses an outlined tag (border + colored dot) so it visually contrasts with
// the solid-filled Status pill that sits in the next column.
export const CLAIM_TYPE_CONFIG = {
  cashless:          { label: 'Cashless',          dotClass: 'bg-green-500',  textClass: 'text-green-700',  borderClass: 'border-green-200'  },
  cashless_anywhere: { label: 'Cashless Anywhere', dotClass: 'bg-teal-500',   textClass: 'text-teal-700',   borderClass: 'border-teal-200'   },
  reimbursement:     { label: 'Reimbursement',     dotClass: 'bg-blue-500',   textClass: 'text-blue-700',   borderClass: 'border-blue-200'   },
  grievance:         { label: 'Grievance',         dotClass: 'bg-orange-500', textClass: 'text-orange-700', borderClass: 'border-orange-200' },
};

const ClaimTypeTag = ({ slug }) => {
  const cfg = CLAIM_TYPE_CONFIG[slug];
  if (!cfg) return <span className="text-xs text-gray-500 capitalize">{(slug || '').replace(/_/g, ' ')}</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-medium bg-white border ${cfg.borderClass} ${cfg.textClass}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
      {cfg.label}
    </span>
  );
};
// Soft-pill style for the filter dropdown only — solid status pills sit far
// from this dropdown, so a coloured fill here doesn't clash with anything.
const CLAIM_TYPE_DROPDOWN_BADGE = {
  cashless:          'bg-green-50 text-green-700',
  cashless_anywhere: 'bg-teal-50 text-teal-700',
  reimbursement:     'bg-blue-50 text-blue-700',
  grievance:         'bg-orange-50 text-orange-700',
};
const CLAIM_TYPE_OPTIONS = Object.entries(CLAIM_TYPE_CONFIG).map(([value, c]) => ({
  value, label: c.label, badgeClass: CLAIM_TYPE_DROPDOWN_BADGE[value],
}));

// ─── Field definitions (shared with Reports) ─────────────────────────────────
// Order here drives the export sequence (Excel + PDF), and matches the columns
// in the operations team's reference workbook so imports/exports stay aligned.
const fmtDateCell = (d) => _formatDate(d, '');
const BASE_FIELD_DEFS = [
  { key: 'month',                     label: 'MONTH',                  width: 12, pdfW: 14, defaultOn: false, getValue: c => c.month || '' },
  { key: 'hospital',                  label: 'HOSPITAL',               width: 26, pdfW: 32, defaultOn: true,  nonHospitalOnly: true, getValue: c => c.isDirectPatient ? (c.hospital?.name ? `${c.hospital.name} (Direct)` : 'Direct Patient') : (c.hospital?.name || '-') },
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
const FIELD_GROUPS = [
  { label: 'Patient Info', keys: ['patientName', 'patientMobile', 'isDirectPatient', 'doctorName', 'claimType', 'policyNo', 'clientId'] },
  { label: 'Hospital',     keys: ['hospital'] },
  { label: 'Payor',        keys: ['insuranceCompany', 'tpa', 'ccnNo'] },
  { label: 'Treatment',    keys: ['treatmentType', 'diagnosis', 'surgeryName'] },
  { label: 'Dates',        keys: ['dateOfAdmit', 'dateOfDischarge', 'month', 'fileReceivedDate', 'finalApprovalDate', 'settlementDate'] },
  { label: 'Submission',   keys: ['submitMode', 'courierSubmitDate', 'onlineSubmitDate', 'courierCompanyName', 'podNumber'] },
  { label: 'Financials',   keys: ['hospitalBill', 'mouDiscount', 'deduction', 'approvalAmt', 'settlement', 'settlementAmountDeduction', 'mouDiscountOnSettlement', 'tds', 'bankTransfer'] },
  { label: 'Other',        keys: ['status', 'neftNo', 'remarks', 'rejectedReason', 'referenceBy', 'filePrice'] },
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
    dateFrom: '', dateTo: '', directPatient: '', reference: '', page: 1, limit: 25,
  });

  // Distinct, sorted referenceBy values from active hospitals (for super-admin filter dropdown)
  const referenceOptions = React.useMemo(() => {
    const seen = new Set();
    hospitals.forEach(h => { if (h.referenceBy && h.referenceBy.trim()) seen.add(h.referenceBy.trim()); });
    return Array.from(seen).sort((a, b) => a.localeCompare(b)).map(r => ({ value: r, label: r }));
  }, [hospitals]);
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
  const [fieldSearch, setFieldSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [stickerMode, setStickerMode] = useState(false);
  const [stickerSelectedIds, setStickerSelectedIds] = useState([]);
  const [stickerPreviewClaims, setStickerPreviewClaims] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteAllOpen, setDeleteAllOpen] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionMenu, setActionMenu] = useState(null); // { id, top?, bottom?, left } | null
  const actionMenuRef = useRef(null);

  const openActionMenu = (e, id) => {
    e.stopPropagation();
    const btn = e.currentTarget;
    const r = btn.getBoundingClientRect();
    const menuWidth = 180;
    const estimatedMenuHeight = 160; // upper bound; only used to pick direction
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < estimatedMenuHeight && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8));
    // Anchor with `top` when opening down, `bottom` when opening up — that way
    // the menu's actual rendered height doesn't shift the alignment.
    setActionMenu(
      openUp
        ? { id, bottom: window.innerHeight - r.top + 4, left }
        : { id, top: r.bottom + 4, left }
    );
  };

  useEffect(() => {
    if (!actionMenu) return;
    const close = (e) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(e.target)) {
        setActionMenu(null);
      }
    };
    const onScroll = () => setActionMenu(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [actionMenu]);

  const allFieldDefs = BASE_FIELD_DEFS
    .filter(f => (!f.superAdminOnly || isSuperAdmin) && (!f.nonHospitalOnly || !isHospitalUser))
    .map(f =>
      f.key === 'filePrice'
        ? { ...f, getValue: c => c.filePrice || calculateFilePrice(c.hospital?.billingServices || [], c.hospitalFinalBill || 0, c.finalApprovalAmount || 0) }
        : f
    );

  const defaultSelected = allFieldDefs.filter(f => f.defaultOn).map(f => f.key);
  const [selectedFields, setSelectedFields] = useState(defaultSelected);
  const activeFieldDefs = allFieldDefs.filter(f => selectedFields.includes(f.key));

  const toggleField = (key) => setSelectedFields(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  const selectAllFields = () => setSelectedFields(allFieldDefs.map(f => f.key));
  const deselectAllFields = () => setSelectedFields([]);
  const selectGroupKeys = (keys) => setSelectedFields(prev => Array.from(new Set([...prev, ...keys])));
  const deselectGroupKeys = (keys) => setSelectedFields(prev => prev.filter(k => !keys.includes(k)));
  const closeFieldModal = () => { setFieldModal({ open: false, pendingFormat: null }); setFieldSearch(''); };

  const toggleStickerSelect = (id) => setStickerSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const openStickerPreview = (claimsToPrint) => setStickerPreviewClaims(claimsToPrint);
  const closeStickerPreview = () => setStickerPreviewClaims(null);

  useEffect(() => {
    if (!exportMenuOpen) return;
    const handler = (e) => { if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) setExportMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [exportMenuOpen]);

  useEffect(() => {
    const hospitalsP = isHospitalUser
      ? Promise.resolve({ data: [] })
      : getHospitalsAPI({ all: 'true', active: 'true' }).catch(() => ({ data: [] }));
    const statusesP = getClaimStatusesAPI().catch(() => ({ data: [] }));
    Promise.all([hospitalsP, statusesP]).then(([h, s]) => {
      setHospitals(h.data);
      setClaimStatuses(s.data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin)));
    }).finally(() => setFiltersLoading(false));
  }, [isHospitalUser, isSuperAdmin]);

  // Skip the count query on page/limit changes — total only changes when actual
  // filters change. Tracks the last filter-key for which a count was fetched.
  // Falling back to count when total is still 0 keeps the initial load correct
  // even when React strict mode fires the effect twice.
  const filterKey = JSON.stringify({
    search: filters.search, hospital: filters.hospital, status: filters.status,
    claimType: filters.claimType, month: filters.month, dateFrom: filters.dateFrom,
    dateTo: filters.dateTo, directPatient: filters.directPatient, reference: filters.reference,
  });
  const lastCountedKeyRef = useRef(null);

  useEffect(() => {
    setLoading(true);
    const needsCount = total === 0 || lastCountedKeyRef.current !== filterKey;

    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    if (!needsCount) params.skipCount = 'true';

    getClaimsAPI(params)
      .then(({ data }) => {
        setClaims(data.claims);
        if (data.total !== null && data.total !== undefined) {
          setTotal(data.total);
          setPages(data.pages);
          lastCountedKeyRef.current = filterKey;
        } else {
          setPages(prev => Math.max(1, Math.ceil(total / (filters.limit || 25)) || prev));
        }
      })
      .catch(() => toast.error('Failed to fetch claims'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, refreshKey]);

  const formatDate = (d) => _formatDate(d);
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

  // ── Delete ────────────────────────────────────────────────────────────────

  const handleDeleteClaim = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteClaimAPI(deleteTarget._id);
      toast.success('Claim deleted');
      setDeleteTarget(null);
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete claim');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteAll = async () => {
    if (deleteAllConfirm.trim() !== 'DELETE ALL') {
      toast.error('Type DELETE ALL to confirm');
      return;
    }
    setDeleting(true);
    try {
      const { data } = await deleteAllClaimsAPI();
      toast.success(data?.message || 'All claims deleted');
      setDeleteAllOpen(false);
      setDeleteAllConfirm('');
      setRefreshKey(k => k + 1);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete claims');
    } finally {
      setDeleting(false);
    }
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

  // Excel export — flat list (no hospital grouping) for non-hospital users
  const buildExcelFlat = (data, fields) => {
    const COLS = [{ key: '_sr', label: 'SR', width: 5 }, ...fields];
    const N = COLS.length;
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);
    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };

    const wsData = [];
    const merges = [];
    const rowMeta = [];

    // Title
    wsData.push([`Claims Export — ${data.length} record(s)`, ...Array(N - 1).fill('')]);
    merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: N - 1 } });
    rowMeta.push({ row: 0, type: 'titlebar' });

    // Header
    wsData.push(COLS.map(f => f.label || 'SR'));
    rowMeta.push({ row: wsData.length - 1, type: 'header' });

    const totals = {};
    amountIndices.forEach(i => { totals[i] = 0; });

    data.forEach((c, idx) => {
      const row = COLS.map((f, ci) => (ci === 0 ? (isHospitalUser ? idx + 1 : (c.srNo || idx + 1)) : f.getValue(c)));
      amountIndices.forEach(i => { totals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
      rowMeta.push({ row: wsData.length, type: 'data' });
      wsData.push(row);
    });

    if (data.length > 0 && amountIndices.length > 0) {
      const rTotal = wsData.length;
      const totalRow = Array(N).fill('');
      totalRow[0] = 'GRAND TOTAL';
      amountIndices.forEach(i => { totalRow[i] = totals[i]; });
      const firstAmtIdx = amountIndices[0];
      if (firstAmtIdx > 1) merges.push({ s: { r: rTotal, c: 0 }, e: { r: rTotal, c: firstAmtIdx - 1 } });
      rowMeta.push({ row: rTotal, type: 'grandtotal' });
      wsData.push(totalRow);
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
        if (type === 'titlebar') {
          applyStyle(row, c, { font: { bold: true, sz: 12, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } }, alignment: { horizontal: 'center', vertical: 'center' } });
        } else if (type === 'header') {
          applyStyle(row, c, { font: { bold: true, sz: 9, name: 'Arial' }, fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border });
        } else if (type === 'data') {
          applyStyle(row, c, { font: { sz: 9, name: 'Arial' }, alignment: { horizontal: isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'grandtotal') {
          applyStyle(row, c, { font: { bold: true, sz: 11, name: 'Arial', color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } }, alignment: { horizontal: c === 0 ? 'center' : isAmt ? 'right' : 'left', vertical: 'center' }, border });
        } else if (type === 'footer') {
          applyStyle(row, c, { font: { bold: true, sz: 10, name: 'Arial' }, alignment: { horizontal: 'left', vertical: 'center' } });
        }
      }
    });
    ws['!rows'] = [{ hpt: 22 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Claims');
    return wb;
  };

  // Excel export
  const buildExcel = (data, fields) => {
    // Non-hospital users (super admin / admin / staff) get a flat list across all hospitals
    if (!isHospitalUser) return buildExcelFlat(data, fields);

    const COLS = [{ key: '_sr', label: 'SR', width: 5 }, ...fields];
    const N = COLS.length;
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);
    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };

    const groups = groupByHospital(data, !isHospitalUser);
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
            if (ci === 0) return isHospitalUser ? idx + 1 : (c.srNo || idx + 1);
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
        if (firstAmtIdx > 1) merges.push({ s: { r: rTotal, c: 0 }, e: { r: rTotal, c: firstAmtIdx - 1 } });
        rowMeta.push({ row: rTotal, type: 'total' });
        wsData.push(totalRow);
        wsData.push(Array(N).fill(''));
      });

      if (monthGroups.length > 1) {
        const rSub2 = wsData.length;
        const subtotalRow = Array(N).fill('');
        subtotalRow[0] = `${hospital.toUpperCase()} SUBTOTAL`;
        amountIndices.forEach(i => { subtotalRow[i] = hospTotals[i]; });
        if (firstAmtIdx > 1) merges.push({ s: { r: rSub2, c: 0 }, e: { r: rSub2, c: firstAmtIdx - 1 } });
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

  // PDF export — flat list (no hospital grouping) for non-hospital users
  const buildPDFFlat = (data, fields) => {
    const COLS = [{ key: '_sr', label: 'SR', pdfW: 8 }, ...fields];
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);

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
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Claims Export', MARGIN_X, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(75, 85, 99);
    doc.text(`Generated: ${today}`, pageWidth - MARGIN_X, 14, { align: 'right' });
    doc.text(`${data.length} claim${data.length !== 1 ? 's' : ''}`, pageWidth - MARGIN_X, 19, { align: 'right' });
    doc.setDrawColor(17, 24, 39);
    doc.setLineWidth(0.5);
    doc.line(MARGIN_X, 22, pageWidth - MARGIN_X, 22);

    const totals = {};
    amountIndices.forEach(i => { totals[i] = 0; });

    const bodyRows = data.map((c, idx) => {
      const row = COLS.map((f, ci) => (ci === 0 ? (isHospitalUser ? idx + 1 : (c.srNo || idx + 1)) : f.getValue(c)));
      amountIndices.forEach(i => { totals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
      return row.map((v, i) => amountIndices.includes(i) ? fmtAmt(v) : (v ?? ''));
    });

    if (data.length > 0 && amountIndices.length > 0) {
      const firstAmtIdx = amountIndices[0];
      const totalStyles = { halign: 'right', fillColor: [30, 58, 138], fontStyle: 'bold', textColor: [255, 255, 255] };
      const grandRow = [{ content: 'GRAND TOTAL', colSpan: firstAmtIdx, styles: totalStyles }];
      for (let i = firstAmtIdx; i < COLS.length; i++) {
        grandRow.push(amountIndices.includes(i)
          ? { content: fmtAmt(totals[i]), styles: totalStyles }
          : { content: '', styles: totalStyles });
      }
      bodyRows.push(grandRow);
    }

    autoTable(doc, {
      startY: 28,
      head: [COLS.map(f => f.label || 'SR')],
      body: bodyRows,
      theme: 'grid',
      styles: { lineColor: [156, 163, 175], lineWidth: 0.2, overflow: 'linebreak', cellPadding },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: headFontSize, halign: 'center', valign: 'middle', lineColor: [37, 99, 235], lineWidth: 0.3 },
      bodyStyles: { fontSize: bodyFontSize, textColor: [31, 41, 55], lineColor: [209, 213, 219], lineWidth: 0.2, valign: 'middle' },
      columnStyles,
      tableWidth: TABLE_WIDTH,
      didParseCell: (d) => {
        if (d.section === 'body' && d.row.index < data.length && amountIndices.includes(d.column.index)) {
          d.cell.styles.halign = 'right';
        }
      },
      margin: { left: MARGIN_X, right: MARGIN_X },
    });

    const endY = doc.lastAutoTable.finalY + 4;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(MARGIN_X, endY, pageWidth - MARGIN_X, endY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(31, 41, 55);
    doc.text('Prepared by: First Care Consultancy', MARGIN_X, endY + 5);

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

  // PDF export
  const buildPDF = (data, fields) => {
    // Non-hospital users (super admin / admin / staff) get a flat list across all hospitals
    if (!isHospitalUser) return buildPDFFlat(data, fields);

    const groups = groupByHospital(data, !isHospitalUser);
    const COLS = [{ key: '_sr', label: 'SR', pdfW: 8 }, ...fields];
    const amountIndices = COLS.map((f, i) => f.isAmount ? i : -1).filter(i => i >= 0);

    // Choose page size based on how many columns are selected.
    // A4 landscape (≈269mm usable) fits ~6 fields; A3 landscape (≈392mm usable) fits everything.
    // Only scale down if even A3 isn't enough.
    const MARGIN_X = 14;
    const rawWidths = COLS.map(f => f.pdfW || 8);
    const rawSum = rawWidths.reduce((s, w) => s + w, 0);
    const A4_AVAILABLE = 297 - MARGIN_X * 2; // 269mm
    const useA3 = rawSum > A4_AVAILABLE;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: useA3 ? 'a3' : 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const AVAILABLE = pageWidth - MARGIN_X * 2;
    const scale = rawSum > AVAILABLE ? AVAILABLE / rawSum : 1;
    const COL_WIDTHS = rawWidths.map(w => w * scale);
    const TABLE_WIDTH = COL_WIDTHS.reduce((s, w) => s + w, 0);
    const columnStyles = COL_WIDTHS.reduce((acc, w, i) => {
      acc[i] = { cellWidth: w };
      return acc;
    }, {});

    // Font stays readable since A3 absorbs the overflow; only shrink if we still had to scale.
    const headFontSize = scale >= 0.95 ? 8 : scale >= 0.8 ? 7 : 6.5;
    const bodyFontSize = scale >= 0.95 ? 8 : scale >= 0.8 ? 7 : 6.5;
    const cellPadding  = scale >= 0.95 ? 2 : 1.5;

    const today = _formatDate(new Date());
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
          const row = COLS.map((f, ci) => { if (ci === 0) return isHospitalUser ? idx + 1 : (c.srNo || idx + 1); return f.getValue(c); });
          amountIndices.forEach(i => { monthTotals[i] += (typeof row[i] === 'number' ? row[i] : 0); });
          return row.map((v, i) => amountIndices.includes(i) ? fmtAmt(v) : (v ?? ''));
        });

        amountIndices.forEach(i => { hospTotals[i] += monthTotals[i]; });

        const totalFill = [243, 244, 246];
        const totalStyles = { halign: 'right', fillColor: totalFill, fontStyle: 'bold', textColor: [17, 24, 39] };
        const monthTotalRow = [{ content: 'TOTAL', colSpan: Math.max(firstAmtIdx, 1), styles: totalStyles }];
        for (let i = firstAmtIdx; i < COLS.length; i++) {
          monthTotalRow.push(amountIndices.includes(i)
            ? { content: fmtAmt(monthTotals[i]), styles: totalStyles }
            : { content: '', styles: totalStyles });
        }
        bodyRows.push(monthTotalRow);

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
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <div className="relative flex-1 sm:max-w-md">
          <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
          <input
            placeholder="Search SR, patient, policy, CCN..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full pl-9 pr-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          {can('claims', 'create') && (
            <button
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 bg-white border border-primary-600 text-primary-700 hover:bg-primary-50 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              <HiOutlineUpload className="w-5 h-5" />
              Import
            </button>
          )}
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
          {can('claims', 'delete') && total > 0 && (
            <button
              onClick={() => { setDeleteAllConfirm(''); setDeleteAllOpen(true); }}
              className="flex items-center gap-2 bg-white border border-red-600 text-red-700 hover:bg-red-50 px-4 py-3 rounded-lg text-sm font-medium transition-colors"
            >
              <HiOutlineTrash className="w-5 h-5" />
              Delete All
            </button>
          )}
          <button
            onClick={() => {
              setStickerMode(m => {
                if (m) setStickerSelectedIds([]);
                return !m;
              });
            }}
            className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-colors border ${
              stickerMode
                ? 'bg-indigo-600 border-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-white border-indigo-600 text-indigo-700 hover:bg-indigo-50'
            }`}
          >
            <HiOutlinePrinter className="w-5 h-5" />
            {stickerMode ? 'Done' : 'Print Stickers'}
          </button>
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
        <div className={`grid grid-cols-2 gap-2.5 ${isHospitalUser ? 'md:grid-cols-4' : isSuperAdmin ? 'md:grid-cols-3 lg:grid-cols-7' : 'md:grid-cols-3 lg:grid-cols-6'}`}>
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
              onChange={val => setFilters({ ...filters, directPatient: val, hospital: val === 'true' ? '' : filters.hospital, reference: val === 'true' ? '' : filters.reference, page: 1 })}
              placeholder="All Patients"
              searchPlaceholder="Search..."
              allowClear
            />
          )}
          {isSuperAdmin && (
            <SearchableSelect
              options={referenceOptions}
              value={filters.reference}
              onChange={val => setFilters({ ...filters, reference: val, directPatient: val ? 'false' : filters.directPatient, page: 1 })}
              placeholder={referenceOptions.length ? 'All References' : 'No references'}
              searchPlaceholder="Search references..."
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
            options={CLAIM_TYPE_OPTIONS}
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
                <div key={c._id}
                  className={`p-4 active:bg-gray-50 cursor-pointer ${stickerMode && stickerSelectedIds.includes(c._id) ? 'bg-indigo-50' : ''}`}
                  onClick={() => stickerMode ? toggleStickerSelect(c._id) : navigate(`/claims/${c._id}`)}>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="flex items-start gap-2 min-w-0">
                      {stickerMode && (
                        <input type="checkbox" checked={stickerSelectedIds.includes(c._id)} onChange={() => toggleStickerSelect(c._id)}
                          onClick={e => e.stopPropagation()}
                          className="mt-1 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                      )}
                      <div className="min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{c.patientName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{c.policyNo || 'No policy number'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      <StatusBadge c={c} loading={filtersLoading} />
                      <button
                        onClick={(e) => openActionMenu(e, c._id)}
                        title="More actions"
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                        <HiOutlineDotsVertical className="w-4 h-4" />
                      </button>
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
                    <ClaimTypeTag slug={c.claimType} />
                    <span>·</span>
                    <span>{formatDate(c.dateOfAdmit)}</span>
                    {c.hospitalFinalBill && (<><span>·</span><span className="font-medium">{formatAmount(c.hospitalFinalBill)}</span></>)}
                  </div>
                  {(c.tpa?.name || c.insuranceCompany?.name) && (
                    <p className="text-[11px] text-gray-400 mt-1 truncate">
                      {c.tpa?.name || c.insuranceCompany?.name}
                    </p>
                  )}
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
              ) : claims.map((c, rowIdx) => (
                <tr key={c._id}
                  className={`hover:bg-gray-50 cursor-pointer ${stickerMode && stickerSelectedIds.includes(c._id) ? 'bg-indigo-50 hover:bg-indigo-50' : ''}`}
                  onClick={() => stickerMode ? toggleStickerSelect(c._id) : navigate(`/claims/${c._id}`)}>
                  <td className="py-3 px-3 text-sm text-gray-500">
                    {stickerMode ? (
                      <input type="checkbox" checked={stickerSelectedIds.includes(c._id)}
                        onChange={() => toggleStickerSelect(c._id)} onClick={e => e.stopPropagation()}
                        className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                    ) : (isHospitalUser ? rowIdx + 1 : c.srNo)}
                  </td>
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
                      {(c.tpa?.name || c.insuranceCompany?.name) && (
                        <p className="text-xs text-gray-400 mt-0.5 truncate">
                          {c.tpa?.name || c.insuranceCompany?.name}
                        </p>
                      )}
                    </td>
                  )}
                  <td className="py-3 px-3"><ClaimTypeTag slug={c.claimType} /></td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatDate(c.dateOfAdmit)}</td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-3 px-3"><StatusBadge c={c} loading={filtersLoading} /></td>
                  <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => navigate(`/claims/${c._id}`)}
                        title="View claim"
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <HiOutlineEye className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => openActionMenu(e, c._id)}
                        title="More actions"
                        className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors">
                        <HiOutlineDotsVertical className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <PaginationBar
          page={filters.page}
          pages={pages}
          total={total}
          pageSize={filters.limit}
          onPageChange={p => setFilters({ ...filters, page: p })}
          onPageSizeChange={n => setFilters({ ...filters, limit: n, page: 1 })}
          label="claims"
        />
      </div>

      {/* Row Actions Portal Menu — escapes table overflow */}
      {actionMenu && ReactDOM.createPortal(
        (() => {
          const c = claims.find(x => x._id === actionMenu.id);
          if (!c) return null;
          return (
            <div
              ref={actionMenuRef}
              style={{
                position: 'fixed',
                left: actionMenu.left,
                width: 180,
                ...(actionMenu.top !== undefined ? { top: actionMenu.top } : { bottom: actionMenu.bottom }),
              }}
              className="bg-white border border-gray-200 rounded-lg shadow-lg z-[60] py-1"
            >
              <button
                onClick={() => { setActionMenu(null); openStickerPreview([c]); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlinePrinter className="w-4 h-4 text-indigo-600" />
                Print Sticker
              </button>
              {can('claims', 'edit') && (
                <button
                  onClick={() => { setActionMenu(null); navigate(`/claims/${c._id}?tab=admission`); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <HiOutlinePencil className="w-4 h-4 text-primary-600" />
                  Edit Admission
                </button>
              )}
              {can('claims', 'delete') && (
                <>
                  <div className="my-1 border-t border-gray-100" />
                  <button
                    onClick={() => { setActionMenu(null); setDeleteTarget(c); }}
                    className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                    <HiOutlineTrash className="w-4 h-4" />
                    Delete Claim
                  </button>
                </>
              )}
            </div>
          );
        })(),
        document.body
      )}

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

      {/* Single claim delete confirmation */}
      {deleteTarget && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-red-500 to-red-400" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <HiOutlineTrash className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Delete claim?</h3>
                  <p className="text-xs text-gray-400 mt-0.5">This permanently removes the claim and all its documents.</p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                Patient: <span className="font-semibold text-gray-900">{deleteTarget.patientName}</span>
                {deleteTarget.policyNo ? <> · Policy: <span className="font-mono">{deleteTarget.policyNo}</span></> : null}
              </p>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleDeleteClaim}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Delete all claims confirmation */}
      {deleteAllOpen && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-red-600 to-red-500" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <HiOutlineTrash className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Delete all claims?</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    This wipes every claim {isHospitalUser ? "for your hospital" : "in the system"} along with documents, history, and notifications.
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600 mb-2">
                Type <span className="font-mono font-bold text-red-600">DELETE ALL</span> to confirm:
              </p>
              <input
                autoFocus
                value={deleteAllConfirm}
                onChange={e => setDeleteAllConfirm(e.target.value)}
                placeholder="DELETE ALL"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-red-400"
              />
              <div className="flex gap-2 mt-5">
                <button onClick={() => { setDeleteAllOpen(false); setDeleteAllConfirm(''); }}
                  disabled={deleting}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={handleDeleteAll}
                  disabled={deleting || deleteAllConfirm.trim() !== 'DELETE ALL'}
                  className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-sm font-semibold transition-colors disabled:opacity-50">
                  {deleting ? 'Deleting…' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Import Claims Modal */}
      <ImportClaimsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => setRefreshKey(k => k + 1)}
      />

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
                onClick={() => handleModalExport(fieldModal.pendingFormat)}
                disabled={!selectedFields.length}
                className={`flex items-center gap-1.5 px-4 py-2 text-sm text-white rounded-lg font-medium disabled:opacity-50 shadow-sm ${
                  fieldModal.pendingFormat === 'pdf'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
              >
                <HiOutlineDownload className="w-4 h-4" />
                {fieldModal.pendingFormat === 'pdf' ? 'PDF' : 'Excel'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Sticker mode hint banner */}
      {stickerMode && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-40 bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-2 rounded-full shadow-md text-sm font-medium flex items-center gap-2">
          <HiOutlinePrinter className="w-4 h-4" />
          {stickerSelectedIds.length === 0
            ? 'Tap rows to select claims, then click Print at the bottom.'
            : `${stickerSelectedIds.length} claim${stickerSelectedIds.length > 1 ? 's' : ''} selected.`}
        </div>
      )}

      {/* Sticker mode floating action bar */}
      {stickerMode && stickerSelectedIds.length > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-gray-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-medium">{stickerSelectedIds.length} selected</span>
          <button onClick={() => setStickerSelectedIds([])}
            className="text-xs text-gray-300 hover:text-white">Clear</button>
          <div className="h-5 w-px bg-gray-700" />
          <button onClick={() => openStickerPreview(claims.filter(c => stickerSelectedIds.includes(c._id)))}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium">
            <HiOutlinePrinter className="w-4 h-4" /> Print {stickerSelectedIds.length} Sticker{stickerSelectedIds.length > 1 ? 's' : ''}
          </button>
        </div>
      )}

      {/* Courier sticker preview / print modal */}
      {stickerPreviewClaims && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:bg-white print:p-0 print:static print:block">
          <style>{`
            @media print {
              @page { size: A4 portrait; margin: 10mm; }
              body * { visibility: hidden !important; }
              #courier-stickers-print, #courier-stickers-print * { visibility: visible !important; }
              #courier-stickers-print {
                position: absolute !important;
                left: 0 !important; top: 0 !important;
                width: 100% !important;
                max-height: none !important;
                overflow: visible !important;
                padding: 0 !important;
                background: white !important;
              }
              #courier-stickers-print .sticker-stack { gap: 6mm !important; padding: 0 !important; background: white !important; }
              #courier-stickers-print .sticker-card {
                width: 100% !important;
                box-sizing: border-box !important;
                break-inside: avoid !important;
                page-break-inside: avoid !important;
                box-shadow: none !important;
                border: 2px solid #111 !important;
                border-radius: 4px !important;
                background: white !important;
              }
            }
          `}</style>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] print:rounded-none print:shadow-none print:max-w-full print:max-h-full">
            {(() => {
              // Group claims by recipient (TPA takes priority, else insurance company)
              // and by sender so a single sticker carries one TO + one FROM with all
              // claim/patient rows for that combination listed below.
              const groups = [];
              const byKey = new Map();
              for (const c of stickerPreviewClaims) {
                const recipient = c.tpa?.name
                  ? { label: 'TPA', name: c.tpa.name, address: c.tpa.address, mobile: c.tpa.mobile, key: `tpa:${c.tpa._id || c.tpa.id || c.tpa.name}` }
                  : { label: 'Insurance Company', name: c.insuranceCompany?.name, address: c.insuranceCompany?.address, mobile: c.insuranceCompany?.mobile, key: `ic:${c.insuranceCompany?._id || c.insuranceCompany?.id || c.insuranceCompany?.name || 'none'}` };
                const sender = c.isDirectPatient
                  ? { name: 'Direct Patient', address: '', phone: '', key: 'direct' }
                  : { name: c.hospital?.name, address: c.hospital?.address, phone: c.hospital?.phone, key: `h:${c.hospital?._id || c.hospital?.id || c.hospital?.name || 'none'}` };
                const groupKey = `${recipient.key}|${sender.key}`;
                let g = byKey.get(groupKey);
                if (!g) {
                  g = { recipient, sender, claims: [] };
                  byKey.set(groupKey, g);
                  groups.push(g);
                }
                g.claims.push(c);
              }
              const totalStickers = groups.length;
              return (
                <>
                  <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 print:hidden">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">Courier Stickers</h3>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {totalStickers} sticker{totalStickers > 1 ? 's' : ''} for {stickerPreviewClaims.length} claim{stickerPreviewClaims.length > 1 ? 's' : ''} · A4 portrait · stacked vertically
                      </p>
                    </div>
                    <button onClick={closeStickerPreview}
                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                      <HiOutlineX className="w-5 h-5" />
                    </button>
                  </div>

                  <div id="courier-stickers-print" className="overflow-y-auto flex-1 px-6 py-5 font-sans text-gray-900 bg-gray-100">
                    <div className="sticker-stack flex flex-col gap-5">
                      {groups.map((g, gi) => {
                        const { recipient, sender, claims } = g;
                        return (
                          <div key={gi} className="sticker-card bg-white border-2 border-gray-900 rounded-lg shadow-sm overflow-hidden">
                            <div className="p-4 space-y-3">
                              <div>
                                <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">TO · {recipient.label}</p>
                                <p className="text-lg font-extrabold leading-tight text-gray-900">{recipient.name || '—'}</p>
                                {recipient.address && (
                                  <p className="mt-1 text-sm leading-snug whitespace-pre-line text-gray-700">{recipient.address}</p>
                                )}
                                {recipient.mobile && (
                                  <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Mobile:</span> {recipient.mobile}</p>
                                )}
                              </div>

                              <div className="border-t-2 border-dashed border-gray-400" />

                              <div>
                                <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">FROM</p>
                                <p className="text-sm font-bold leading-tight text-gray-900">{sender.name || '—'}</p>
                                {sender.address && (
                                  <p className="mt-0.5 text-xs leading-snug whitespace-pre-line text-gray-600">{sender.address}</p>
                                )}
                                {sender.phone && (
                                  <p className="mt-0.5 text-xs text-gray-600">M: {sender.phone}</p>
                                )}
                              </div>

                              <div className="border-t-2 border-dashed border-gray-400" />

                              <div>
                                <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">
                                  CLAIM{claims.length > 1 ? `S · ${claims.length}` : ''}
                                </p>
                                <div className="divide-y divide-gray-200">
                                  {claims.map((c, ci) => {
                                    const claimNo = c.ccnNo || (c.monthClaimNo ? `M${c.monthClaimNo}` : (c._id?.slice(-8).toUpperCase() || ''));
                                    return (
                                      <div key={c._id} className={`grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 ${ci === 0 ? 'pt-0' : 'pt-1.5'} ${ci === claims.length - 1 ? 'pb-0' : 'pb-1.5'}`}>
                                        <p className="text-sm text-gray-900"><span className="font-semibold">Patient:</span> {c.patientName || '—'}</p>
                                        <p className="text-sm text-gray-900"><span className="font-semibold">Claim No:</span> <span className="font-mono">{claimNo || '—'}</span></p>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              );
            })()}

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl print:hidden">
              <button onClick={closeStickerPreview}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium">
                Close
              </button>
              <button onClick={() => window.print()}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium shadow-sm">
                <HiOutlinePrinter className="w-4 h-4" /> Print
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ClaimList;
