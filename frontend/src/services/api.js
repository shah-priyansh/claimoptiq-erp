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

// Claims
export const getClaimsAPI = (params) => API.get('/claims', { params });
export const getClaimAPI = (id) => API.get(`/claims/${id}`);
export const createClaimAPI = (data) => API.post('/claims', data);
export const updateClaimAPI = (id, data) => API.put(`/claims/${id}`, data);
export const uploadDocumentsAPI = (id, formData) => API.post(`/claims/${id}/documents`, formData, {
  headers: { 'Content-Type': 'multipart/form-data' }
});
export const deleteDocumentAPI = (claimId, docId) => API.delete(`/claims/${claimId}/documents/${docId}`);

// Dashboard
export const getDashboardAPI = () => API.get('/claims/dashboard');

// Roles
export const getRolesAPI = () => API.get('/roles');
export const getRoleAPI = (id) => API.get(`/roles/${id}`);
export const createRoleAPI = (data) => API.post('/roles', data);
export const updateRoleAPI = (id, data) => API.put(`/roles/${id}`, data);
export const deleteRoleAPI = (id) => API.delete(`/roles/${id}`);
export const getModulesAPI = () => API.get('/roles/modules');

export default API;
