import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { HiOutlineMenu, HiOutlineLogout, HiOutlineUser } from 'react-icons/hi';
import NotificationBell from './NotificationBell';

const Header = ({ onMenuClick }) => {
  const { user, logout } = useAuth();

  const roleName = user?.role?.name || 'User';

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 lg:px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 lg:hidden">
          <button
            onClick={onMenuClick}
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100"
          >
            <HiOutlineMenu className="w-6 h-6" />
          </button>
          <span className="font-bold text-primary-700 text-lg">ClaimOptiq</span>
        </div>

        <div className="hidden lg:block">
          <h2 className="text-sm text-gray-500">Welcome back,</h2>
          <p className="text-base font-semibold text-gray-800">{user?.name}</p>
        </div>

        <div className="flex items-center gap-4">
          <NotificationBell />
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-primary-100 rounded-full flex items-center justify-center">
              <HiOutlineUser className="w-5 h-5 text-primary-600" />
            </div>
            <div className="hidden md:block">
              <p className="text-sm font-medium text-gray-700">{user?.name}</p>
              <p className="text-xs text-primary-600 font-medium">
                {roleName}
              </p>
            </div>
          </div>

          <button
            onClick={logout}
            className="p-2 rounded-lg text-gray-500 hover:bg-red-50 hover:text-red-600 transition-colors"
            title="Logout"
          >
            <HiOutlineLogout className="w-5 h-5" />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Header;
