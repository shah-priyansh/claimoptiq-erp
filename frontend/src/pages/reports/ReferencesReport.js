import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload } from 'react-icons/hi';
import { getReportReferencesAPI, getReferencesAPI } from '../../services/api';
import { formatINR, defaultRange, exportRowsXlsx } from './reportUtils';

const ReferencesReport = () => {
  const [filters, setFilters] = useState({ ...defaultRange(), referenceId: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refs, setRefs] = useState([]);

  useEffect(() => {
    getReferencesAPI({ active: 'true' }).then(({ data }) => setRefs(data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getReportReferencesAPI({
      from: filters.from, to: filters.to,
      referenceId: filters.referenceId || undefined,
    })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const cols = [
    { field: 'label', label: 'Reference' },
    { field: 'commissionRate', label: 'Rate', format: (v) => `${v}%` },
    { field: 'businessGiven', label: 'Business Given', format: (v) => formatINR(v) },
    { field: 'commissionExpected', label: 'Expected Commission', format: (v) => formatINR(v) },
    { field: 'commissionPaid', label: 'Paid', format: (v) => formatINR(v) },
    { field: 'commissionPending', label: 'Pending', format: (v) => formatINR(v) },
  ];

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={filters.from}
              onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={filters.to}
              onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Reference</label>
            <select value={filters.referenceId}
              onChange={(e) => setFilters((f) => ({ ...f, referenceId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All references</option>
              {refs.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => exportRowsXlsx(data?.rows || [], cols, 'references')}
              disabled={!data?.rows?.length}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              <HiOutlineDownload className="w-4 h-4" /> Export XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-primary-600 text-white p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-primary-100">Business Given</p>
          <p className="text-2xl font-bold mt-1">{formatINR(data?.totals.businessGiven)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Expected</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{formatINR(data?.totals.commissionExpected)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Paid</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{formatINR(data?.totals.commissionPaid)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Pending</p>
          <p className={`text-2xl font-bold mt-1 ${(data?.totals.commissionPending || 0) > 0 ? 'text-amber-700' : 'text-green-700'}`}>{formatINR(data?.totals.commissionPending)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>{cols.map((c) => <th key={c.field} className="text-left py-3 px-4">{c.label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={cols.length} className="p-6 text-center text-sm text-gray-500">Loading…</td></tr>
              ) : !data?.rows?.length ? (
                <tr><td colSpan={cols.length} className="p-6 text-center text-sm text-gray-500">No data in this range</td></tr>
              ) : data.rows.map((r) => (
                <tr key={r.key} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-800 font-medium">{r.label}</td>
                  <td className="py-3 px-4 text-gray-700">{r.commissionRate}%</td>
                  <td className="py-3 px-4 text-gray-700">{formatINR(r.businessGiven)}</td>
                  <td className="py-3 px-4 text-gray-700">{formatINR(r.commissionExpected)}</td>
                  <td className="py-3 px-4 text-gray-700">{formatINR(r.commissionPaid)}</td>
                  <td className={`py-3 px-4 font-semibold ${r.commissionPending > 0 ? 'text-amber-700' : r.commissionPending < 0 ? 'text-red-700' : 'text-green-700'}`}>{formatINR(r.commissionPending)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ReferencesReport;
