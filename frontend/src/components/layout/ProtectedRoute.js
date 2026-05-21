import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ProtectedRoute = ({ module, requireHospital = false, superAdminOnly = false, requireManage = false, children }) => {
  const { canViewModule, canManageModule, user, roleSlug } = useAuth();

  if (superAdminOnly) {
    if (!user) return <Navigate to="/login" replace />;
    if (roleSlug !== 'super_admin') return <Navigate to="/dashboard" replace />;
    return children;
  }

  const allowed = requireManage ? canManageModule(module) : canViewModule(module);
  if (!allowed) return <Navigate to="/dashboard" replace />;
  if (requireHospital && !user?.hospital) return <Navigate to="/dashboard" replace />;

  return children;
};

export default ProtectedRoute;
