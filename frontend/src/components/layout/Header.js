import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { HiOutlineMenu, HiOutlineLogout } from 'react-icons/hi';
import NotificationBell from './NotificationBell';
import { useConfirm } from '../../context/ConfirmContext';

const Header = ({ onMenuClick }) => {
  const { user, logout } = useAuth();
  const confirm = useConfirm();
  const roleName = user?.role?.name || 'User';
  const initials = user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'U';

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

        {/* Desktop: welcome with accent bar */}
        <div className="hidden lg:flex items-center gap-3">
          <div className="w-1 h-8 bg-primary-600 rounded-full" />
          <div>
            <p className="text-xs text-gray-400 font-medium leading-none mb-1">Welcome back</p>
            <p className="text-sm font-bold text-gray-800 leading-none">{user?.name}</p>
          </div>
        </div>

        {/* Right: notification + divider + user + logout */}
        <div className="flex items-center gap-1">
          <NotificationBell />

          <div className="w-px h-6 bg-gray-200 mx-2 hidden sm:block" />

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-500 to-primary-700 rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
              <span className="text-white text-xs font-bold">{initials}</span>
            </div>
            <span className="hidden md:block text-xs font-semibold text-primary-600">{roleName}</span>
          </div>

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
