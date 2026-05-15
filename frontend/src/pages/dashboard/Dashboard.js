import React, { useState, useEffect } from 'react';
import { getDashboardAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineDocumentText,
  HiOutlineClock,
  HiOutlineCheckCircle,
  HiOutlineBadgeCheck,
  HiOutlineOfficeBuilding,
  HiOutlineXCircle,
  HiOutlineCurrencyRupee
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

const Dashboard = () => {
  const { roleSlug } = useAuth();
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
              value={`Rs ${(stats?.monthlyStats?.totalApprovalAmount || 0).toLocaleString('en-IN')}`}
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
              subtitle={`Total: Rs ${(stats?.monthlyStats?.totalSettlement || 0).toLocaleString('en-IN')}`}
            />
            <StatCard
              title="Monthly Revenue"
              value={`Rs ${(stats?.monthlyStats?.totalFilePrice || 0).toLocaleString('en-IN')}`}
              icon={HiOutlineCurrencyRupee}
              color="bg-green-100 text-green-600"
              subtitle="From file charges"
            />
          </div>
        )
      )}

      {/* Status Breakdown */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Claim Status Breakdown</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {[
            { label: 'Admitted', value: stats?.admitted || 0, color: 'bg-blue-500' },
            { label: 'Discharged', value: stats?.discharged || 0, color: 'bg-yellow-500' },
            { label: 'File Received', value: stats?.fileReceived || 0, color: 'bg-purple-500' },
            { label: 'Submitted', value: stats?.submitted || 0, color: 'bg-orange-500' },
            { label: 'Settled', value: stats?.completed || 0, color: 'bg-green-500' },
            { label: 'Rejected', value: stats?.rejected || 0, color: 'bg-red-500' },
          ].map((item) => (
            <div key={item.label} className="text-center">
              <div className={`w-3 h-3 rounded-full ${item.color} mx-auto mb-2`}></div>
              <p className="text-xl font-bold text-gray-800">{item.value}</p>
              <p className="text-xs text-gray-500">{item.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
