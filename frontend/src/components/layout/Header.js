import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { HiOutlineMenu, HiOutlineLogout, HiChevronRight } from 'react-icons/hi';
import NotificationBell from './NotificationBell';
import { useConfirm } from '../../context/ConfirmContext';

// Static map for direct routes; dynamic routes are resolved by pattern below.
const STATIC_TITLES = {
  '/dashboard':              'Dashboard',
  '/claims':                 'Claims',
  '/claims/new':             'New Claim',
  '/hospitals':              'Hospitals',
  '/hospitals/new':          'New Hospital',
  '/insurance':              'Insurance Companies',
  '/tpa':                    'TPA',
  '/references':             'References',
  '/users':                  'Users',
  '/roles':                  'Roles & Permissions',
  '/roles/new':              'New Role',
  '/reports':                'Reports',
  '/reports/claims':         'Claims Report',
  '/reports/sales':          'Sales Report',
  '/reports/expenses':       'Expenses Report',
  '/reports/profit':         'Profit Report',
  '/reports/references':     'References Report',
  '/reports/cash-bank':      'Cash / Bank Report',
  '/claim-statuses':         'Claim Status Master',
  '/claim-document-types':   'Document Types',
  '/billing-service-names':  'Billing Service Names',
  '/tds-rates':              'TDS Rates',
  '/invoices':               'Invoices',
  '/invoices/new':           'New Invoice',
  '/expenses':               'Expenses',
  '/expense-categories':     'Expense Categories',
  '/cash-bank':              'Cash / Bank',
  '/account-entries':        'Account Entries',
  '/documents/upload':       'Upload Document',
  '/documents/inbox':        'Document Inbox',
  '/staff':                  'Staff',
  '/settings':               'Settings',
  '/profile':                'My Profile',
};

const getPageTitle = (pathname) => {
  if (STATIC_TITLES[pathname]) return STATIC_TITLES[pathname];
  if (/^\/claims\/[^/]+\/edit$/.test(pathname))    return 'Edit Claim';
  if (/^\/claims\/[^/]+$/.test(pathname))          return 'Claim Detail';
  if (/^\/hospitals\/[^/]+\/edit$/.test(pathname)) return 'Edit Hospital';
  if (/^\/hospitals\/[^/]+$/.test(pathname))       return 'Hospital Detail';
  if (/^\/roles\/[^/]+\/edit$/.test(pathname))     return 'Edit Role';
  if (/^\/invoices\/[^/]+$/.test(pathname))        return 'Invoice Detail';
  return '';
};

const Header = ({ onMenuClick }) => {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const location = useLocation();
  const navigate = useNavigate();
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';
  const pageTitle = getPageTitle(location.pathname);
  const welcomeText = user?.hospital?.name
    ? `Welcome, ${user.hospital.name}`
    : 'Welcome to FCC Panel';

  const handleLogout = async () => {
    const ok = await confirm('You will be signed out of ClaimOptiq.', {
      title: 'Logout',
      confirmLabel: 'Logout',
      variant: 'danger',
      icon: HiOutlineLogout,
    });
    if (ok) logout();
  };

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 lg:px-6 h-16 flex items-center shadow-sm shadow-gray-100/80">
      <div className="flex items-center justify-between w-full">

        {/* Mobile: hamburger + brand */}
        <div className="flex items-center gap-2 lg:hidden">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors"
          >
            <HiOutlineMenu className="w-5 h-5" />
          </button>
          <span className="font-bold text-primary-700 text-base">ClaimOptiq</span>
        </div>

        {/* Desktop: welcome + page title with accent bar */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="w-1 h-10 bg-primary-600 rounded-full" />
          <div>
            <p className="text-[11px] font-semibold text-primary-700 uppercase tracking-widest leading-none truncate max-w-[400px]">{welcomeText}</p>
            <h1 className="text-lg font-bold text-gray-800 leading-none mt-1">{pageTitle}</h1>
          </div>
        </div>

        {/* Right: notification + divider + user + logout */}
        <div className="flex items-center gap-1">
          <NotificationBell />

          <div className="w-px h-6 bg-gray-200 mx-2 hidden sm:block" />

          <button
            onClick={() => navigate('/profile')}
            title={`${user?.name} — View profile`}
            className="group flex items-center gap-2 px-1.5 py-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <span className="hidden md:block text-xs font-semibold text-gray-700">{user?.name}</span>
            <HiChevronRight className="hidden md:block w-3.5 h-3.5 text-gray-400 group-hover:text-primary-600 group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            onClick={handleLogout}
            className="ml-1 p-2 rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-colors"
            title="Logout"
          >
            <HiOutlineLogout className="w-4.5 h-4.5" />
          </button>
        </div>

      </div>
    </header>
  );
};

export default Header;
