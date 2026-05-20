import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { getClaimsAPI, updateClaimAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlinePencil, HiOutlineChevronLeft, HiOutlineChevronRight, HiChevronDown, HiCheck, HiOutlineX } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';

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
      setPos({ top: r.bottom + 6, left: r.left });
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
        {can('claims', 'create') && (
          <button onClick={() => navigate('/claims/new')}
            className="flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-5 h-5" /> New Claim
          </button>
        )}
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
