import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { HiOutlineArrowLeft, HiOutlinePrinter, HiOutlineDownload } from 'react-icons/hi';
import { getReportBalanceSheetAPI } from '../../services/api';
import { formatINR, todayIso, exportRowsXlsx } from './reportUtils';

const fmtAsOnLabel = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

// Indian fiscal year starting Apr 1 of the calendar year containing `d`.
const fyStartIso = (d = new Date()) => {
  const year = d.getMonth() < 3 ? d.getFullYear() - 1 : d.getFullYear();
  return `${year}-04-01`;
};

const endOfLastMonthIso = () => {
  const d = new Date();
  d.setDate(0);
  return d.toISOString().slice(0, 10);
};

const BalanceSheetReport = () => {
  const [fromDate, setFromDate] = useState(fyStartIso());
  const [toDate, setToDate] = useState(todayIso());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getReportBalanceSheetAPI({ from: fromDate || undefined, to: toDate })
      .then(({ data }) => setData(data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [fromDate, toDate]);

  const liabilityGroups = useMemo(() => {
    if (!data) return [];
    const cap = data.liabilities.capitalAccount;
    const tax = data.liabilities.outwardDutiesTaxes;
    return [
      {
        key: 'capital',
        label: cap.label,
        total: cap.total,
        items: [
          { key: 'owners_capital', label: "Owner's Capital A/c", value: cap.ownersCapital },
          { key: 'retained_earnings', label: 'Retained Earnings (Net Income for period)', value: cap.retainedEarnings },
        ].filter((r) => r.value !== 0),
      },
      tax.total !== 0 && {
        key: 'tax',
        label: tax.label,
        total: tax.total,
        items: tax.items,
      },
    ].filter(Boolean);
  }, [data]);

  const assetGroups = useMemo(() => {
    if (!data) return [];
    const a = data.assets;
    return [a.sundryDebtors, a.bankAccounts, a.cashAccount, a.upiAccount, a.tdsReceivable]
      .filter((g) => g.total !== 0);
  }, [data]);

  const handleExport = () => {
    if (!data) return;
    const rows = [];
    rows.push({ Side: 'LIABILITIES', Group: '', Account: '', Amount: '' });
    for (const g of liabilityGroups) {
      rows.push({ Side: '', Group: g.label, Account: '', Amount: g.total });
      for (const it of g.items) rows.push({ Side: '', Group: '', Account: it.label, Amount: it.value });
    }
    rows.push({ Side: '', Group: 'TOTAL', Account: '', Amount: data.totals.liabilities });
    rows.push({ Side: '', Group: '', Account: '', Amount: '' });
    rows.push({ Side: 'ASSETS', Group: '', Account: '', Amount: '' });
    for (const g of assetGroups) {
      rows.push({ Side: '', Group: g.label, Account: '', Amount: g.total });
      for (const it of g.items) rows.push({ Side: '', Group: '', Account: it.label, Amount: it.value });
    }
    rows.push({ Side: '', Group: 'TOTAL', Account: '', Amount: data.totals.assets });
    const tag = `${fromDate || 'lifetime'}_to_${toDate}`;
    exportRowsXlsx(
      rows,
      [
        { field: 'Side', label: 'Side' },
        { field: 'Group', label: 'Group' },
        { field: 'Account', label: 'Account' },
        { field: 'Amount', label: 'Amount' },
      ],
      `balance-sheet-${tag}`
    );
  };

  const applyPreset = (preset) => {
    const today = todayIso();
    if (preset === 'today_lifetime') {
      setFromDate('');
      setToDate(today);
    } else if (preset === 'eom_last') {
      const eom = endOfLastMonthIso();
      const d = new Date(eom);
      setFromDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
      setToDate(eom);
    } else if (preset === 'fy_to_date') {
      setFromDate(fyStartIso());
      setToDate(today);
    } else if (preset === 'q1_fy27') {
      setFromDate('2026-04-01');
      setToDate('2026-06-30');
    } else if (preset === 'fy26') {
      setFromDate('2025-04-01');
      setToDate('2026-03-31');
    }
  };

  const periodLabel = data?.filters.from
    ? `${fmtAsOnLabel(data.filters.from)} – ${fmtAsOnLabel(data.filters.to)}`
    : `as on ${fmtAsOnLabel(data?.filters.to || `${toDate}T00:00:00Z`)}`;

  return (
    <div>
      <Link to="/reports" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3 print:hidden">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to reports
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input
              type="date"
              value={fromDate}
              max={toDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To (as on)</label>
            <input
              type="date"
              value={toDate}
              max={todayIso()}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
            />
          </div>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            <QuickRange label="FY-to-date" onClick={() => applyPreset('fy_to_date')} />
            <QuickRange label="Q1 FY26-27" onClick={() => applyPreset('q1_fy27')} />
            <QuickRange label="FY 25-26" onClick={() => applyPreset('fy26')} />
            <QuickRange label="Last month" onClick={() => applyPreset('eom_last')} />
            <QuickRange label="Lifetime → today" onClick={() => applyPreset('today_lifetime')} />
          </div>
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => window.print()}
              disabled={!data}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 hover:border-primary-300 disabled:opacity-50 text-gray-700 text-sm font-medium rounded-lg"
            >
              <HiOutlinePrinter className="w-4 h-4" /> Print
            </button>
            <button
              onClick={handleExport}
              disabled={!data}
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              <HiOutlineDownload className="w-4 h-4" /> XLSX
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden print:border-0 print:rounded-none">
        <div className="px-6 py-4 border-b border-gray-100 text-center">
          <h2 className="text-lg font-semibold text-gray-800">Balance Sheet</h2>
          <p className="text-sm text-gray-500 mt-0.5">{periodLabel}</p>
        </div>

        {loading ? (
          <div className="p-10 text-center text-sm text-gray-500">Loading…</div>
        ) : !data ? (
          <div className="p-10 text-center text-sm text-gray-500">No data</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-gray-100">
            <Side title="Liabilities" groups={liabilityGroups} total={data.totals.liabilities} />
            <Side title="Assets" groups={assetGroups} total={data.totals.assets} />
          </div>
        )}
      </div>

      {data && (
        <p className="mt-3 text-xs text-gray-400 print:hidden">
          Retained Earnings reflects net income inside the From → To window. Owner's Capital A/c is the balancing figure and absorbs opening capital plus any adjustments not tracked in the system.
        </p>
      )}
    </div>
  );
};

const Side = ({ title, groups, total }) => (
  <div className="p-0">
    <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-xs uppercase tracking-wide font-semibold text-gray-600 flex items-center justify-between">
      <span>{title}</span>
      <span>Amount</span>
    </div>
    <div>
      {!groups.length ? (
        <div className="px-4 py-6 text-center text-sm text-gray-400">Nothing here</div>
      ) : groups.map((g) => (
        <div key={g.key} className="border-b border-gray-50">
          <div className="px-4 py-2.5 flex items-center justify-between bg-gray-50/40">
            <span className="text-sm font-semibold text-gray-800">{g.label}</span>
            <span className="text-sm font-semibold text-gray-800">{formatINR(g.total)}</span>
          </div>
          {g.items.map((it) => (
            <div key={it.key} className="px-4 py-2 pl-8 flex items-center justify-between">
              <span className="text-sm text-gray-600">{it.label}</span>
              <span className={`text-sm ${it.value < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatINR(it.value)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
    <div className="px-4 py-3 border-t-2 border-gray-300 bg-primary-50/40 flex items-center justify-between">
      <span className="text-sm font-bold text-gray-900">Total</span>
      <span className="text-base font-bold text-gray-900">{formatINR(total)}</span>
    </div>
  </div>
);

const QuickRange = ({ label, onClick }) => (
  <button
    onClick={onClick}
    className="px-3 py-1.5 text-xs rounded-full border bg-white text-gray-600 border-gray-200 hover:border-primary-300"
  >
    {label}
  </button>
);

export default BalanceSheetReport;
