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
import { statusCardStyle } from '../claimstatus/ClaimStatusMaster';
import Loader from '../../components/ui/Loader';

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
      <Loader className="h-64" />
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

    </div>
  );
};

export default Dashboard;
