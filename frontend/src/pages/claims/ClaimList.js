import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineSearch, HiOutlineEye, HiOutlineChevronLeft, HiOutlineChevronRight } from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';

const ClaimList = () => {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [claims, setClaims] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
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
  const formatAmount = (a) => a ? `Rs ${Number(a).toLocaleString('en-IN')}` : '-';

  const getStatusBadge = (c) => {
    const st = claimStatuses.find(s => s.slug === c.status);
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR_MAP[st?.color] || 'bg-gray-100 text-gray-700'}`}>
        {st?.label || (c.status || '').replace(/_/g, ' ')}
      </span>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative sm:col-span-2 lg:col-span-2">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input placeholder="Search patient, policy, CCN..."
              value={filters.search} onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <select value={filters.hospital} onChange={(e) => setFilters({ ...filters, hospital: e.target.value, page: 1 })}
            className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
            <option value="">All Hospitals</option>
            {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
          </select>
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
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800 truncate">{c.patientName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{c.policyNo || 'No policy number'}</p>
                    </div>
                    {getStatusBadge(c)}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                    <span className="font-medium text-gray-600">{c.hospital?.name || '-'}</span>
                    <span>·</span>
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
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Hospital</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">DOA</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Bill</th>
                <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : claims.length === 0 ? (
                <tr><td colSpan={8} className="py-8 text-center text-gray-400">No claims found</td></tr>
              ) : claims.map((c) => (
                <tr key={c._id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/claims/${c._id}`)}>
                  <td className="py-3 px-3 text-sm text-gray-500">{c.srNo}</td>
                  <td className="py-3 px-3">
                    <p className="text-sm font-medium text-gray-800">{c.patientName}</p>
                    <p className="text-xs text-gray-400">{c.policyNo || '-'}</p>
                  </td>
                  <td className="py-3 px-3 text-sm text-gray-600">{c.hospital?.name || '-'}</td>
                  <td className="py-3 px-3">
                    <span className="text-xs font-medium capitalize">{c.claimType}</span>
                  </td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatDate(c.dateOfAdmit)}</td>
                  <td className="py-3 px-3 text-sm text-gray-600">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-3 px-3">{getStatusBadge(c)}</td>
                  <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => navigate(`/claims/${c._id}`)}
                      className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                      <HiOutlineEye className="w-4 h-4" />
                    </button>
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
