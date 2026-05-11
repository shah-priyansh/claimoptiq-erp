import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  HiOutlineHome,
  HiOutlineOfficeBuilding,
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineShieldCheck,
  HiOutlineClipboardList,
  HiOutlineChartBar,
  HiOutlineKey
} from 'react-icons/hi';

const Sidebar = ({ isOpen, onClose }) => {
  const { canViewModule } = useAuth();

  const navItems = [
    { to: '/dashboard', label: 'Dashboard', icon: HiOutlineHome, module: 'dashboard' },
    { to: '/claims', label: 'Claims', icon: HiOutlineDocumentText, module: 'claims' },
    { to: '/hospitals', label: 'Hospitals', icon: HiOutlineOfficeBuilding, module: 'hospitals' },
    { to: '/insurance', label: 'Insurance Companies', icon: HiOutlineShieldCheck, module: 'insurance' },
    { to: '/tpa', label: 'TPA', icon: HiOutlineClipboardList, module: 'tpa' },
    { to: '/users', label: 'Users', icon: HiOutlineUserGroup, module: 'users' },
    { to: '/roles', label: 'Roles & Permissions', icon: HiOutlineKey, module: 'roles' },
    { to: '/reports', label: 'Reports', icon: HiOutlineChartBar, module: 'reports' },
  ];

  const linkClass = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-primary-600 text-white shadow-md'
        : 'text-gray-600 hover:bg-primary-50 hover:text-primary-700'
    }`;

  return (
    <>
      {isOpen && (
        <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={onClose} />
      )}
      <aside
        className={`fixed top-0 left-0 z-30 h-full w-64 bg-white border-r border-gray-200 transform transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200">
          <div className="w-10 h-10 bg-primary-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">C</span>
          </div>
          <div>
            <h1 className="text-lg font-bold text-primary-800">ClaimOptiq</h1>
            <p className="text-xs text-gray-500">FCC ERP Suite</p>
          </div>
        </div>

        <nav className="mt-4 px-3 space-y-1">
          {navItems
            .filter((item) => canViewModule(item.module))
            .map((item) => (
              <NavLink key={item.to} to={item.to} className={linkClass} onClick={onClose}>
                <item.icon className="w-5 h-5" />
                {item.label}
              </NavLink>
            ))}
        </nav>
      </aside>
    </>
  );
};

export default Sidebar;
