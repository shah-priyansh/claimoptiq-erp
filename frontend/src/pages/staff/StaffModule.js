import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getMyEmployeeAPI } from '../../services/api';
import EmployeeList from './EmployeeList';
import AttendanceTab from './AttendanceTab';
import SalaryTab from './SalaryTab';
import HolidayList from './HolidayList';

const TABS = [
  { key: 'employees', label: 'Employees', adminOnly: true },
  { key: 'attendance', label: 'Attendance' },
  { key: 'salary', label: 'Salary' },
  { key: 'holidays', label: 'Holidays', adminOnly: true },
];

const StaffModule = () => {
  const { can, roleSlug } = useAuth();
  const isAdmin = roleSlug === 'super_admin' || roleSlug === 'admin';
  const canView = can('staff', 'view');
  const canEdit = can('staff', 'edit');
  const canCreate = can('staff', 'create');

  const [isEmployee, setIsEmployee] = useState(false);
  const [activeTab, setActiveTab] = useState(isAdmin ? 'employees' : 'attendance');

  useEffect(() => {
    if (!isAdmin) {
      getMyEmployeeAPI().then(() => setIsEmployee(true)).catch(() => setIsEmployee(false));
    }
  }, [isAdmin]);

  useEffect(() => {
    setActiveTab(isAdmin ? 'employees' : 'attendance');
  }, [isAdmin]);

  const visibleTabs = TABS.filter(t => {
    if (t.adminOnly && !isAdmin) return false;
    return true;
  });

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 mb-6">
        {visibleTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-primary-600 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'employees' && isAdmin && (
        <EmployeeList canEdit={canEdit || canCreate} />
      )}
      {activeTab === 'attendance' && (
        <AttendanceTab isAdmin={isAdmin} canEdit={canEdit} />
      )}
      {activeTab === 'salary' && (
        <SalaryTab isAdmin={isAdmin} canEdit={canEdit} />
      )}
      {activeTab === 'holidays' && isAdmin && (
        <HolidayList canEdit={canEdit || canCreate} />
      )}
    </div>
  );
};

export default StaffModule;
