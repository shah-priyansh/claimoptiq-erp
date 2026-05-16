import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { getClaimsAPI, updateClaimAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlinePencil, HiOutlineChevronLeft, HiOutlineChevronRight, HiChevronDown, HiCheck } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency } from '../../utils/format';

const ClaimList = () => {
  const navigate = useNavigate();
  const { can, user } = useAuth();
  const isHospitalUser = !!user?.hospital;
  const [claims, setClaims] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [filters, setFilters] = useState({
    search: '', hospital: '', status: '', claimType: '', month: '', page: 1
  });

  useEffect(() => {
    getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    getClaimStatusesAPI().then(({ data }) => setClaimStatuses(data.filter(s => s.isActive))).catch(() => {});
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

  const handleStatusChange = async (claimId, newStatus) => {
    setUpdatingId(claimId);
    try {
      await updateClaimAPI(claimId, { status: newStatus });
      setClaims(prev => prev.map(c => c._id === claimId ? { ...c, status: newStatus } : c));
      toast.success('Status updated');
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdatingId(null);
    }
  };

  const StatusBadge = ({ c }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const btnRef = useRef(null);

    const st = claimStatuses.find(s => s.slug === c.status);
    const isUpdating = updatingId === c._id;
    const colorCls = STATUS_COLOR_MAP[st?.color] || 'bg-gray-100 text-gray-700';
    const label = st?.label || (c.status || '').replace(/_/g, ' ');

    const openDrop = (e) => {
      e.stopPropagation();
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left });
      setIsOpen(true);
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
              className="fixed z-50 w-52 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 py-1.5 overflow-hidden"
            >
              <p className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 mb-1">
                Update Status
              </p>
              {claimStatuses.map(s => {
                const cls = STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700';
                const isActive = s.slug === c.status;
                return (
                  <button
                    key={s._id}
                    onClick={() => { handleStatusChange(c._id, s.slug); setIsOpen(false); }}
                    className={`w-full px-3 py-2 flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                  >
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{s.label}</span>
                    {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                  </button>
                );
              })}
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
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          <div className={`relative sm:col-span-2 ${isHospitalUser ? 'lg:col-span-2' : 'lg:col-span-2'}`}>
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input placeholder="Search patient, policy, CCN..."
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          {!isHospitalUser && (
            <select value={filters.hospital} onChange={(e) => setFilters({ ...filters, hospital: e.target.value, page: 1 })}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">All Hospitals</option>
              {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
          )}
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value, page: 1 })}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
            <option value="">All Status</option>
            {claimStatuses.map(s => (
              <option key={s._id} value={s.slug}>{s.label}</option>
            ))}
          </select>
          <select value={filters.claimType} onChange={(e) => setFilters({ ...filters, claimType: e.target.value, page: 1 })}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
            <option value="">All Types</option>
            <option value="cashless">Cashless</option>
            <option value="reimbursement">Reimbursement</option>
            <option value="grievance">Grievance</option>
          </select>
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
                      <StatusBadge c={c} />
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
                  <td className="py-3 px-3"><StatusBadge c={c} /></td>
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
    </div>
  );
};

export default ClaimList;
