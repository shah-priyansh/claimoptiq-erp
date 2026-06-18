import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  HiOutlineCurrencyRupee, HiOutlineCash, HiOutlineUserGroup,
  HiOutlineDocumentText, HiOutlineTrendingUp, HiOutlineTrendingDown, HiOutlineArrowRight,
  HiOutlineScale, HiOutlineReceiptTax,
} from 'react-icons/hi';
import { getReportDashboardAPI } from '../../services/api';
import { formatINR } from './reportUtils';

const CARDS = [
  { to: '/reports/sales', title: 'Sales', desc: 'Revenue by month, hospital, service', icon: HiOutlineCurrencyRupee, color: 'bg-primary-50 text-primary-700' },
  { to: '/reports/expenses', title: 'Expenses', desc: 'Category-wise + monthly trend', icon: HiOutlineDocumentText, color: 'bg-amber-50 text-amber-700' },
  { to: '/reports/profit', title: 'Profit', desc: 'Sales − Expenses, monthly', icon: HiOutlineTrendingUp, color: 'bg-green-50 text-green-700' },
  { to: '/reports/references', title: 'References', desc: 'Business vs commission', icon: HiOutlineUserGroup, color: 'bg-purple-50 text-purple-700' },
  { to: '/reports/cash-bank', title: 'Cash / Bank', desc: 'In/Out + running balance', icon: HiOutlineCash, color: 'bg-blue-50 text-blue-700' },
  { to: '/reports/balance-sheet', title: 'Balance Sheet', desc: 'Assets vs Liabilities, as on date', icon: HiOutlineScale, color: 'bg-indigo-50 text-indigo-700' },
  { to: '/reports/taxes', title: 'Taxes & Discounts', desc: 'Discount, TDS in/out, GST in/out', icon: HiOutlineReceiptTax, color: 'bg-rose-50 text-rose-700' },
];

const ReportsHub = () => {
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getReportDashboardAPI()
      .then(({ data }) => setDash(data))
      .catch(() => setDash(null))
      .finally(() => setLoading(false));
  }, []);

  const m = dash?.thisMonth || {};
  const cb = dash?.cashBank || {};
  const profitColor = (m.profit || 0) >= 0 ? 'text-green-700' : 'text-red-700';
  const ProfitIcon = (m.profit || 0) >= 0 ? HiOutlineTrendingUp : HiOutlineTrendingDown;

  return (
    <div>
      {/* Dashboard tiles */}
      {loading ? (
        <div className="p-6 bg-white border border-gray-200 rounded-xl text-sm text-gray-500">Loading dashboard…</div>
      ) : dash ? (
        <>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">This Month · {dash.filters?.monthLabel}</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Tile label="Sales" value={formatINR(m.sales)} sub={`${m.invoiceCount || 0} invoices`} className="bg-primary-600 text-white" />
            <Tile label="Expenses" value={formatINR(m.expense)} sub={`${m.expenseCount || 0} entries`} className="bg-white border border-gray-200" />
            <Tile label="Profit" value={formatINR(m.profit)} sub={null} className={`bg-white border border-gray-200 ${profitColor}`} ProfitIcon={ProfitIcon} />
            <Tile label="Receivables" value={formatINR(dash.receivables?.outstandingTotal)} sub="Outstanding" className="bg-white border border-gray-200" />
          </div>

          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Cash on hand · Today</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <Tile label="Cash" value={formatINR(cb.cash)} sub={null} className="bg-white border border-gray-200" />
            <Tile label="Bank" value={formatINR(cb.bank)} sub={null} className="bg-white border border-gray-200" />
            <Tile label="UPI" value={formatINR(cb.upi)} sub={null} className="bg-white border border-gray-200" />
            <Tile label="Total" value={formatINR(cb.total)} sub={`+${formatINR(cb.paymentsReceivedThisMonth)} this month`} className="bg-primary-600 text-white" />
          </div>

          {(dash.topHospital || dash.topReference) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-5">
              {dash.topHospital && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Top hospital this month</p>
                  <p className="text-base font-semibold text-gray-800 mt-1">{dash.topHospital.name}</p>
                  <p className="text-sm text-gray-500">{formatINR(dash.topHospital.value)} in sales</p>
                </div>
              )}
              {dash.topReference && (
                <div className="bg-white border border-gray-200 rounded-xl p-4">
                  <p className="text-xs uppercase tracking-wide text-gray-500">Top reference this month</p>
                  <p className="text-base font-semibold text-gray-800 mt-1">{dash.topReference.name}</p>
                  <p className="text-sm text-gray-500">{formatINR(dash.topReference.value)} in commission</p>
                </div>
              )}
            </div>
          )}
        </>
      ) : null}

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Report families</h2>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {CARDS.map((c) => (
          <Link key={c.to} to={c.to}
            className="block bg-white border border-gray-200 hover:border-primary-300 rounded-xl p-4 transition-colors group">
            <div className="flex items-start gap-3">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${c.color}`}>
                <c.icon className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-800">{c.title}</h3>
                <p className="text-xs text-gray-500 mt-0.5">{c.desc}</p>
              </div>
              <HiOutlineArrowRight className="w-4 h-4 text-gray-300 group-hover:text-primary-600" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

const Tile = ({ label, value, sub, className, ProfitIcon }) => (
  <div className={`rounded-xl p-4 ${className}`}>
    <div className="flex items-center gap-1.5">
      {ProfitIcon && <ProfitIcon className="w-4 h-4" />}
      <p className="text-xs uppercase tracking-wide opacity-75">{label}</p>
    </div>
    <p className="text-xl font-bold mt-1">{value}</p>
    {sub && <p className="text-xs opacity-75 mt-0.5">{sub}</p>}
  </div>
);

export default ReportsHub;
