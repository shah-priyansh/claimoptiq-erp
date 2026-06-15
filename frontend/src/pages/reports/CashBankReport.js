import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload } from 'react-icons/hi';
import { getReportCashBankAPI, getCashBankBalancesAPI } from '../../services/api';
import { formatINR, defaultRange, BarChart, exportRowsXlsx } from './reportUtils';

const CashBankReport = () => {
  const [filters, setFilters] = useState({ ...defaultRange(), groupBy: 'month', mode: '' });
  const [data, setData] = useState(null);
  const [balances, setBalances] = useState({ cash: 0, bank: 0, upi: 0, total: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCashBankBalancesAPI().then(({ data }) => setBalances(data)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getReportCashBankAPI({
      from: filters.from, to: filters.to, groupBy: filters.groupBy,
      mode: filters.mode || undefined,
    })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const cols = [
    { field: 'label', label: filters.groupBy === 'mode' ? 'Mode' : (filters.groupBy === 'day' ? 'Date' : 'Month') },
    { field: 'in',  label: 'In',  format: (v) => formatINR(v) },
    { field: 'out', label: 'Out', format: (v) => formatINR(v) },
    { field: 'value', label: 'Net', format: (v) => formatINR(v) },
  ];

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Tile label="Cash" value={formatINR(balances.cash)} accent={balances.cash < 0} />
        <Tile label="Bank" value={formatINR(balances.bank)} accent={balances.bank < 0} />
        <Tile label="UPI"  value={formatINR(balances.upi)}  accent={balances.upi < 0} />
        <Tile label="Total" value={formatINR(balances.total)} primary />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Group by</label>
            <select value={filters.groupBy}
              onChange={(e) => setFilters((f) => ({ ...f, groupBy: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="month">By Month</option>
              <option value="day">By Day</option>
              <option value="mode">By Mode</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mode</label>
            <select value={filters.mode}
              onChange={(e) => setFilters((f) => ({ ...f, mode: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All modes</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="upi">UPI</option>
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => exportRowsXlsx(data?.rows || [], cols, `cash-bank-${filters.groupBy}`)}
              disabled={!data?.rows?.length}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              <HiOutlineDownload className="w-4 h-4" /> Export XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-green-50 border border-green-100 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-green-700">In</p>
          <p className="text-2xl font-bold mt-1 text-green-800">{formatINR(data?.totals.in)}</p>
        </div>
        <div className="bg-red-50 border border-red-100 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-red-700">Out</p>
          <p className="text-2xl font-bold mt-1 text-red-800">{formatINR(data?.totals.out)}</p>
        </div>
        <div className={`p-4 rounded-xl ${(data?.totals.net || 0) >= 0 ? 'bg-primary-600 text-white' : 'bg-red-600 text-white'}`}>
          <p className="text-xs uppercase tracking-wide opacity-75">Net</p>
          <p className="text-2xl font-bold mt-1">{formatINR(data?.totals.net)}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">In vs Out</h2>
        {loading
          ? <div className="text-center text-sm text-gray-500 py-6">Loading…</div>
          : <BarChart rows={data?.rows || []} valueFields={['in', 'out']} colors={['#16a34a', '#dc2626']} />}
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
                  <td className="py-3 px-4 text-gray-800">{r.label}</td>
                  <td className="py-3 px-4 text-green-700">{formatINR(r.in)}</td>
                  <td className="py-3 px-4 text-red-700">{formatINR(r.out)}</td>
                  <td className={`py-3 px-4 font-semibold ${r.value >= 0 ? 'text-gray-800' : 'text-red-700'}`}>{formatINR(r.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const Tile = ({ label, value, primary, accent }) => (
  <div className={primary ? 'bg-primary-600 text-white p-4 rounded-xl' : 'bg-white border border-gray-200 p-4 rounded-xl'}>
    <p className={`text-xs uppercase tracking-wide ${primary ? 'text-primary-100' : 'text-gray-500'}`}>{label}</p>
    <p className={`text-2xl font-bold mt-1 ${primary ? '' : accent ? 'text-red-700' : 'text-gray-800'}`}>{value}</p>
  </div>
);

export default CashBankReport;
