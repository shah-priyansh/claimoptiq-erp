import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineHome,
  HiOutlineOfficeBuilding,
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineShieldCheck,
  HiOutlineClipboardList,
  HiOutlineChartBar,
  HiOutlineKey,
  HiOutlineTag,
  HiOutlineCog,
  HiOutlineChevronDown,
  HiOutlineInbox,
  HiOutlineCloudUpload,
} from 'react-icons/hi';

const adminItems = [
  { to: '/hospitals',      label: 'Hospitals',           icon: HiOutlineOfficeBuilding, module: 'hospitals' },
  { to: '/insurance',      label: 'Insurance Companies', icon: HiOutlineShieldCheck,    module: 'insurance' },
  { to: '/tpa',            label: 'TPA',                 icon: HiOutlineClipboardList,  module: 'tpa' },
  { to: '/users',          label: 'Users',               icon: HiOutlineUserGroup,      module: 'users' },
  { to: '/roles',          label: 'Roles & Permissions', icon: HiOutlineKey,            module: 'roles' },
  { to: '/claim-statuses',         label: 'Claim Status Master',    icon: HiOutlineTag,           module: 'claim_statuses' },
  { to: '/claim-document-types',   label: 'Document Types',         icon: HiOutlineDocumentText,  module: 'claim_document_types' },
  { to: '/billing-service-names',  label: 'Billing Service Names',  icon: HiOutlineCog,           module: 'billing_service_names' },
];

const Sidebar = ({ isOpen, onClose }) => {
  const { canViewModule, user } = useAuth();
  const location = useLocation();

  const isAdminRoute = adminItems.some(item => location.pathname.startsWith(item.to));
  const [adminOpen, setAdminOpen] = useState(isAdminRoute);

  const visibleAdminItems = adminItems.filter(item => canViewModule(item.module));
  const hasAdminAccess = visibleAdminItems.length > 0;

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-600 text-white shadow-sm'
        : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
    }`;

  const subLinkClass = ({ isActive }) =>
    `flex items-center gap-3 pl-4 pr-3 py-2 rounded-lg text-sm transition-colors ${
      isActive
        ? 'bg-primary-50 text-primary-700 font-semibold'
        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700 font-medium'
    }`;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed top-0 left-0 z-30 h-full w-64 bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200 flex-shrink-0">
          <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">C</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary-800">ClaimOptiq</h1>
            <p className="text-xs text-gray-500">FCC ERP Suite</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto mt-3 px-3 pb-4 space-y-0.5">

          {/* Dashboard */}
          {canViewModule('dashboard') && (
            <NavLink to="/dashboard" className={linkClass} onClick={onClose}>
              <HiOutlineHome className="w-5 h-5 flex-shrink-0" />
              Dashboard
            </NavLink>
          )}

          {/* Claims */}
          {canViewModule('claims') && (
            <NavLink to="/claims" className={linkClass} onClick={onClose}>
              <HiOutlineDocumentText className="w-5 h-5 flex-shrink-0" />
              Claims
            </NavLink>
          )}

          {/* Documents: Upload for hospital staff, Inbox for FCC staff */}
          {canViewModule('document_submissions') && user?.hospital && (
            <NavLink to="/documents/upload" className={linkClass} onClick={onClose}>
              <HiOutlineCloudUpload className="w-5 h-5 flex-shrink-0" />
              Upload Document
            </NavLink>
          )}
          {canViewModule('document_submissions') && !user?.hospital && (
            <NavLink to="/documents/inbox" className={linkClass} onClick={onClose}>
              <HiOutlineInbox className="w-5 h-5 flex-shrink-0" />
              Document Inbox
            </NavLink>
          )}

          {/* Administration Group */}
          {hasAdminAccess && (
            <div className="pt-1">
              <button
                onClick={() => setAdminOpen(o => !o)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isAdminRoute
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <HiOutlineCog className="w-5 h-5 flex-shrink-0" />
                <span className="flex-1 text-left">Administration</span>
                <HiOutlineChevronDown
                  className={`w-4 h-4 transition-transform duration-200 ${adminOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {adminOpen && (
                <div className="mt-0.5 ml-3 pl-3 border-l-2 border-gray-100 space-y-0.5">
                  {visibleAdminItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      className={subLinkClass}
                      onClick={onClose}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Reports */}
          {canViewModule('reports') && (
            <NavLink to="/reports" className={linkClass} onClick={onClose}>
              <HiOutlineChartBar className="w-5 h-5 flex-shrink-0" />
              Reports
            </NavLink>
          )}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
