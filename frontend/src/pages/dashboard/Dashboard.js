import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardAPI } from '../../services/api';
import { formatCurrencyCompact } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineDocumentText,
  HiOutlineCheckCircle,
  HiOutlineOfficeBuilding,
  HiOutlineCurrencyRupee,
  HiOutlineTrendingUp,
  HiOutlineUpload,
  HiChevronRight,
} from 'react-icons/hi';

const StatCard = ({ title, value, icon: Icon, color, subtitle }) => (
  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider leading-none">{title}</p>
        <p className="text-3xl font-bold text-gray-900 mt-2 tabular-nums leading-none">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-2 leading-tight">{subtitle}</p>}
      </div>
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  </div>
);

const SectionLabel = ({ children }) => (
  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{children}</p>
);

const SHOW_REVENUE_SLUGS = ['super_admin', 'hospital_admin'];

const STATUS_CARD_COLOR = {
  blue:   { bar: 'bg-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700',   num: 'text-blue-800'   },
  green:  { bar: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  num: 'text-green-800'  },
  red:    { bar: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700',    num: 'text-red-800'    },
  yellow: { bar: 'bg-yellow-400', bg: 'bg-yellow-50', text: 'text-yellow-700', num: 'text-yellow-800' },
  purple: { bar: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', num: 'text-purple-800' },
  orange: { bar: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', num: 'text-orange-800' },
  pink:   { bar: 'bg-pink-500',   bg: 'bg-pink-50',   text: 'text-pink-700',   num: 'text-pink-800'   },
  indigo: { bar: 'bg-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-700', num: 'text-indigo-800' },
  teal:   { bar: 'bg-teal-500',   bg: 'bg-teal-50',   text: 'text-teal-700',   num: 'text-teal-800'   },
  gray:   { bar: 'bg-gray-400',   bg: 'bg-gray-50',   text: 'text-gray-600',   num: 'text-gray-700'   },
};

const CACHE_KEY = 'dashboard_stats';
const CACHE_TTL = 60 * 1000; // 1 minute

const Dashboard = () => {
  const { roleSlug, canViewModule, user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(() => {
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const { data, ts } = JSON.parse(cached);
        if (Date.now() - ts < CACHE_TTL) return data;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(!stats);
  const showRevenue = SHOW_REVENUE_SLUGS.includes(roleSlug);
  const isHospitalAdmin = roleSlug === 'hospital_admin';

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

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
            <StatCard title="Total Claims" value={stats?.total || 0} icon={HiOutlineDocumentText} color="bg-primary-100 text-primary-600" />
          </div>
        ) : isHospitalAdmin ? (
          <div className="grid grid-cols-3 gap-4">
            <StatCard
              title="Total Claims"
              value={stats?.total || 0}
              icon={HiOutlineDocumentText}
              color="bg-primary-100 text-primary-600"
            />
            <StatCard
              title="Settled Claims"
              value={stats?.monthlyStats?.count || 0}
              icon={HiOutlineCheckCircle}
              color="bg-teal-100 text-teal-600"
              subtitle="Settled claims this month"
            />
            <StatCard
              title="Approved Amount"
              value={formatCurrencyCompact(stats?.monthlyStats?.totalApprovalAmount || 0)}
              icon={HiOutlineCurrencyRupee}
              color="bg-green-100 text-green-600"
              subtitle="Your hospital this month"
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Total Claims"
              value={stats?.total || 0}
              icon={HiOutlineDocumentText}
              color="bg-primary-100 text-primary-600"
            />
            <StatCard
              title="Total Hospitals"
              value={stats?.hospitalCount || 0}
              icon={HiOutlineOfficeBuilding}
              color="bg-indigo-100 text-indigo-600"
            />
            <StatCard
              title="Monthly Settlements"
              value={formatCurrencyCompact(stats?.monthlyStats?.totalApprovalAmount || 0)}
              icon={HiOutlineCurrencyRupee}
              color="bg-teal-100 text-teal-600"
              subtitle={`${stats?.monthlyStats?.count || 0} claim${stats?.monthlyStats?.count !== 1 ? 's' : ''} settled this month`}
            />
            <StatCard
              title="Monthly Revenue"
              value={formatCurrencyCompact(stats?.monthlyStats?.totalFilePrice || 0)}
              icon={HiOutlineTrendingUp}
              color="bg-green-100 text-green-600"
              subtitle="From file charges this month"
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
              {stats.statusBreakdown.map((item) => {
                const c = STATUS_CARD_COLOR[item.color] || STATUS_CARD_COLOR.gray;
                return (
                  <button
                    key={item.slug}
                    onClick={() => navigate(`/claims?status=${item.slug}`)}
                    className={`relative overflow-hidden rounded-xl border border-transparent ${c.bg} hover:shadow-sm hover:scale-[1.02] active:scale-100 transition-all duration-150 text-left p-4`}
                  >
                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${c.bar}`} />
                    <p className={`text-2xl font-bold tabular-nums mb-1 pl-3 ${c.num}`}>{item.count}</p>
                    <p className={`text-xs font-semibold leading-tight pl-3 ${c.text}`}>{item.label}</p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

export default Dashboard;
