import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload } from 'react-icons/hi';
import { getReportProfitAPI } from '../../services/api';
import { formatINR, defaultRange, BarChart, exportRowsXlsx } from './reportUtils';

const ProfitReport = () => {
  const [filters, setFilters] = useState(defaultRange());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getReportProfitAPI({ from: filters.from, to: filters.to })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const cols = [
    { field: 'label', label: 'Month' },
    { field: 'sales', label: 'Sales', format: (v) => formatINR(v) },
    { field: 'expense', label: 'Expense', format: (v) => formatINR(v) },
    { field: 'value', label: 'Profit', format: (v) => formatINR(v) },
  ];
  const profit = data?.totals.profit || 0;
  const profitClass = profit >= 0 ? 'bg-green-600 text-white' : 'bg-red-600 text-white';

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
          <div className="flex items-end">
            <button onClick={() => exportRowsXlsx(data?.rows || [], cols, 'profit')}
              disabled={!data?.rows?.length}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              <HiOutlineDownload className="w-4 h-4" /> Export XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Sales</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{formatINR(data?.totals.sales)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Expenses</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{formatINR(data?.totals.expense)}</p>
        </div>
        <div className={`p-4 rounded-xl ${profitClass}`}>
          <p className="text-xs uppercase tracking-wide opacity-75">Profit</p>
          <p className="text-2xl font-bold mt-1">{formatINR(profit)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Monthly trend</h2>
        {loading
          ? <div className="text-center text-sm text-gray-500 py-6">Loading…</div>
          : <BarChart rows={data?.rows || []} valueFields={['sales', 'expense', 'value']} colors={['#1d4ed8', '#dc2626', '#16a34a']} />}
        <p className="text-xs text-gray-400 mt-2">Operational profit — not GAAP. Cash/Bank entries are payment timing and don't affect this view.</p>
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
                  <td className="py-3 px-4 text-gray-700">{r.label}</td>
                  <td className="py-3 px-4 text-gray-700">{formatINR(r.sales)}</td>
                  <td className="py-3 px-4 text-gray-700">{formatINR(r.expense)}</td>
                  <td className={`py-3 px-4 font-semibold ${r.value >= 0 ? 'text-green-700' : 'text-red-700'}`}>{formatINR(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ProfitReport;
