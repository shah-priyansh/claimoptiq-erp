import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

import { AuthProvider } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';
import Layout from './components/layout/Layout';
import ProtectedRoute from './components/layout/ProtectedRoute';
import Login from './pages/auth/Login';
import Dashboard from './pages/dashboard/Dashboard';
import HospitalList from './pages/hospitals/HospitalList';
import HospitalForm from './pages/hospitals/HospitalForm';
import InsuranceList from './pages/insurance/InsuranceList';
import TPAList from './pages/tpa/TPAList';
import ReferenceList from './pages/references/ReferenceList';
import InvoiceList from './pages/invoices/InvoiceList';
import InvoiceWizard from './pages/invoices/InvoiceWizard';
import InvoiceDetail from './pages/invoices/InvoiceDetail';
import TdsRateList from './pages/tds/TdsRateList';
import ExpenseList from './pages/expenses/ExpenseList';
import ExpenseCategoryList from './pages/expenses/ExpenseCategoryList';
import CashBankList from './pages/cashbank/CashBankList';
import AccountEntryList from './pages/accountentries/AccountEntryList';
import UserList from './pages/users/UserList';
import ClaimList from './pages/claims/ClaimList';
import ClaimForm from './pages/claims/ClaimForm';
import ClaimDetail from './pages/claims/ClaimDetail';
import Reports from './pages/reports/Reports';
import ReportsHub from './pages/reports/ReportsHub';
import SalesReport from './pages/reports/SalesReport';
import ExpensesReport from './pages/reports/ExpensesReport';
import ProfitReport from './pages/reports/ProfitReport';
import ReferencesReport from './pages/reports/ReferencesReport';
import CashBankReport from './pages/reports/CashBankReport';
import RoleList from './pages/roles/RoleList';
import RoleForm from './pages/roles/RoleForm';
import ClaimStatusMaster from './pages/claimstatus/ClaimStatusMaster';
import ClaimDocumentTypeMaster from './pages/claimdocumenttypes/ClaimDocumentTypeMaster';
import BillingServiceNameList from './pages/billingservicenames/BillingServiceNameList';
import DocumentUpload from './pages/documents/DocumentUpload';
import DocumentInbox from './pages/documents/DocumentInbox';
import StaffModule from './pages/staff/StaffModule';
import SiteSettings from './pages/settings/SiteSettings';
import Profile from './pages/profile/Profile';

const ClaimEditRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/claims/${id}?tab=admission`} replace />;
};

function App() {
  return (
    <AuthProvider>
      <ConfirmProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<ProtectedRoute module="dashboard"><Dashboard /></ProtectedRoute>} />
            <Route path="/hospitals" element={<ProtectedRoute module="hospitals" requireManage><HospitalList /></ProtectedRoute>} />
            <Route path="/hospitals/new" element={<ProtectedRoute module="hospitals" requireManage><HospitalForm /></ProtectedRoute>} />
            <Route path="/hospitals/:id" element={<ProtectedRoute module="hospitals" requireManage><HospitalForm /></ProtectedRoute>} />
            <Route path="/hospitals/:id/edit" element={<ProtectedRoute module="hospitals" requireManage><HospitalForm /></ProtectedRoute>} />
            <Route path="/insurance" element={<ProtectedRoute module="insurance" requireManage><InsuranceList /></ProtectedRoute>} />
            <Route path="/tpa" element={<ProtectedRoute module="tpa" requireManage><TPAList /></ProtectedRoute>} />
            <Route path="/references" element={<ProtectedRoute module="references" requireManage><ReferenceList /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute module="users" requireManage><UserList /></ProtectedRoute>} />
            <Route path="/claims" element={<ProtectedRoute module="claims"><ClaimList /></ProtectedRoute>} />
            <Route path="/claims/new" element={<ProtectedRoute module="claims"><ClaimForm /></ProtectedRoute>} />
            <Route path="/claims/:id/edit" element={<ProtectedRoute module="claims"><ClaimEditRedirect /></ProtectedRoute>} />
            <Route path="/claims/:id" element={<ProtectedRoute module="claims"><ClaimDetail /></ProtectedRoute>} />
            <Route path="/roles" element={<ProtectedRoute module="roles" requireManage><RoleList /></ProtectedRoute>} />
            <Route path="/roles/new" element={<ProtectedRoute module="roles" requireManage><RoleForm /></ProtectedRoute>} />
            <Route path="/roles/:id/edit" element={<ProtectedRoute module="roles" requireManage><RoleForm /></ProtectedRoute>} />
            <Route path="/invoices" element={<ProtectedRoute module="invoices"><InvoiceList /></ProtectedRoute>} />
            <Route path="/invoices/new" element={<ProtectedRoute module="invoices" requireManage><InvoiceWizard /></ProtectedRoute>} />
            <Route path="/invoices/:id" element={<ProtectedRoute module="invoices"><InvoiceDetail /></ProtectedRoute>} />
            <Route path="/tds-rates" element={<ProtectedRoute module="tds_rates" requireManage><TdsRateList /></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute module="expenses"><ExpenseList /></ProtectedRoute>} />
            <Route path="/expense-categories" element={<ProtectedRoute module="expense_categories" requireManage><ExpenseCategoryList /></ProtectedRoute>} />
            <Route path="/cash-bank" element={<ProtectedRoute module="cash_bank"><CashBankList /></ProtectedRoute>} />
            <Route path="/account-entries" element={<ProtectedRoute module="account_entries"><AccountEntryList /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute module="reports"><ReportsHub /></ProtectedRoute>} />
            <Route path="/reports/claims" element={<ProtectedRoute module="reports"><Reports /></ProtectedRoute>} />
            <Route path="/reports/sales" element={<ProtectedRoute module="reports"><SalesReport /></ProtectedRoute>} />
            <Route path="/reports/expenses" element={<ProtectedRoute module="reports"><ExpensesReport /></ProtectedRoute>} />
            <Route path="/reports/profit" element={<ProtectedRoute module="reports"><ProfitReport /></ProtectedRoute>} />
            <Route path="/reports/references" element={<ProtectedRoute module="reports"><ReferencesReport /></ProtectedRoute>} />
            <Route path="/reports/cash-bank" element={<ProtectedRoute module="reports"><CashBankReport /></ProtectedRoute>} />
            <Route path="/claim-statuses" element={<ProtectedRoute module="claim_statuses" requireManage><ClaimStatusMaster /></ProtectedRoute>} />
            <Route path="/claim-document-types" element={<ProtectedRoute module="claim_document_types" requireManage><ClaimDocumentTypeMaster /></ProtectedRoute>} />
            <Route path="/billing-service-names" element={<ProtectedRoute module="billing_service_names" requireManage><BillingServiceNameList /></ProtectedRoute>} />
            <Route path="/documents/upload" element={<ProtectedRoute module="document_submissions" requireHospital><DocumentUpload /></ProtectedRoute>} />
            <Route path="/documents/inbox" element={<ProtectedRoute module="document_submissions"><DocumentInbox /></ProtectedRoute>} />
            <Route path="/staff" element={<ProtectedRoute module="staff"><StaffModule /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute superAdminOnly><SiteSettings /></ProtectedRoute>} />
            <Route path="/profile" element={<Profile />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Router>
      <ToastContainer position="top-right" autoClose={3000} hideProgressBar={false}
        newestOnTop closeOnClick rtl={false} pauseOnFocusLoss={false} draggable pauseOnHover={false}
        theme="light" />
      </ConfirmProvider>
    </AuthProvider>
  );
}

export default App;
