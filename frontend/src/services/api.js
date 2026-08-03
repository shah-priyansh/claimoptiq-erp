import axios from 'axios';

const API = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:5001/api',
});

API.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Endpoints where a 401/403 is an expected part of the flow (bad login, expired
// reset link) and must NOT trigger the "session expired -> redirect" behavior —
// otherwise the page reloads and wipes the inline error before the user sees it.
const AUTH_PUBLIC_PATHS = ['/auth/login', '/auth/forgot-password', '/auth/reset-password'];

API.interceptors.response.use(
  (response) => response,
  (error) => {
    const url = error.config?.url || '';
    const isAuthPublic = AUTH_PUBLIC_PATHS.some((p) => url.includes(p));
    if (error.response?.status === 401 && !isAuthPublic) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Build an authenticated URL for streaming a claim document (works in <img>/<a>
// since the JWT rides as a query param; the file may be local or offloaded).
export const getClaimDocFileURL = (claimId, docId, download = false) => {
  const base = process.env.REACT_APP_API_URL || 'http://localhost:5001/api';
  const token = localStorage.getItem('token') || '';
  return `${base}/claims/${claimId}/documents/${docId}/file?download=${download ? 1 : 0}&token=${encodeURIComponent(token)}`;
};

// Auth
export const loginAPI = (data) => API.post('/auth/login', data);
export const forgotPasswordAPI = (data) => API.post('/auth/forgot-password', data);
export const resetPasswordAPI = (data) => API.post('/auth/reset-password', data);
export const getMeAPI = () => API.get('/auth/me');
export const updateMeAPI = (data) => API.put('/auth/me', data);
export const changePasswordAPI = (data) => API.put('/auth/me/password', data);
export const getPublicStatsAPI = () => API.get('/settings');
export const updateSiteSettingsAPI = (data) => API.put('/settings', data);

export const getUsersAPI = () => API.get('/auth/users');
export const createUserAPI = (data) => API.post('/auth/users', data);
export const updateUserAPI = (id, data) => API.put(`/auth/users/${id}`, data);

// Hospitals
export const getHospitalsAPI = (params) => API.get('/hospitals', { params });
export const getHospitalAPI = (id) => API.get(`/hospitals/${id}`);
export const createHospitalAPI = (data) => API.post('/hospitals', data);
export const updateHospitalAPI = (id, data) => API.put(`/hospitals/${id}`, data);
export const setHospitalStatusAPI = (id, isActive) => API.patch(`/hospitals/${id}/status`, { isActive });
export const deleteHospitalAPI = (id) => API.delete(`/hospitals/${id}`);
export const deleteAllHospitalsAPI = () => API.delete('/hospitals', { data: { confirm: 'DELETE_ALL' } });
export const importHospitalsAPI = (rows, mode = 'skip') => API.post('/hospitals/import', { rows, mode });
export const addHospitalDoctorAPI = (hospitalId, data) => API.post(`/hospitals/${hospitalId}/doctors`, data);

// Insurance
export const getInsuranceAPI = (params) => API.get('/insurance', { params });
export const createInsuranceAPI = (data) => API.post('/insurance', data);
export const updateInsuranceAPI = (id, data) => API.put(`/insurance/${id}`, data);
export const deleteInsuranceAPI = (id) => API.delete(`/insurance/${id}`);
export const importInsuranceAPI = (rows, mode = 'skip') => API.post('/insurance/import', { rows, mode });
export const bulkInsuranceStatusAutomationAPI = (ids, statusAutomation) => API.put('/insurance/bulk-status-automation', { ids, statusAutomation });

// TPA
export const getTPAAPI = (params) => API.get('/tpa', { params });
export const createTPAAPI = (data) => API.post('/tpa', data);
export const updateTPAAPI = (id, data) => API.put(`/tpa/${id}`, data);
export const deleteTPAAPI = (id) => API.delete(`/tpa/${id}`);
export const importTPAAPI = (rows, mode = 'skip') => API.post('/tpa/import', { rows, mode });
export const bulkTPAStatusAutomationAPI = (ids, statusAutomation) => API.put('/tpa/bulk-status-automation', { ids, statusAutomation });

// References (Commission Master)
export const getReferencesAPI = (params) => API.get('/references', { params });
export const getReferenceAPI = (id) => API.get(`/references/${id}`);
export const createReferenceAPI = (data) => API.post('/references', data);
export const updateReferenceAPI = (id, data) => API.put(`/references/${id}`, data);
export const deleteReferenceAPI = (id) => API.delete(`/references/${id}`);

// Invoices
export const previewInvoiceAPI = (data) => API.post('/invoices/preview', data);
export const previewBulkInvoiceAPI = (data) => API.post('/invoices/preview-bulk', data);
// Direct-patient claims don't carry a hospital relation. The drawer collects a
// target hospital from the operator and posts here to compute the preview as
// if those claims were billed against the chosen hospital.
export const previewDirectPatientInvoiceAPI = (data) => API.post('/invoices/preview-direct-patient', data);
// Renders the same PDF as a saved invoice but for an unsaved draft from the
// bulk wizard. Returns a Blob so callers can drop it into an <iframe> for
// preview + print, and re-save it for download.
export const previewInvoicePdfAPI = (data) => API.post('/invoices/preview-pdf', data, { responseType: 'blob' });
export const createInvoiceAPI  = (data) => API.post('/invoices', data);
export const getInvoicesAPI    = (params) => API.get('/invoices', { params });
export const getOpenInvoiceHospitalsAPI = () => API.get('/invoices/open-hospitals');
export const getInvoiceAPI     = (id) => API.get(`/invoices/${id}`);
export const updateInvoiceAPI  = (id, data) => API.patch(`/invoices/${id}`, data);
export const editInvoiceLinesAPI = (id, payload) => API.patch(`/invoices/${id}`, payload);
export const issueInvoiceAPI   = (id) => API.post(`/invoices/${id}/issue`);
export const voidInvoiceAPI    = (id, data) => API.post(`/invoices/${id}/void`, data);
export const deleteInvoiceAPI  = (id) => API.delete(`/invoices/${id}`);
export const deleteAllInvoicesAPI = () => API.delete('/invoices', { data: { confirm: 'DELETE_ALL' } });
export const invoicePdfUrl     = (id) => `${API.defaults.baseURL}/invoices/${id}/pdf`;
export const bulkInvoicePdfAPI = (invoiceIds) => API.post('/invoices/bulk-pdf', { invoiceIds }, { responseType: 'blob' });
export const getInvoicePdfBlobAPI = (id) => API.get(`/invoices/${id}/pdf`, { responseType: 'blob' });

// Fetches the invoice PDF *with the JWT* (the protected endpoint rejects a
// plain <a target="_blank"> because the new tab doesn't send the
// Authorization header) and triggers a download with the caller-supplied
// filename. Using `<a download>` is what makes the browser's Save-As dialog
// show the nice hospital-name filename; a `window.open(blobUrl)` approach
// causes browsers to fall back to the blob URL's UUID instead. Caller
// surfaces any toast/error itself.
export const openInvoicePdf = async (id, filename) => {
  const { data } = await API.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `invoice-${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a moment to consume the blob before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

// Opens the invoice PDF inline in a NEW TAB for on-screen preview. The tab is
// opened synchronously (inside the click gesture) so popup blockers don't kill
// it, then pointed at a blob URL once the authenticated fetch resolves — the
// endpoint needs the JWT, so a direct <a target="_blank"> would 401.
export const previewInvoicePdf = async (id) => {
  const win = window.open('', '_blank');
  try {
    const { data } = await API.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
    const url = URL.createObjectURL(data);
    if (win) win.location = url;
    else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    if (win) win.close();
    throw err;
  }
};

// Fetches the invoice PDF (with the JWT) and opens the browser's print dialog
// via a hidden iframe — no download, no visible tab. Blob URLs are same-origin
// so contentWindow access is allowed.
export const printInvoicePdf = async (id) => {
  const { data } = await API.get(`/invoices/${id}/pdf`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  iframe.onload = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch {
      // Fallback: open in a tab so the user can print (Ctrl/Cmd+P) manually.
      window.open(url, '_blank');
    }
  };
  iframe.src = url;
  document.body.appendChild(iframe);
  // Keep the iframe/blob alive long enough for the print dialog, then clean up.
  setTimeout(() => { iframe.remove(); URL.revokeObjectURL(url); }, 60_000);
};

// Expenses
export const getExpenseCategoriesAPI  = (params) => API.get('/expense-categories', { params });
export const createExpenseCategoryAPI = (data) => API.post('/expense-categories', data);
export const updateExpenseCategoryAPI = (id, data) => API.patch(`/expense-categories/${id}`, data);
export const deleteExpenseCategoryAPI = (id) => API.delete(`/expense-categories/${id}`);

export const getExpensesAPI       = (params) => API.get('/expenses', { params });
export const getExpenseSummaryAPI = (params) => API.get('/expenses/summary', { params });
export const getExpenseAPI        = (id) => API.get(`/expenses/${id}`);
export const createExpenseAPI     = (data) => API.post('/expenses', data);
export const updateExpenseAPI     = (id, data) => API.patch(`/expenses/${id}`, data);
export const deleteExpenseAPI     = (id) => API.delete(`/expenses/${id}`);

// Cash / Bank
export const getCashBankAPI         = (params) => API.get('/cash-bank', { params });
export const getCashBankBalancesAPI = () => API.get('/cash-bank/balances');
export const getCashBankSummaryAPI  = (params) => API.get('/cash-bank/summary', { params });
export const getCashBankEntryAPI    = (id) => API.get(`/cash-bank/${id}`);
export const createCashBankAPI      = (data) => API.post('/cash-bank', data);
export const updateCashBankAPI      = (id, data) => API.patch(`/cash-bank/${id}`, data);
export const deleteCashBankAPI      = (id) => API.delete(`/cash-bank/${id}`);
export const recordInvoicePaymentAPI = (invoiceId, data) => API.post(`/invoices/${invoiceId}/payments`, data);
export const bulkReceivePaymentAPI = (data) => API.post('/cash-bank/bulk-receipt', data);

// Bank accounts — operator-managed list, one flagged default for invoice PDF.
export const getBankAccountsAPI    = (params) => API.get('/bank-accounts', { params });
export const createBankAccountAPI  = (data) => API.post('/bank-accounts', data);
export const updateBankAccountAPI  = (id, data) => API.patch(`/bank-accounts/${id}`, data);
export const deleteBankAccountAPI  = (id) => API.delete(`/bank-accounts/${id}`);
export const setDefaultBankAccountAPI = (id) => API.post(`/bank-accounts/${id}/set-default`);

// Backup & storage
export const getBackupConfigAPI       = () => API.get('/backup/config');
export const updateBackupConfigAPI    = (data) => API.put('/backup/config', data);
export const runBackupAPI             = (params) => API.post('/backup/run', {}, { params });
export const getBackupRunsAPI         = (params) => API.get('/backup/runs', { params });
export const getBackupServersAPI      = () => API.get('/backup/servers');
export const createBackupServerAPI    = (data) => API.post('/backup/servers', data);
export const updateBackupServerAPI    = (id, data) => API.patch(`/backup/servers/${id}`, data);
export const deleteBackupServerAPI    = (id) => API.delete(`/backup/servers/${id}`);
export const testBackupServerAPI      = (id) => API.post(`/backup/servers/${id}/test`);
export const setPrimaryBackupServerAPI = (id) => API.post(`/backup/servers/${id}/set-primary`);
export const replicateBackupServerAPI = (id) => API.post(`/backup/servers/${id}/replicate`);

// Site settings — invoice logo upload (multipart/form-data)
export const uploadInvoiceLogoAPI = (file) => {
  const fd = new FormData();
  fd.append('logo', file);
  return API.post('/settings/invoice-logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
};

// Reports (Phase 2.6)
export const getReportDashboardAPI   = () => API.get('/reports/dashboard');
export const getReportSalesAPI       = (params) => API.get('/reports/sales', { params });
export const getReportExpensesAPI    = (params) => API.get('/reports/expenses', { params });
export const getReportProfitAPI      = (params) => API.get('/reports/profit', { params });
export const getReportReferencesAPI  = (params) => API.get('/reports/references', { params });
export const getReportCashBankAPI    = (params) => API.get('/reports/cash-bank', { params });
export const getReportBalanceSheetAPI = (params) => API.get('/reports/balance-sheet', { params });
export const getReportTaxesAPI       = (params) => API.get('/reports/taxes', { params });

// Account entries (General + Contra)
export const getAccountEntriesAPI       = (params) => API.get('/account-entries', { params });
export const getAccountEntrySummaryAPI  = (params) => API.get('/account-entries/summary', { params });
export const getAccountEntryAPI         = (id) => API.get(`/account-entries/${id}`);
export const createAccountEntryAPI      = (data) => API.post('/account-entries', data);
export const updateAccountEntryAPI      = (id, data) => API.patch(`/account-entries/${id}`, data);
export const deleteAccountEntryAPI      = (id) => API.delete(`/account-entries/${id}`);

// TDS Rates master
export const getTdsRatesAPI    = (params) => API.get('/tds-rates', { params });
export const createTdsRateAPI  = (data) => API.post('/tds-rates', data);
export const updateTdsRateAPI  = (id, data) => API.put(`/tds-rates/${id}`, data);
export const deleteTdsRateAPI  = (id) => API.delete(`/tds-rates/${id}`);

// Billing Service Names
export const getBillingServiceNamesAPI = () => API.get('/billing-service-names');
export const createBillingServiceNameAPI = (data) => API.post('/billing-service-names', data);
export const updateBillingServiceNameAPI = (id, data) => API.put(`/billing-service-names/${id}`, data);
export const deleteBillingServiceNameAPI = (id) => API.delete(`/billing-service-names/${id}`);

// Direct-patient billing services — one global list drives every
// direct-patient invoice. The PUT replaces the entire list in one shot,
// mirroring the hospital-form replace-all persistence.
export const getDirectPatientBillingServicesAPI = () => API.get('/direct-patient-billing-services');
export const saveDirectPatientBillingServicesAPI = (services) =>
  API.put('/direct-patient-billing-services', { services });

// Claims
export const getClaimsAPI = (params) => API.get('/claims', { params });
export const exportClaimsAPI = (params) => API.get('/claims/export', { params });
export const importClaimsAPI = (rows, opts = {}, config = {}) => API.post('/claims/import', { rows, ...opts }, config);
export const getClaimAPI = (id) => API.get(`/claims/${id}`);
export const createClaimAPI = (data) => API.post('/claims', data);
export const updateClaimAPI = (id, data) => API.put(`/claims/${id}`, data);
export const updateClaimStatusHistoryAPI = (claimId, historyId, data) => API.put(`/claims/${claimId}/status-history/${historyId}`, data);
export const deleteClaimStatusHistoryAPI = (claimId, historyId) => API.delete(`/claims/${claimId}/status-history/${historyId}`);
export const bulkUpdateStatusAPI = (ids, status) => API.put('/claims/bulk-status', { ids, status });
export const bulkBillAPI = (ids, isBilled = true) => API.put('/claims/bulk-bill', { ids, isBilled });
export const uploadDocumentsAPI = (id, formData) => API.post(`/claims/${id}/documents`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const deleteDocumentAPI = (claimId, docId) => API.delete(`/claims/${claimId}/documents/${docId}`);
export const deleteClaimAPI = (id) => API.delete(`/claims/${id}`);
export const deleteAllClaimsAPI = () => API.delete('/claims', { data: { confirm: 'DELETE_ALL' } });

// Dashboard
export const getDashboardAPI = () => API.get('/claims/dashboard');

// Claim Status Master
export const getClaimStatusesAPI = () => API.get('/claim-statuses');
export const createClaimStatusAPI = (data) => API.post('/claim-statuses', data);
export const updateClaimStatusAPI = (id, data) => API.put(`/claim-statuses/${id}`, data);
export const deleteClaimStatusAPI = (id) => API.delete(`/claim-statuses/${id}`);

// Document Submissions
export const uploadSubmissionAPI = (formData) => API.post('/document-submissions', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
export const getSubmissionsAPI = (params) => API.get('/document-submissions', { params });
export const updateSubmissionAPI = (id, data) => API.put(`/document-submissions/${id}`, data);
export const deleteSubmissionAPI = (id) => API.delete(`/document-submissions/${id}`);
export const downloadSubmissionAPI = (id) => API.get(`/document-submissions/${id}/download`, { responseType: 'blob' });

// Claim Document Type Master
export const getClaimDocumentTypesAPI = () => API.get('/claim-document-types');
export const createClaimDocumentTypeAPI = (data) => API.post('/claim-document-types', data);
export const updateClaimDocumentTypeAPI = (id, data) => API.put(`/claim-document-types/${id}`, data);
export const deleteClaimDocumentTypeAPI = (id) => API.delete(`/claim-document-types/${id}`);

// Roles
export const getRolesAPI = () => API.get('/roles');
export const getRoleAPI = (id) => API.get(`/roles/${id}`);
export const createRoleAPI = (data) => API.post('/roles', data);
export const updateRoleAPI = (id, data) => API.put(`/roles/${id}`, data);
export const deleteRoleAPI = (id) => API.delete(`/roles/${id}`);
export const getModulesAPI = () => API.get('/roles/modules');

// Staff — Employees
export const getEmployeesAPI = (params) => API.get('/staff/employees', { params });
export const getEmployeeAPI = (id) => API.get(`/staff/employees/${id}`);
export const getMyEmployeeAPI = () => API.get('/staff/employees/me');
export const createEmployeeAPI = (data) => API.post('/staff/employees', data);
export const updateEmployeeAPI = (id, data) => API.put(`/staff/employees/${id}`, data);

// Staff — Attendance
export const clockInAPI = () => API.post('/staff/attendance/clock-in');
export const clockOutAPI = () => API.post('/staff/attendance/clock-out');
export const getTodayAttendanceAPI = () => API.get('/staff/attendance/today');
export const getMyAttendanceAPI = (params) => API.get('/staff/attendance/my', { params });
export const getAllAttendanceAPI = (params) => API.get('/staff/attendance', { params });
export const addAttendanceAPI = (data) => API.post('/staff/attendance', data);
export const addMyAttendanceAPI = (data) => API.post('/staff/attendance/my', data);
export const deleteAttendanceRecordAPI = (id) => API.delete(`/staff/attendance/${id}`);
export const getPendingAttendanceAPI = () => API.get('/staff/attendance/pending');
export const approveAttendanceAPI = (id) => API.patch(`/staff/attendance/${id}/approve`);
export const rejectAttendanceAPI = (id) => API.patch(`/staff/attendance/${id}/reject`);

// Staff — Salary
export const computeSalaryAPI = (data) => API.post('/staff/salary/compute', data);
export const getSalaryRecordsAPI = (params) => API.get('/staff/salary', { params });
export const getMySalaryAPI = () => API.get('/staff/salary/my');
export const updateSalaryRecordAPI = (id, data) => API.put(`/staff/salary/${id}`, data);

// Staff — Holidays
export const getHolidaysAPI = (params) => API.get('/staff/holidays', { params });
export const createHolidayAPI = (data) => API.post('/staff/holidays', data);
export const updateHolidayAPI = (id, data) => API.put(`/staff/holidays/${id}`, data);
export const deleteHolidayAPI = (id) => API.delete(`/staff/holidays/${id}`);

// Staff — OT Settings
export const getOtSettingsAPI = () => API.get('/staff/ot-settings');
export const updateOtSettingsAPI = (data) => API.put('/staff/ot-settings', data);

export const getNotificationsAPI = () => API.get('/notifications');
export const markNotificationReadAPI = (id) => API.patch(`/notifications/${id}/read`);
export const markAllNotificationsReadAPI = () => API.patch('/notifications/read-all');

export default API;
