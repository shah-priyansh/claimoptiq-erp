import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineHome,
  HiOutlineDocumentText,
  HiOutlineCog,
  HiOutlineChartBar,
  HiOutlineUpload,
} from 'react-icons/hi';

const adminPaths = ['/hospitals', '/insurance', '/tpa', '/users', '/roles', '/claim-statuses'];
const adminModules = ['hospitals', 'insurance', 'tpa', 'users', 'roles', 'claim_statuses'];

const BottomNav = () => {
  const { canViewModule } = useAuth();
  const location = useLocation();

  const isAdminActive = adminPaths.some(p => location.pathname.startsWith(p));

  const firstAdminPath = [
    { path: '/hospitals', module: 'hospitals' },
    { path: '/insurance', module: 'insurance' },
    { path: '/tpa', module: 'tpa' },
    { path: '/users', module: 'users' },
    { path: '/roles', module: 'roles' },
    { path: '/claim-statuses', module: 'claim_statuses' },
  ].find(item => canViewModule(item.module))?.path || '/hospitals';

  const hasAdminAccess = adminModules.some(m => canViewModule(m));

  const tabCls = (active) =>
    `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors min-h-[56px] ${
      active ? 'text-primary-600' : 'text-gray-400'
    }`;

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="flex items-stretch">
        {canViewModule('dashboard') && (
          <NavLink to="/dashboard" className={({ isActive }) => tabCls(isActive)}>
            <HiOutlineHome className="w-6 h-6" />
            Home
          </NavLink>
        )}
        {canViewModule('claims') && (
          <NavLink to="/claims" className={({ isActive }) => tabCls(isActive)}>
            <HiOutlineDocumentText className="w-6 h-6" />
            Claims
          </NavLink>
        )}
        {canViewModule('document_submissions') && (
          <NavLink to="/documents/upload" className={({ isActive }) => tabCls(isActive)}>
            <HiOutlineUpload className="w-6 h-6" />
            Upload
          </NavLink>
        )}
        {hasAdminAccess && (
          <NavLink to={firstAdminPath} className={() => tabCls(isAdminActive)}>
            <HiOutlineCog className="w-6 h-6" />
            Admin
          </NavLink>
        )}
        {canViewModule('reports') && (
          <NavLink to="/reports" className={({ isActive }) => tabCls(isActive)}>
            <HiOutlineChartBar className="w-6 h-6" />
            Reports
          </NavLink>
        )}
      </div>
    </nav>
  );
};

export default BottomNav;
