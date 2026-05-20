import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const ProtectedRoute = ({ module, requireHospital = false, children }) => {
  const { canViewModule, user } = useAuth();

  if (!canViewModule(module)) return <Navigate to="/dashboard" replace />;
  if (requireHospital && !user?.hospital) return <Navigate to="/dashboard" replace />;

  return children;
};

export default ProtectedRoute;
