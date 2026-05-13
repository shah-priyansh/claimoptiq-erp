import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AuthProvider } from './context/AuthContext';
import Layout from './components/layout/Layout';
import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import HospitalList from './pages/hospitals/HospitalList';
import HospitalForm from './pages/hospitals/HospitalForm';
import InsuranceList from './pages/insurance/InsuranceList';
import TPAList from './pages/tpa/TPAList';
import UserList from './pages/users/UserList';
import ClaimList from './pages/claims/ClaimList';
import ClaimForm from './pages/claims/ClaimForm';
import ClaimDetail from './pages/claims/ClaimDetail';
import Reports from './pages/reports/Reports';
import RoleList from './pages/roles/RoleList';
import RoleForm from './pages/roles/RoleForm';
import ClaimStatusMaster from './pages/claimstatus/ClaimStatusMaster';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/hospitals" element={<HospitalList />} />
            <Route path="/hospitals/new" element={<HospitalForm />} />
            <Route path="/hospitals/:id" element={<HospitalForm />} />
            <Route path="/hospitals/:id/edit" element={<HospitalForm />} />
            <Route path="/insurance" element={<InsuranceList />} />
            <Route path="/tpa" element={<TPAList />} />
            <Route path="/users" element={<UserList />} />
            <Route path="/claims" element={<ClaimList />} />
            <Route path="/claims/new" element={<ClaimForm />} />
            <Route path="/claims/:id" element={<ClaimDetail />} />
            <Route path="/roles" element={<RoleList />} />
            <Route path="/roles/new" element={<RoleForm />} />
            <Route path="/roles/:id/edit" element={<RoleForm />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/claim-statuses" element={<ClaimStatusMaster />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false}
        newestOnTop closeOnClick rtl={false} pauseOnFocusLoss={false} draggable pauseOnHover={false}
        theme="light" />
    </AuthProvider>
  );
}

export default App;
