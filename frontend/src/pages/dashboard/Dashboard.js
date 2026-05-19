import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardAPI } from '../../services/api';
import { formatCurrencyCompact } from '../../utils/format';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineDocumentText,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineBadgeCheck,
  HiOutlineOfficeBuilding,
  HiOutlineXCircle,
  HiOutlineCurrencyRupee,
  HiOutlineUpload,
  HiChevronRight,
} from 'react-icons/hi';

const StatCard = ({ title, value, icon: Icon, color, subtitle }) => (
  <div className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-500 font-medium">{title}</p>
        <p className="text-2xl font-bold text-gray-800 mt-1">{value}</p>
        {subtitle && <p className="text-xs text-gray-400 mt-1">{subtitle}</p>}
      </div>
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6" />
      </div>
    </div>
  </div>
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

const Dashboard = () => {
  const { roleSlug, canViewModule } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const showRevenue = SHOW_REVENUE_SLUGS.includes(roleSlug);
  const isHospitalAdmin = roleSlug === 'hospital_admin';

  useEffect(() => {
    getDashboardAPI()
      .then((res) => setStats(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Overview of your claim operations</p>
      </div>

      {canViewModule('document_submissions') && (
        <button
          onClick={() => navigate('/documents/upload')}
          className="w-full bg-gradient-to-r from-primary-600 to-primary-500 rounded-xl p-5 mb-6 flex items-center justify-between text-white hover:from-primary-700 hover:to-primary-600 transition-all"
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
          <HiChevronRight className="w-5 h-5 flex-shrink-0 opacity-80" />
        </button>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <StatCard
          title="Total Claims"
          value={stats?.total || 0}
          icon={HiOutlineDocumentText}
          color="bg-primary-100 text-primary-600"
        />
        <StatCard
          title="In Process"
          value={stats?.inProcess || 0}
          icon={HiOutlineClock}
          color="bg-amber-100 text-amber-600"
        />
        <StatCard
          title="Approved"
          value={stats?.approved || 0}
          icon={HiOutlineBadgeCheck}
          color="bg-blue-100 text-blue-600"
        />
        <StatCard
          title="Settled"
          value={stats?.completed || 0}
          icon={HiOutlineCheckCircle}
          color="bg-emerald-100 text-emerald-600"
        />
        <StatCard
          title="Rejected"
          value={stats?.rejected || 0}
          icon={HiOutlineXCircle}
          color="bg-red-100 text-red-600"
        />
      </div>

      {showRevenue && (
        isHospitalAdmin ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <StatCard
              title="Monthly Approved Claims"
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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard
              title="Total Hospitals"
              value={stats?.hospitalCount || 0}
              icon={HiOutlineOfficeBuilding}
              color="bg-indigo-100 text-indigo-600"
            />
            <StatCard
              title="Monthly Settlements"
              value={stats?.monthlyStats?.count || 0}
              icon={HiOutlineCurrencyRupee}
              color="bg-teal-100 text-teal-600"
              subtitle={`Total: ${formatCurrencyCompact(stats?.monthlyStats?.totalSettlement || 0)}`}
            />
            <StatCard
              title="Monthly Revenue"
              value={formatCurrencyCompact(stats?.monthlyStats?.totalFilePrice || 0)}
              icon={HiOutlineCurrencyRupee}
              color="bg-green-100 text-green-600"
              subtitle="From file charges"
            />
          </div>
        )
      )}

      {/* Status Breakdown */}
      {stats?.statusBreakdown?.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Claim Status Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {stats.statusBreakdown.map((item) => {
              const c = STATUS_CARD_COLOR[item.color] || STATUS_CARD_COLOR.gray;
              return (
                <button
                  key={item.slug}
                  onClick={() => navigate(`/claims?status=${item.slug}`)}
                  className={`relative overflow-hidden rounded-xl border border-transparent ${c.bg} hover:border-current hover:shadow-sm transition-all text-left p-4 group`}
                >
                  <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${c.bar}`} />
                  <p className={`text-2xl font-bold mb-1 pl-2 ${c.num}`}>{item.count}</p>
                  <p className={`text-xs font-medium leading-tight pl-2 ${c.text}`}>{item.label}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
