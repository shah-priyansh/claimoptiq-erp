import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { getClaimsAPI, updateClaimAPI, getHospitalsAPI, getClaimStatusesAPI, exportClaimsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlinePencil, HiOutlineChevronLeft, HiOutlineChevronRight, HiChevronDown, HiCheck, HiOutlineX, HiOutlineDocumentDownload } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import * as XLSX from 'xlsx-js-style';

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
  const [rejectionPending, setRejectionPending] = useState(null); // { claimId, currentStatus }
  const [rejectionInput, setRejectionInput] = useState('');
  const initStatus = new URLSearchParams(location.search).get('status') || '';
  const [filters, setFilters] = useState({
    search: '', hospital: '', status: initStatus, claimType: '', month: '', page: 1
  });

  useEffect(() => {
    Promise.all([
      getHospitalsAPI({ active: 'true' }),
      getClaimStatusesAPI(),
    ]).then(([h, s]) => {
      setHospitals(h.data);
      setClaimStatuses(s.data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin)));
    }).catch(() => {}).finally(() => setFiltersLoading(false));
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getClaimsAPI(params)
      .then(({ data }) => {
        setClaims(data.claims);
        setTotal(data.total);
        setPages(data.pages);
      })
      .catch(() => toast.error('Failed to fetch claims'))
      .finally(() => setLoading(false));
  }, [filters]);

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '-';
  const formatAmount = (a) => a ? formatCurrency(a) : '-';

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

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v && k !== 'page') params[k] = v; });
      const { data } = await exportClaimsAPI(params);
      if (!data.length) { toast.info('No claims to export'); return; }

      const fmtD = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '';
      const fmtN = (n) => Number(n) || 0;
      const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
      const fmtINR = (n) => {
        const num = Number(n) || 0;
        return num === 0 ? '' : inrFmt.format(num);
      };

      // Column definitions — keeps headers, value extractors, and which columns
      // are amounts (right-aligned + summed) all in one place.
      const cols = [
        { h: 'Sr No',                       v: (_c, i) => i + 1 },
        { h: 'Created At',                  v: (c)     => fmtD(c.createdAt) },
        { h: 'Month',                       v: (c)     => c.month ? new Date(c.month).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '' },
        { h: 'Month Claim No',              v: (c)     => c.monthClaimNo || '' },
        { h: 'Hospital',                    v: (c)     => c.hospital?.name || '' },
        ...(isSuperAdmin ? [{ h: 'Reference', v: (c) => c.hospital?.referenceBy || '' }] : []),
        { h: 'Patient Name',                v: (c)     => c.patientName || '' },
        { h: 'Patient Mobile',              v: (c)     => c.patientMobile || '' },
        { h: 'Doctor',                      v: (c)     => c.doctorName || '' },
        { h: 'Claim Type',                  v: (c)     => c.claimType || '' },
        { h: 'Insurance Company',           v: (c)     => c.insuranceCompany?.name || '' },
        { h: 'TPA',                         v: (c)     => c.tpa?.name || '' },
        { h: 'Policy No',                   v: (c)     => c.policyNo || '' },
        { h: 'Client ID',                   v: (c)     => c.clientId || '' },
        { h: 'CCN No',                      v: (c)     => c.ccnNo || '' },
        { h: 'Date of Admit',               v: (c)     => fmtD(c.dateOfAdmit) },
        { h: 'Date of Discharge',           v: (c)     => fmtD(c.dateOfDischarge) },
        { h: 'Hospital Final Bill',         v: (c)     => fmtN(c.hospitalFinalBill),         amount: true },
        { h: 'MOU Discount',                v: (c)     => fmtN(c.mouDiscount),               amount: true },
        { h: 'Deduction',                   v: (c)     => fmtN(c.deduction),                 amount: true },
        { h: 'Final Approval Amount',       v: (c)     => fmtN(c.finalApprovalAmount),       amount: true },
        { h: 'Final Approval Date',         v: (c)     => fmtD(c.finalApprovalDate) },
        { h: 'File Received Date',          v: (c)     => fmtD(c.fileReceivedDate) },
        { h: 'Submit Mode',                 v: (c)     => c.submitMode || '' },
        { h: 'Courier Submit Date',         v: (c)     => fmtD(c.courierSubmitDate) },
        { h: 'Online Submit Date',          v: (c)     => fmtD(c.onlineSubmitDate) },
        { h: 'Courier Company',             v: (c)     => c.courierCompanyName || '' },
        { h: 'POD Number',                  v: (c)     => c.podNumber || '' },
        { h: 'Settlement Amount',           v: (c)     => fmtN(c.settlementAmount),          amount: true },
        { h: 'Settlement Deduction',        v: (c)     => fmtN(c.settlementAmountDeduction), amount: true },
        { h: 'MOU Discount on Settlement',  v: (c)     => fmtN(c.mouDiscountOnSettlement),   amount: true },
        { h: 'TDS',                         v: (c)     => fmtN(c.tds),                       amount: true },
        { h: 'Bank Transfer Amount',        v: (c)     => fmtN(c.bankTransferAmount),        amount: true },
        { h: 'Settlement Date',             v: (c)     => fmtD(c.settlementDate) },
        { h: 'NEFT No',                     v: (c)     => c.neftNo || '' },
        { h: 'Treatment Type',              v: (c)     => c.treatmentType || '' },
        { h: 'Diagnosis',                   v: (c)     => c.diagnosis || '' },
        { h: 'Surgery Name',                v: (c)     => c.surgeryName || '' },
        { h: 'Status',                      v: (c)     => c.status || '' },
        { h: 'Rejected Reason',             v: (c)     => c.rejectedReason || '' },
        { h: 'Remarks',                     v: (c)     => c.remarks || '' },
        ...(isSuperAdmin ? [{ h: 'File Charge', v: (c) => fmtN(c.filePrice), amount: true }] : []),
      ];

      const NUM_COLS = cols.length;
      const headers = cols.map(c => c.h);
      const amountColIdx = new Set(cols.map((c, i) => c.amount ? i : -1).filter(i => i >= 0));

      // Build AOA — title, header, data rows, blank, total, blank, footer
      const wsData = [];
      const rowMeta = [];
      const merges = [];

      const today = new Date().toLocaleDateString('en-IN');
      const rTitle = wsData.length;
      wsData.push([`Claims Export — ${today} — ${data.length} claim(s)`, ...Array(NUM_COLS - 1).fill('')]);
      merges.push({ s: { r: rTitle, c: 0 }, e: { r: rTitle, c: NUM_COLS - 1 } });
      rowMeta.push({ row: rTitle, type: 'title' });

      const rHeader = wsData.length;
      wsData.push([...headers]);
      rowMeta.push({ row: rHeader, type: 'header' });

      // Pre-format amount values as en-IN strings — guarantees Indian grouping
      // (e.g. 142473 → "1,42,473") regardless of Excel locale.
      const totals = {};
      data.forEach((c, i) => {
        const row = cols.map((col, idx) => {
          const raw = col.v(c, i);
          if (col.amount) {
            totals[idx] = (totals[idx] || 0) + (Number(raw) || 0);
            return fmtINR(raw);
          }
          return raw;
        });
        rowMeta.push({ row: wsData.length, type: 'data' });
        wsData.push(row);
      });

      // Blank spacer + totals row
      wsData.push(Array(NUM_COLS).fill(''));
      const rTotal = wsData.length;
      const totalsRow = Array(NUM_COLS).fill('');
      totalsRow[0] = 'TOTAL';
      totalsRow[1] = `${data.length} claim(s)`;
      Object.entries(totals).forEach(([idx, sum]) => {
        totalsRow[parseInt(idx, 10)] = fmtINR(Math.round(sum * 100) / 100);
      });
      wsData.push(totalsRow);
      rowMeta.push({ row: rTotal, type: 'total' });

      // Footer
      wsData.push(Array(NUM_COLS).fill(''));
      const rFooter = wsData.length;
      wsData.push(['Prepared by: First Care Consultancy', ...Array(NUM_COLS - 1).fill('')]);
      merges.push({ s: { r: rFooter, c: 0 }, e: { r: rFooter, c: NUM_COLS - 1 } });
      rowMeta.push({ row: rFooter, type: 'footer' });

      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!merges'] = merges;
      ws['!cols'] = headers.map(h => ({ wch: Math.min(Math.max(h.length + 2, 14), 28) }));

      const thin = { style: 'thin', color: { auto: 1 } };
      const border = { top: thin, bottom: thin, left: thin, right: thin };

      const applyStyle = (r, c, style) => {
        const ref = XLSX.utils.encode_cell({ r, c });
        if (!ws[ref]) ws[ref] = { v: '', t: 's' };
        ws[ref].s = style;
      };

      rowMeta.forEach(({ row, type }) => {
        for (let c = 0; c < NUM_COLS; c++) {
          const isAmount = amountColIdx.has(c);
          if (type === 'title') {
            applyStyle(row, c, {
              font: { bold: true, sz: 12, name: 'Arial', color: { rgb: 'FFFFFF' } },
              fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
              alignment: { horizontal: 'center', vertical: 'center' },
            });
          } else if (type === 'header') {
            applyStyle(row, c, {
              font: { bold: true, sz: 9, name: 'Arial' },
              fill: { patternType: 'solid', fgColor: { rgb: 'F3F4F6' } },
              alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
              border,
            });
          } else if (type === 'data') {
            applyStyle(row, c, {
              font: { sz: 9, name: 'Arial' },
              alignment: { horizontal: isAmount ? 'right' : 'left', vertical: 'center' },
              border,
            });
          } else if (type === 'total') {
            applyStyle(row, c, {
              font: { bold: true, sz: 9, name: 'Arial' },
              fill: { patternType: 'solid', fgColor: { rgb: 'FEF9C3' } },
              alignment: { horizontal: c === 0 ? 'center' : isAmount ? 'right' : 'left', vertical: 'center' },
              border,
            });
          } else if (type === 'footer') {
            applyStyle(row, c, {
              font: { bold: true, sz: 10, name: 'Arial' },
              alignment: { horizontal: 'left', vertical: 'center' },
            });
          }
        }
      });

      // Header row height — bump for wrapText
      ws['!rows'] = [];
      ws['!rows'][rHeader] = { hpt: 28 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Claims');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `claims_${stamp}.xlsx`);
      toast.success(`Exported ${data.length} claim(s)`);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to export claims');
    } finally {
      setExporting(false);
    }
  };

  const handleConfirmRejection = () => {
    if (!rejectionInput.trim()) { toast.error('Please enter a rejection reason'); return; }
    const { claimId, currentStatus } = rejectionPending;
    setRejectionPending(null);
    handleStatusChange(claimId, 'rejected', currentStatus, rejectionInput.trim());
  };

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
            <>
              <div className="w-3 h-3 border-[1.5px] border-current border-t-transparent rounded-full animate-spin" />
              <span>Saving…</span>
            </>
          ) : (
            <>
              <span>{label}</span>
              <HiChevronDown className="w-3.5 h-3.5 opacity-50" />
            </>
          )}
        </button>

        {isOpen && ReactDOM.createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <div
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 w-56 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 overflow-hidden"
            >
              <p className="px-4 pt-3 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
                Update Status
              </p>
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

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Claims</h1>
          <p className="text-sm text-gray-500 mt-1">{total} total claims</p>
        </div>
        <div className="flex items-center gap-2">
          {can('claims', 'export') && (
            <button
              onClick={handleExport}
              disabled={exporting || loading}
              className="flex items-center justify-center gap-2 bg-white border border-green-600 text-green-700 hover:bg-green-50 px-4 py-3 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
              <HiOutlineDocumentDownload className="w-5 h-5" />
              {exporting ? 'Exporting…' : 'Export Claims'}
            </button>
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
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2.5 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          <div className="relative sm:col-span-2 lg:col-span-2">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
            <input placeholder="Search patient, policy, CCN..."
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          {!isHospitalUser && (
            <SearchableSelect
              options={hospitals.map(h => ({ value: h._id, label: h.name }))}
              value={filters.hospital}
              onChange={val => setFilters({ ...filters, hospital: val, page: 1 })}
              placeholder="All Hospitals"
              searchPlaceholder="Search hospitals..."
              isLoading={filtersLoading}
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
                <div key={c._id} className="p-4 active:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/claims/${c._id}`)}>
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
                    {!isHospitalUser && <><span className="font-medium text-gray-600">{c.hospital?.name || '-'}</span><span>·</span></>}
                    <span className="capitalize">{c.claimType}</span>
                    <span>·</span>
                    <span>{formatDate(c.dateOfAdmit)}</span>
                    {c.hospitalFinalBill && (
                      <>
                        <span>·</span>
                        <span className="font-medium">{formatAmount(c.hospitalFinalBill)}</span>
                      </>
                    )}
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
                  {!isHospitalUser && <td className="py-3 px-3 text-sm text-gray-600">{c.hospital?.name || '-'}</td>}
                  <td className="py-3 px-3">
                    <span className="text-xs font-medium capitalize">{c.claimType}</span>
                  </td>
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
            <p className="text-sm text-gray-500">
              Page {filters.page} of {pages} ({total} claims)
            </p>
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
                <button
                  onClick={() => setRejectionPending(null)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRejection}
                  className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors">
                  Mark as Rejected
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ClaimList;
