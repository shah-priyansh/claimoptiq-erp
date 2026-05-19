import React, { useState, useEffect } from 'react';
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlineDownload } from 'react-icons/hi';
import { formatCurrency } from '../../utils/format';

const Reports = () => {
  const { user, roleSlug } = useAuth();
  const isHospitalUser = !!user?.hospital;
  const isSuperAdmin = roleSlug === 'super_admin';
  const [hospitals, setHospitals] = useState([]);
  const [filters, setFilters] = useState({ hospital: '', dateFrom: '', dateTo: '', status: '' });
  const [claims, setClaims] = useState([]);
  const [loading, setLoading] = useState(false);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [billDropdownOpen, setBillDropdownOpen] = useState(false);

  useEffect(() => {
    if (!isHospitalUser) {
      getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    }
    getClaimStatusesAPI()
      .then(({ data }) => setClaimStatuses(data.filter(s => s.isActive !== false)))
      .catch(() => {});
  }, [isHospitalUser]);

  const generateReport = async () => {
    setLoading(true);
    try {
      const params = { limit: 10000 };
      if (filters.hospital) params.hospital = filters.hospital;
      if (filters.dateFrom) params.dateFrom = filters.dateFrom;
      if (filters.dateTo) params.dateTo = filters.dateTo;
      if (filters.status) params.status = filters.status;
      const { data } = await getClaimsAPI(params);
      setClaims(data.claims);
    } catch {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!claims.length) return;
    const headers = ['SR', 'Month', 'Patient Name', 'Hospital', 'Claim Type', 'Insurance', 'TPA',
      'Policy No', 'DOA', 'DOD', 'Hospital Bill', 'Deduction', 'Final Approval',
      'Settlement Amount', 'TDS', 'Bank Transfer', 'Status',
      ...(isSuperAdmin ? ['File Price'] : [])];
    const rows = claims.map(c => [
      c.srNo, c.month ? new Date(c.month).toLocaleDateString('en-IN') : '',
      c.patientName, c.hospital?.name || '', c.claimType,
      c.insuranceCompany?.name || '', c.tpa?.name || '',
      c.policyNo, c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
      c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
      c.hospitalFinalBill, c.deduction, c.finalApprovalAmount,
      c.settlementAmount, c.tds, c.bankTransferAmount, c.status,
      ...(isSuperAdmin ? [c.filePrice] : [])
    ]);

    const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `claim_report_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportBillGrouped = () => {
    if (!claims.length) return;
    setBillDropdownOpen(false);
    const grouped = {};
    claims.forEach(c => {
      const name = c.hospital?.name || 'Unknown';
      if (!grouped[name]) {
        grouped[name] = { count: 0, totalBill: 0, totalApproval: 0, totalSettlement: 0, totalBank: 0, totalFilePrice: 0 };
      }
      grouped[name].count += 1;
      grouped[name].totalBill += c.hospitalFinalBill || 0;
      grouped[name].totalApproval += c.finalApprovalAmount || 0;
      grouped[name].totalSettlement += c.settlementAmount || 0;
      grouped[name].totalBank += c.bankTransferAmount || 0;
      grouped[name].totalFilePrice += c.filePrice || 0;
    });

    const headers = ['Hospital', 'No. of Claims', 'Total Hospital Bill', 'Total Approval Amount', 'Total Settlement', 'Total Bank Transfer', 'Total File Price'];
    const rows = Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, g]) => [name, g.count, g.totalBill, g.totalApproval, g.totalSettlement, g.totalBank, g.totalFilePrice]);

    const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bill_grouped_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportBillAll = () => {
    setBillDropdownOpen(false);
    exportCSV();
  };

  const formatAmount = (a) => a ? formatCurrency(a) : '-';

  // Summary stats
  const totalBill = claims.reduce((s, c) => s + (c.hospitalFinalBill || 0), 0);
  const totalSettlement = claims.reduce((s, c) => s + (c.bankTransferAmount || 0), 0);
  const totalFilePrice = claims.reduce((s, c) => s + (c.filePrice || 0), 0);

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">Reports</h1>
      <p className="text-sm text-gray-500 mb-6">Generate and export claim reports</p>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
          {!isHospitalUser && (
            <select value={filters.hospital} onChange={(e) => setFilters({ ...filters, hospital: e.target.value })}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">All Hospitals</option>
              {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
          )}
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
            placeholder="From Date"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
            placeholder="To Date"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
            <option value="">All Status</option>
            {claimStatuses.map(s => (
              <option key={s.id} value={s.slug}>{s.label}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button onClick={generateReport} disabled={loading}
              className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {loading ? 'Loading...' : 'Generate'}
            </button>
            <button onClick={exportCSV} disabled={!claims.length}
              className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              <HiOutlineDownload className="w-4 h-4" /> CSV
            </button>
            {isSuperAdmin && (
              <div className="relative">
                <button
                  onClick={() => setBillDropdownOpen(o => !o)}
                  disabled={!claims.length}
                  className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
                >
                  <HiOutlineDownload className="w-4 h-4" /> Generate Bill
                </button>
                {billDropdownOpen && (
                  <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
                    <button
                      onClick={exportBillGrouped}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
                    >
                      Group by Hospital
                    </button>
                    <button
                      onClick={exportBillAll}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-b-lg border-t border-gray-100"
                    >
                      All Claims Report
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Summary */}
      {claims.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
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
              <p className="text-2xl font-bold text-green-600">{formatAmount(totalFilePrice)}</p>
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
                {['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', ...(isSuperAdmin ? ['File Price'] : [])].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {claims.length === 0 ? (
                <tr><td colSpan={isHospitalUser ? (isSuperAdmin ? 10 : 9) : (isSuperAdmin ? 11 : 10)} className="py-8 text-center text-gray-400">
                  {loading ? 'Loading...' : 'Click "Generate" to view report'}
                </td></tr>
              ) : claims.map(c => (
                <tr key={c._id} className="hover:bg-gray-50 text-sm">
                  <td className="py-2 px-3 text-gray-500">{c.srNo}</td>
                  <td className="py-2 px-3 font-medium text-gray-800 whitespace-nowrap">{c.patientName}</td>
                  {!isHospitalUser && <td className="py-2 px-3 text-gray-600 whitespace-nowrap">{c.hospital?.name || '-'}</td>}
                  <td className="py-2 px-3 capitalize">{c.claimType}</td>
                  <td className="py-2 px-3">{formatAmount(c.hospitalFinalBill)}</td>
                  <td className="py-2 px-3">{formatAmount(c.finalApprovalAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.settlementAmount)}</td>
                  <td className="py-2 px-3">{formatAmount(c.tds)}</td>
                  <td className="py-2 px-3">{formatAmount(c.bankTransferAmount)}</td>
                  <td className="py-2 px-3 capitalize">{c.status.replace('_', ' ')}</td>
                  {isSuperAdmin && <td className="py-2 px-3">{formatAmount(c.filePrice)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Reports;
