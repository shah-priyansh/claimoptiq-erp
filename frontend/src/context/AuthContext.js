import React, { createContext, useContext, useState, useEffect } from 'react';
import { getMeAPI } from '../services/api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      getMeAPI()
        .then((res) => setUser(res.data))
        .catch(() => {
          localStorage.removeItem('token');
          localStorage.removeItem('user');
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = (token, userData) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  // Dynamic permission check: can('claims', 'create')
  const can = (moduleName, action = 'view') => {
    if (!user?.role) return false;

    // Super admin always has access
    if (user.role.slug === 'super_admin') return true;

    const mod = user.role.modulePermissions?.find(m => m.module === moduleName);
    if (!mod) return false;
    return mod.permissions?.[action] === true;
  };

  // Check if user can view a module (for sidebar)
  const canViewModule = (moduleName) => can(moduleName, 'view');

  // Get role slug for backward compat
  const roleSlug = user?.role?.slug || '';

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, can, canViewModule, roleSlug }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
