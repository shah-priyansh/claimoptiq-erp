import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlineDownload, HiOutlineExclamation } from 'react-icons/hi';
import { getReportTaxesAPI } from '../../services/api';
import { formatINR, defaultRange, exportRowsXlsx } from './reportUtils';

const TABS = [
  { key: 'discount',      title: 'Discount',          desc: 'Discount given on issued invoices' },
  { key: 'tdsReceivable', title: 'TDS Receivable',    desc: 'TDS deducted from our invoices' },
  { key: 'tdsPayable',    title: 'TDS Payable',       desc: 'TDS we deduct on vendor payments' },
  { key: 'gstPayable',    title: 'GST Out (Payable)', desc: 'Output GST collected on invoices' },
  { key: 'gstReceivable', title: 'GST In (Receivable)', desc: 'Input GST paid on purchases' },
];

const TaxesReport = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({ ...defaultRange() });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const activeTab = TABS.find((t) => t.key === searchParams.get('tab'))?.key || 'discount';

  useEffect(() => {
    setLoading(true);
    getReportTaxesAPI({ from: filters.from, to: filters.to })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [filters]);

  const setTab = (key) => setSearchParams({ tab: key });

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
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
        </div>
      </div>

      <SummaryTiles data={data} loading={loading} activeTab={activeTab} onTabClick={setTab} />

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="border-b border-gray-100 flex overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 ${
                activeTab === t.key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.title}
            </button>
          ))}
        </div>
        <TabBody data={data} loading={loading} tab={activeTab} />
      </div>
    </div>
  );
};

const SummaryTiles = ({ data, loading, activeTab, onTabClick }) => (
  <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
    {TABS.map((t) => {
      const node = data?.[t.key];
      const total = node?.total || 0;
      const isActive = activeTab === t.key;
      return (
        <button
          key={t.key}
          onClick={() => onTabClick(t.key)}
          className={`text-left p-4 rounded-xl border transition-colors ${
            isActive ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-gray-200 hover:border-primary-300'
          }`}
        >
          <p className={`text-xs uppercase tracking-wide ${isActive ? 'text-primary-100' : 'text-gray-500'}`}>{t.title}</p>
          <p className={`text-xl font-bold mt-1 ${isActive ? '' : 'text-gray-800'}`}>
            {loading ? '…' : formatINR(total)}
          </p>
          {node?.notTracked && (
            <p className={`text-[10px] mt-1 ${isActive ? 'text-primary-100' : 'text-amber-600'}`}>Not tracked yet</p>
          )}
        </button>
      );
    })}
  </div>
);

const TabBody = ({ data, loading, tab }) => {
  const node = data?.[tab];

  if (loading) {
    return <div className="p-10 text-center text-sm text-gray-500">Loading…</div>;
  }
  if (!node) {
    return <div className="p-10 text-center text-sm text-gray-500">No data</div>;
  }
  if (node.notTracked) {
    return (
      <div className="p-8 flex items-start gap-3 bg-amber-50/40">
        <HiOutlineExclamation className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-800">Not tracked on Expense yet</p>
          <p className="text-sm text-gray-600 mt-1">{node.note}</p>
        </div>
      </div>
    );
  }

  const tabMeta = TABS.find((t) => t.key === tab);
  const bucketLabel = bucketHeading(tab);

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
      <BreakdownCard
        title="By month"
        rows={node.byMonth}
        emptyLabel="No entries"
        cols={[{ field: 'label', label: 'Month' }, { field: 'count', label: '#' }, { field: 'value', label: 'Amount', isCurrency: true }]}
        exportName={`${tab}-by-month`}
      />
      <BreakdownCard
        title="By hospital"
        rows={node.byHospital}
        emptyLabel="No entries"
        cols={[{ field: 'label', label: 'Hospital' }, { field: 'count', label: '#' }, { field: 'value', label: 'Amount', isCurrency: true }]}
        exportName={`${tab}-by-hospital`}
      />
      {node.byBucket ? (
        <BreakdownCard
          title={bucketLabel}
          rows={node.byBucket}
          emptyLabel="No entries"
          cols={bucketCols(tab)}
          exportName={`${tab}-${bucketLabel.toLowerCase().replace(/\s+/g, '-')}`}
        />
      ) : (
        <div className="bg-gray-50 border border-dashed border-gray-200 rounded-xl p-4 text-xs text-gray-400 flex items-center justify-center">
          {tabMeta?.desc}
        </div>
      )}
    </div>
  );
};

const bucketHeading = (tab) => {
  if (tab === 'tdsReceivable') return 'By section';
  if (tab === 'gstPayable') return 'By rate';
  return 'Breakdown';
};

const bucketCols = (tab) => {
  if (tab === 'tdsReceivable') {
    return [
      { field: 'label', label: 'Section' },
      { field: 'rate', label: 'Rate %' },
      { field: 'count', label: '#' },
      { field: 'value', label: 'Amount', isCurrency: true },
    ];
  }
  if (tab === 'gstPayable') {
    return [
      { field: 'label', label: 'Rate' },
      { field: 'count', label: '#' },
      { field: 'value', label: 'Amount', isCurrency: true },
    ];
  }
  return [{ field: 'label', label: 'Bucket' }, { field: 'count', label: '#' }, { field: 'value', label: 'Amount', isCurrency: true }];
};

const BreakdownCard = ({ title, rows, emptyLabel, cols, exportName }) => {
  const total = useMemo(() => (rows || []).reduce((a, r) => a + (Number(r.value) || 0), 0), [rows]);
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between bg-gray-50/40">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">{title}</span>
        <button
          onClick={() => exportRowsXlsx(
            rows || [],
            cols.map((c) => ({ field: c.field, label: c.label, format: c.isCurrency ? (v) => Math.round(Number(v) || 0) : undefined })),
            exportName
          )}
          disabled={!rows?.length}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40 flex items-center gap-1"
        >
          <HiOutlineDownload className="w-3.5 h-3.5" /> XLSX
        </button>
      </div>
      {!rows?.length ? (
        <div className="p-6 text-center text-sm text-gray-400">{emptyLabel}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white text-xs uppercase text-gray-500">
              <tr>
                {cols.map((c) => (
                  <th key={c.field} className={`text-left py-2 px-3 ${c.isCurrency ? 'text-right' : ''}`}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.key} className="hover:bg-gray-50">
                  {cols.map((c) => (
                    <td key={c.field} className={`py-2 px-3 ${c.isCurrency ? 'text-right text-gray-800 font-medium' : 'text-gray-700'}`}>
                      {c.isCurrency ? formatINR(r[c.field]) : (r[c.field] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-primary-50/30 font-semibold">
                {cols.map((c, i) => (
                  <td key={c.field} className={`py-2 px-3 ${c.isCurrency ? 'text-right' : ''}`}>
                    {i === 0 ? 'Total' : c.isCurrency ? formatINR(total) : ''}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default TaxesReport;
