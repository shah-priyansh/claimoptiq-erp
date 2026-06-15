import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload } from 'react-icons/hi';
import { getReportSalesAPI, getHospitalsAPI } from '../../services/api';
import { formatINR, defaultRange, BarChart, exportRowsXlsx } from './reportUtils';

const GROUPS = [
  { v: 'month',    l: 'By Month' },
  { v: 'hospital', l: 'By Hospital' },
  { v: 'service',  l: 'By Service' },
];

const SalesReport = () => {
  const [filters, setFilters] = useState({ ...defaultRange(), groupBy: 'month', hospitalId: '' });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hospitals, setHospitals] = useState([]);

  useEffect(() => {
    getHospitalsAPI().then(({ data }) => {
      const list = Array.isArray(data) ? data : data.hospitals;
      setHospitals((list || []).filter((h) => h.isActive !== false));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    getReportSalesAPI({
      from: filters.from, to: filters.to, groupBy: filters.groupBy,
      hospitalId: filters.hospitalId || undefined,
    })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const cols = filters.groupBy === 'month'
    ? [
        { field: 'label', label: 'Month' },
        { field: 'invoiceCount', label: 'Invoices' },
        { field: 'value', label: 'Sales', format: (v) => formatINR(v) },
        { field: 'paid', label: 'Paid', format: (v) => formatINR(v) },
      ]
    : filters.groupBy === 'hospital'
    ? [
        { field: 'label', label: 'Hospital' },
        { field: 'invoiceCount', label: 'Invoices' },
        { field: 'value', label: 'Sales', format: (v) => formatINR(v) },
        { field: 'paid', label: 'Paid', format: (v) => formatINR(v) },
      ]
    : [
        { field: 'label', label: 'Service' },
        { field: 'lineCount', label: 'Line items' },
        { field: 'value', label: 'Amount', format: (v) => formatINR(v) },
      ];

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

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
              {GROUPS.map((g) => <option key={g.v} value={g.v}>{g.l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Hospital</label>
            <select value={filters.hospitalId}
              onChange={(e) => setFilters((f) => ({ ...f, hospitalId: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All hospitals</option>
              {hospitals.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={() => exportRowsXlsx(data?.rows || [], cols, `sales-${filters.groupBy}`)}
              disabled={!data?.rows?.length}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              <HiOutlineDownload className="w-4 h-4" /> Export XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-primary-600 text-white p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-primary-100">Total Sales</p>
          <p className="text-2xl font-bold mt-1">{formatINR(data?.totals.sales)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Paid</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{formatINR(data?.totals.paid || 0)}</p>
        </div>
        <div className="bg-white border border-gray-200 p-4 rounded-xl">
          <p className="text-xs uppercase tracking-wide text-gray-500">Invoices</p>
          <p className="text-2xl font-bold mt-1 text-gray-800">{data?.totals.invoiceCount || 0}</p>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Distribution</h2>
        {loading
          ? <div className="text-center text-sm text-gray-500 py-6">Loading…</div>
          : <BarChart rows={data?.rows || []} valueFields={filters.groupBy === 'service' ? ['value'] : ['value', 'paid']} />}
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
                  {cols.map((c) => <td key={c.field} className="py-3 px-4 text-gray-700">{c.format ? c.format(r[c.field], r) : r[c.field]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SalesReport;
