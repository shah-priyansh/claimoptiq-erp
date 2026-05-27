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

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth
export const loginAPI = (data) => API.post('/auth/login', data);
export const getMeAPI = () => API.get('/auth/me');
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
export const deleteHospitalAPI = (id) => API.delete(`/hospitals/${id}`);

// Insurance
export const getInsuranceAPI = () => API.get('/insurance');
export const createInsuranceAPI = (data) => API.post('/insurance', data);
export const updateInsuranceAPI = (id, data) => API.put(`/insurance/${id}`, data);
export const deleteInsuranceAPI = (id) => API.delete(`/insurance/${id}`);

// TPA
export const getTPAAPI = () => API.get('/tpa');
export const createTPAAPI = (data) => API.post('/tpa', data);
export const updateTPAAPI = (id, data) => API.put(`/tpa/${id}`, data);
export const deleteTPAAPI = (id) => API.delete(`/tpa/${id}`);

// Billing Service Names
export const getBillingServiceNamesAPI = () => API.get('/billing-service-names');
export const createBillingServiceNameAPI = (data) => API.post('/billing-service-names', data);
export const updateBillingServiceNameAPI = (id, data) => API.put(`/billing-service-names/${id}`, data);
export const deleteBillingServiceNameAPI = (id) => API.delete(`/billing-service-names/${id}`);

// Claims
export const getClaimsAPI = (params) => API.get('/claims', { params });
export const exportClaimsAPI = (params) => API.get('/claims/export', { params });
export const getClaimAPI = (id) => API.get(`/claims/${id}`);
export const createClaimAPI = (data) => API.post('/claims', data);
export const updateClaimAPI = (id, data) => API.put(`/claims/${id}`, data);
export const bulkUpdateStatusAPI = (ids, status) => API.put('/claims/bulk-status', { ids, status });
export const bulkBillAPI = (ids) => API.put('/claims/bulk-bill', { ids });
export const uploadDocumentsAPI = (id, formData) => API.post(`/claims/${id}/documents`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const deleteDocumentAPI = (claimId, docId) => API.delete(`/claims/${claimId}/documents/${docId}`);

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
