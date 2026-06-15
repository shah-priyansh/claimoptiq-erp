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
  { to: '/references',     label: 'References',          icon: HiOutlineTag,            module: 'references' },
  { to: '/users',          label: 'Users',               icon: HiOutlineUserGroup,      module: 'users' },
  { to: '/roles',          label: 'Roles & Permissions', icon: HiOutlineKey,            module: 'roles' },
  { to: '/claim-statuses',        label: 'Claim Status Master',   icon: HiOutlineTag,          module: 'claim_statuses' },
  { to: '/claim-document-types',  label: 'Document Types',        icon: HiOutlineDocumentText, module: 'claim_document_types' },
  { to: '/billing-service-names', label: 'Billing Service Names', icon: HiOutlineCog,          module: 'billing_service_names' },
  { to: '/tds-rates',             label: 'TDS Rates',             icon: HiOutlineTag,          module: 'tds_rates' },
  { to: '/expense-categories',    label: 'Expense Categories',    icon: HiOutlineTag,          module: 'expense_categories' },
];

const Sidebar = ({ isOpen, onClose }) => {
  const { canViewModule, canManageModule, user, roleSlug } = useAuth();
  const isSuperAdmin = roleSlug === 'super_admin';
  const location = useLocation();

  const isAdminRoute = adminItems.some(item => location.pathname.startsWith(item.to));
  const [adminOpen, setAdminOpen] = useState(isAdminRoute);

  const visibleAdminItems = adminItems.filter(item => canManageModule(item.module));
  const hasAdminAccess = visibleAdminItems.length > 0;

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
      isActive
        ? 'bg-primary-600 text-white shadow-sm shadow-primary-200'
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
        className={`fixed top-0 left-0 z-30 h-full w-64 bg-white border-r border-gray-100 flex flex-col transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 h-16 border-b border-gray-100 flex-shrink-0">
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center shadow-sm shadow-primary-200">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
                <rect x="5" y="2" width="14" height="18" rx="2" fill="white" fillOpacity="0.95" />
                <rect x="8" y="7"  width="8" height="1.5" rx="0.75" fill="#2563eb" />
                <rect x="8" y="11" width="6" height="1.5" rx="0.75" fill="#2563eb" />
                <rect x="8" y="15" width="4" height="1.5" rx="0.75" fill="#2563eb" />
              </svg>
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-green-500 rounded-full border-2 border-white" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[15px] font-bold text-gray-900 leading-tight tracking-tight">ClaimOPTIQ</h1>
            <p className="text-[10px] text-gray-400 font-semibold tracking-widest uppercase mt-0.5">FCC ERP Suite</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto mt-2 px-3 pb-4 space-y-0.5">

          {canViewModule('dashboard') && (
            <NavLink to="/dashboard" className={linkClass} onClick={onClose}>
              <HiOutlineHome className="w-5 h-5 flex-shrink-0" />
              Dashboard
            </NavLink>
          )}

          {canViewModule('claims') && (
            <NavLink to="/claims" className={linkClass} onClick={onClose}>
              <HiOutlineDocumentText className="w-5 h-5 flex-shrink-0" />
              Claims
            </NavLink>
          )}

          {canViewModule('invoices') && (
            <NavLink to="/invoices" className={linkClass} onClick={onClose}>
              <HiOutlineClipboardList className="w-5 h-5 flex-shrink-0" />
              Invoices
            </NavLink>
          )}

          {canViewModule('expenses') && (
            <NavLink to="/expenses" className={linkClass} onClick={onClose}>
              <HiOutlineDocumentText className="w-5 h-5 flex-shrink-0" />
              Expenses
            </NavLink>
          )}

          {canViewModule('cash_bank') && (
            <NavLink to="/cash-bank" className={linkClass} onClick={onClose}>
              <HiOutlineChartBar className="w-5 h-5 flex-shrink-0" />
              Cash / Bank
            </NavLink>
          )}

          {canViewModule('account_entries') && (
            <NavLink to="/account-entries" className={linkClass} onClick={onClose}>
              <HiOutlineDocumentText className="w-5 h-5 flex-shrink-0" />
              Account Entries
            </NavLink>
          )}

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

          {hasAdminAccess && (
            <div className="pt-1">
              <button
                onClick={() => setAdminOpen(o => !o)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
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
                    <NavLink key={item.to} to={item.to} className={subLinkClass} onClick={onClose}>
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )}

          {canViewModule('reports') && (
            <NavLink to="/reports" className={linkClass} onClick={onClose}>
              <HiOutlineChartBar className="w-5 h-5 flex-shrink-0" />
              FCC Bill Generate
            </NavLink>
          )}
          {canViewModule('staff') && (
            <NavLink to="/staff" className={linkClass} onClick={onClose}>
              <HiOutlineUserGroup className="w-5 h-5 flex-shrink-0" />
              Staff
            </NavLink>
          )}
          {isSuperAdmin && (
            <NavLink to="/settings" className={linkClass} onClick={onClose}>
              <HiOutlineCog className="w-5 h-5 flex-shrink-0" />
              Settings
            </NavLink>
          )}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
