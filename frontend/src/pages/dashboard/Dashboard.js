import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardAPI, getReportDashboardAPI } from '../../services/api';
import { formatINR } from '../reports/reportUtils';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineDocumentText,
  HiOutlineCheckCircle,
  HiOutlineOfficeBuilding,
  HiOutlineCurrencyRupee,
  HiOutlineTrendingUp,
  HiOutlineTrendingDown,
  HiOutlineCash,
  HiOutlineReceiptTax,
  HiOutlineUpload,
  HiChevronRight,
  HiX,
} from 'react-icons/hi';
import { statusCardStyle } from '../claimstatus/ClaimStatusMaster';
import Loader from '../../components/ui/Loader';

const StatCard = ({ title, value, icon: Icon, color, subtitle, valueClassName = 'text-gray-900', onClick }) => {
  const clickable = typeof onClick === 'function';
  const Wrap = clickable ? 'button' : 'div';
  return (
    <Wrap
      {...(clickable ? { onClick, type: 'button' } : {})}
      className={`block text-left w-full bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 ${clickable ? 'cursor-pointer hover:border-primary-200 focus:outline-none focus:ring-2 focus:ring-primary-200' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider leading-none">{title}</p>
          <p className={`text-3xl font-bold mt-2 tabular-nums leading-none ${valueClassName}`}>{value}</p>
          {subtitle && <p className="text-xs text-gray-400 mt-2 leading-tight">{subtitle}</p>}
        </div>
        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${color}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </Wrap>
  );
};

// Click-through breakdown for a stat card — either a record list (`list`) or
// label/value `rows`, built from data already in the dashboard payload. The
// footer link jumps to the matching full report/list page.
const DetailModal = ({ detail, onClose, onNavigate }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!detail) return null;
  const { title, value, valueClassName, icon: Icon, color, rows = [], list, note, link, emptyText, countLabel } = detail;
  const isList = Array.isArray(list);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm p-4 animate-[fadeIn_0.15s_ease-out]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 w-full max-w-lg flex flex-col max-h-[85vh] overflow-hidden animate-[modalIn_0.18s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider truncate">{title}</p>
              <p className={`text-2xl font-bold tabular-nums leading-tight ${valueClassName || 'text-gray-900'}`}>{value}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 flex-shrink-0 transition-colors">
            <HiX className="w-5 h-5" />
          </button>
        </div>

        {/* List sub-header: count + sort hint */}
        {isList && list.length > 0 && (
          <div className="flex items-center justify-between px-5 py-2.5 bg-gray-50/70 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500">{countLabel || `${list.length} items`}</span>
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Highest first</span>
          </div>
        )}

        {/* Body */}
        <div className="px-5 py-1 overflow-y-auto">
          {isList ? (
            list.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {list.map((it, i) => (
                  <li key={it.id || i} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{it.label || '—'}</p>
                      {(it.sub || it.date) && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">
                          {[it.sub, it.date ? formatDate(it.date) : null].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums flex-shrink-0">{formatINR(it.amount || 0)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-400 py-8 text-center">{emptyText || 'No records this month.'}</p>
            )
          ) : rows.length > 0 ? (
            <div className="divide-y divide-gray-100">
              {rows.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-4 py-3">
                  <span className="flex items-center gap-2 text-sm text-gray-600 min-w-0">
                    {r.dot && <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: r.dot }} />}
                    <span className="truncate">{r.label}</span>
                  </span>
                  <span className={`text-sm tabular-nums flex-shrink-0 ${r.strong ? 'font-bold' : 'font-semibold'} ${r.valueClassName || 'text-gray-800'}`}>{r.value}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 py-8 text-center">No further breakdown available.</p>
          )}
          {note && <p className="text-xs text-gray-400 mt-3 mb-2">{note}</p>}
        </div>

        {/* Footer */}
        {link && (
          <div className="px-5 py-4 border-t border-gray-100">
            <button
              type="button"
              onClick={() => onNavigate(link.to)}
              className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-xl font-semibold transition-colors"
            >
              {link.label}
              <HiChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{children}</p>
);

const SHOW_REVENUE_SLUGS = ['super_admin', 'hospital_admin'];

const CACHE_KEY = 'dashboard_stats';
const FINANCE_CACHE_KEY = 'dashboard_finance';
const CACHE_TTL = 60 * 1000; // 1 minute

const readCache = (key) => {
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}
  return null;
};

const Dashboard = () => {
  const { roleSlug, canViewModule, user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(() => readCache(CACHE_KEY));
  const [finance, setFinance] = useState(() => readCache(FINANCE_CACHE_KEY));
  const [loading, setLoading] = useState(!stats);
  const [openKey, setOpenKey] = useState(null);
  const showRevenue = SHOW_REVENUE_SLUGS.includes(roleSlug);
  const isHospitalAdmin = roleSlug === 'hospital_admin';
  const isSuperAdmin = roleSlug === 'super_admin';

  useEffect(() => {
    getDashboardAPI()
      .then((res) => {
        setStats(res.data);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({ data: res.data, ts: Date.now() }));
        } catch {}
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Finance figures (Sales / Expenses / Profit / Receivables) come from the
  // reports dashboard so they match the Reports Hub exactly. Only super_admin
  // sees these tiles and can call this endpoint (super_admin bypasses perms).
  useEffect(() => {
    if (!isSuperAdmin) return;
    getReportDashboardAPI()
      .then((res) => {
        setFinance(res.data);
        try {
          sessionStorage.setItem(FINANCE_CACHE_KEY, JSON.stringify({ data: res.data, ts: Date.now() }));
        } catch {}
      })
      .catch(() => {});
  }, [isSuperAdmin]);

  if (loading) {
    return (
      <Loader className="h-64" />
    );
  }

  const ms = stats?.monthlyStats || {};
  const fin = finance?.thisMonth || {};
  const profitVal = fin.profit || 0;
  const monthLabel = new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const statusRows = (stats?.statusBreakdown || [])
    .filter((s) => s.count > 0)
    .map((s) => ({ label: s.label, value: s.count, dot: statusCardStyle(s.color).bar }));

  const settledN = (ms.settledList || []).length;
  const salesN = (fin.salesList || []).length;
  const expenseN = (fin.expenseList || []).length;

  // Per-card breakdowns shown in the click-through modal. Cards backed by real
  // records (settlements / sales / expenses) show that list; the rest show a
  // small label/value breakdown. Keyed so the modal always reads fresh data.
  const D = {
    totalClaims: {
      title: 'Total Claims', value: stats?.total || 0,
      icon: HiOutlineDocumentText, color: 'bg-primary-100 text-primary-600',
      rows: statusRows, note: 'Breakdown by current status',
      link: { to: '/claims', label: 'View all claims' },
    },
    hospitals: {
      title: 'Total Hospitals', value: stats?.hospitalCount || 0,
      icon: HiOutlineOfficeBuilding, color: 'bg-indigo-100 text-indigo-600',
      rows: [
        { label: 'Active', value: stats?.hospitalActive || 0, valueClassName: 'text-green-600' },
        { label: 'Inactive', value: stats?.hospitalInactive || 0, valueClassName: 'text-gray-500' },
      ],
      link: { to: '/hospitals', label: 'Manage hospitals' },
    },
    settlements: {
      title: 'Monthly Settlements', value: formatINR(ms.totalApprovalAmount || 0),
      icon: HiOutlineCurrencyRupee, color: 'bg-teal-100 text-teal-600',
      list: ms.settledList || [], emptyText: 'No claims settled this month.',
      countLabel: `${settledN} claim${settledN === 1 ? '' : 's'} settled`,
      note: `Counted by settlement date · ${monthLabel}`,
      link: { to: '/reports/claim-settlement', label: 'View settlement report' },
    },
    haSettled: {
      title: 'Settled Claims', value: ms.count || 0,
      icon: HiOutlineCheckCircle, color: 'bg-teal-100 text-teal-600',
      list: ms.settledList || [], emptyText: 'No claims settled this month.',
      countLabel: `${settledN} claim${settledN === 1 ? '' : 's'} settled`,
      note: `This month · ${monthLabel}`,
      link: { to: '/claims?status=settled', label: 'View settled claims' },
    },
    haApproved: {
      title: 'Approved Amount', value: formatINR(ms.totalApprovalAmount || 0),
      icon: HiOutlineCurrencyRupee, color: 'bg-green-100 text-green-600',
      list: ms.settledList || [], emptyText: 'No claims settled this month.',
      countLabel: `${settledN} claim${settledN === 1 ? '' : 's'} settled`,
      note: `Your hospital · ${monthLabel}`,
      link: { to: '/claims?status=settled', label: 'View settled claims' },
    },
    revenue: {
      title: 'Monthly Revenue', value: formatINR(fin.sales || 0),
      icon: HiOutlineTrendingUp, color: 'bg-green-100 text-green-600',
      list: fin.salesList || [], emptyText: 'No invoices this month.',
      countLabel: `${salesN} invoice${salesN === 1 ? '' : 's'}`,
      note: `Invoice sales · ${monthLabel}`,
      link: { to: '/reports/sales', label: 'View sales report' },
    },
    expenses: {
      title: 'Expenses', value: formatINR(fin.expense || 0),
      icon: HiOutlineCash, color: 'bg-amber-100 text-amber-600',
      list: fin.expenseList || [], emptyText: 'No expenses this month.',
      countLabel: `${expenseN} ${expenseN === 1 ? 'entry' : 'entries'}`,
      note: monthLabel,
      link: { to: '/reports/expenses', label: 'View expenses report' },
    },
    profit: {
      title: 'Profit', value: formatINR(profitVal),
      valueClassName: profitVal >= 0 ? 'text-green-600' : 'text-red-600',
      icon: profitVal >= 0 ? HiOutlineTrendingUp : HiOutlineTrendingDown,
      color: profitVal >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600',
      rows: [
        { label: 'Sales', value: formatINR(fin.sales || 0) },
        { label: 'Expenses', value: `− ${formatINR(fin.expense || 0)}` },
        { label: 'Profit', value: formatINR(profitVal), strong: true, valueClassName: profitVal >= 0 ? 'text-green-600' : 'text-red-600' },
      ],
      note: `Sales − Expenses · ${monthLabel}`,
      link: { to: '/reports/profit', label: 'View profit report' },
    },
    receivables: {
      title: 'Receivables', value: formatINR(finance?.receivables?.outstandingTotal || 0),
      icon: HiOutlineReceiptTax, color: 'bg-blue-100 text-blue-600',
      rows: [
        { label: 'Outstanding total', value: formatINR(finance?.receivables?.outstandingTotal || 0) },
      ],
      note: 'Unpaid & partially-paid invoices',
      link: { to: '/invoices', label: 'View invoices' },
    },
  };

  return (
    <div className="space-y-6">

      {/* Upload CTA */}
      {canViewModule('document_submissions') && user?.hospital && (
        <button
          onClick={() => navigate('/documents/upload')}
          className="w-full bg-gradient-to-r from-primary-600 to-primary-500 rounded-2xl p-5 flex items-center justify-between text-white hover:from-primary-700 hover:to-primary-600 shadow-md shadow-primary-200 hover:shadow-lg hover:shadow-primary-300 hover:-translate-y-0.5 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <HiOutlineUpload className="w-6 h-6" />
            </div>
            <div className="text-left">
              <p className="font-semibold text-base">Upload Documents</p>
              <p className="text-sm text-primary-100 mt-0.5">Send patient documents for a claim</p>
            </div>
          </div>
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center flex-shrink-0">
            <HiChevronRight className="w-5 h-5" />
          </div>
        </button>
      )}

      {/* Overview Stats */}
      <div>
        <SectionLabel>Overview</SectionLabel>
        {!showRevenue ? (
          <div className="grid grid-cols-1 gap-4">
            <StatCard
              title="Total Claims"
              value={stats?.total || 0}
              icon={HiOutlineDocumentText}
              color="bg-primary-100 text-primary-600"
              onClick={() => setOpenKey('totalClaims')}
            />
          </div>
        ) : isHospitalAdmin ? (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              title="Total Claims"
              value={stats?.total || 0}
              icon={HiOutlineDocumentText}
              color="bg-primary-100 text-primary-600"
              onClick={() => setOpenKey('totalClaims')}
            />
            <StatCard
              title="Settled Claims"
              value={stats?.monthlyStats?.count || 0}
              icon={HiOutlineCheckCircle}
              color="bg-teal-100 text-teal-600"
              subtitle="Settled claims this month"
              onClick={() => setOpenKey('haSettled')}
            />
            <StatCard
              title="Approved Amount"
              value={formatINR(stats?.monthlyStats?.totalApprovalAmount || 0)}
              icon={HiOutlineCurrencyRupee}
              color="bg-green-100 text-green-600"
              subtitle="Your hospital this month"
              onClick={() => setOpenKey('haApproved')}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Claims"
              value={stats?.total || 0}
              icon={HiOutlineDocumentText}
              color="bg-primary-100 text-primary-600"
              onClick={() => setOpenKey('totalClaims')}
            />
            <StatCard
              title="Total Hospitals"
              value={stats?.hospitalCount || 0}
              icon={HiOutlineOfficeBuilding}
              color="bg-indigo-100 text-indigo-600"
              onClick={() => setOpenKey('hospitals')}
              subtitle={
                (stats?.hospitalActive > 0 || stats?.hospitalInactive > 0) ? (
                  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {stats?.hospitalActive > 0 && (
                      <span className="text-green-600 font-semibold">{stats.hospitalActive} Active</span>
                    )}
                    {stats?.hospitalActive > 0 && stats?.hospitalInactive > 0 && (
                      <span className="text-gray-300">·</span>
                    )}
                    {stats?.hospitalInactive > 0 && (
                      <span className="text-gray-500 font-semibold">{stats.hospitalInactive} Inactive</span>
                    )}
                  </span>
                ) : null
              }
            />
            <StatCard
              title="Monthly Settlements"
              value={formatINR(stats?.monthlyStats?.totalApprovalAmount || 0)}
              icon={HiOutlineCurrencyRupee}
              color="bg-teal-100 text-teal-600"
              subtitle={`${stats?.monthlyStats?.count || 0} claim${stats?.monthlyStats?.count !== 1 ? 's' : ''} settled this month`}
              onClick={() => setOpenKey('settlements')}
            />
            <StatCard
              title="Monthly Revenue"
              value={formatINR(fin.sales || 0)}
              icon={HiOutlineTrendingUp}
              color="bg-green-100 text-green-600"
              subtitle={`${fin.invoiceCount || 0} invoice${fin.invoiceCount === 1 ? '' : 's'} this month`}
              onClick={() => setOpenKey('revenue')}
            />
            <StatCard
              title="Expenses"
              value={formatINR(fin.expense || 0)}
              icon={HiOutlineCash}
              color="bg-amber-100 text-amber-600"
              subtitle={`${fin.expenseCount || 0} ${fin.expenseCount === 1 ? 'entry' : 'entries'} this month`}
              onClick={() => setOpenKey('expenses')}
            />
            <StatCard
              title="Profit"
              value={formatINR(profitVal)}
              icon={profitVal >= 0 ? HiOutlineTrendingUp : HiOutlineTrendingDown}
              color={profitVal >= 0 ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}
              valueClassName={profitVal >= 0 ? 'text-green-600' : 'text-red-600'}
              subtitle="Sales − Expenses this month"
              onClick={() => setOpenKey('profit')}
            />
            <StatCard
              title="Receivables"
              value={formatINR(finance?.receivables?.outstandingTotal || 0)}
              icon={HiOutlineReceiptTax}
              color="bg-blue-100 text-blue-600"
              subtitle="Outstanding"
              onClick={() => setOpenKey('receivables')}
            />
          </div>
        )}
      </div>

      {/* Status Breakdown */}
      {stats?.statusBreakdown?.length > 0 && (
        <div>
          <SectionLabel>Status Breakdown</SectionLabel>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
              {stats.statusBreakdown.filter((item) => item.count > 0).map((item) => {
                const c = statusCardStyle(item.color);
                return (
                  <button
                    key={item.slug}
                    onClick={() => navigate(`/claims?status=${item.slug}`)}
                    className="relative overflow-hidden rounded-xl border border-transparent hover:shadow-sm hover:scale-[1.02] active:scale-100 transition-all duration-150 text-left p-4"
                    style={{ backgroundColor: c.bg }}
                  >
                    <div className="absolute left-0 top-0 bottom-0 w-1.5" style={{ backgroundColor: c.bar }} />
                    <p className="text-2xl font-bold tabular-nums mb-1 pl-3" style={{ color: c.num }}>{item.count}</p>
                    <p className="text-xs font-semibold leading-tight pl-3 capitalize" style={{ color: c.text }}>{item.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <DetailModal
        detail={openKey ? D[openKey] : null}
        onClose={() => setOpenKey(null)}
        onNavigate={(to) => { setOpenKey(null); navigate(to); }}
      />

    </div>
  );
};

export default Dashboard;
