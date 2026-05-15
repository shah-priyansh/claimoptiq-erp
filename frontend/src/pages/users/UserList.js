import React, { useState, useEffect } from 'react';
import { getUsersAPI, createUserAPI, updateUserAPI, getHospitalsAPI, getRolesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineX } from 'react-icons/hi';
import { isValidEmail, isValidPhone, onPhoneInput, inputCls } from '../../utils/validators';

const emptyForm = { name: '', email: '', password: '', role: '', hospital: '', phone: '' };

const UserList = () => {
  const { can } = useAuth();
  const [users, setUsers] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [roles, setRoles] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [editId, setEditId] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [usersRes, hospitalsRes, rolesRes] = await Promise.all([
        getUsersAPI(),
        getHospitalsAPI({ active: 'true' }),
        getRolesAPI()
      ]);
      setUsers(usersRes.data);
      setHospitals(hospitalsRes.data);
      setRoles(rolesRes.data);
    } catch { toast.error('Failed to fetch data'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(); }, []);

  const selectedRole = roles.find(r => r._id === form.role);
  const isHospitalRole = ['hospital_admin', 'hospital_staff'].includes(selectedRole?.slug);

  const validateUser = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Name is required';
    if (!form.email.trim()) e.email = 'Email is required';
    else if (!isValidEmail(form.email)) e.email = 'Enter a valid email address';
    if (!editId && !form.password) e.password = 'Password is required';
    if (form.password && form.password.length < 6) e.password = 'Password must be at least 6 characters';
    if (!form.role) e.role = 'Role is required';
    if (!form.phone.trim()) e.phone = 'Phone number is required';
    else if (!isValidPhone(form.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number (starts with 6-9)';
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const e_ = validateUser();
    if (Object.keys(e_).length) { setErrors(e_); return; }
    try {
      const submitData = { ...form };
      if (!submitData.hospital) delete submitData.hospital;
      if (editId) {
        if (!submitData.password) delete submitData.password;
        await updateUserAPI(editId, submitData);
        toast.success('User updated');
      } else {
        await createUserAPI(submitData);
        toast.success('User created');
      }
      setShowModal(false);
      setForm(emptyForm);
      setErrors({});
      setEditId(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save user');
    }
  };

  const setField = (field, val) => {
    setForm(f => ({ ...f, [field]: val }));
    setErrors(e => ({ ...e, [field]: '' }));
  };

  const openEdit = (user) => {
    setForm({
      name: user.name,
      email: user.email,
      password: '',
      role: user.role?._id || '',
      hospital: user.hospital?._id || '',
      phone: user.phone || ''
    });
    setEditId(user._id);
    setShowModal(true);
  };

  const toggleActive = async (user) => {
    if (!can('users', 'edit')) return;
    try {
      await updateUserAPI(user._id, { isActive: !user.isActive });
      toast.success(user.isActive ? 'User deactivated' : 'User activated');
      fetchData();
    } catch { toast.error('Failed to update'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Users</h1>
          <p className="text-sm text-gray-500 mt-1">{users.length} users</p>
        </div>
        {can('users', 'create') && (
          <button onClick={() => { setForm(emptyForm); setEditId(null); setShowModal(true); }}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-3 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-5 h-5" /> Add User
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">

        {/* Mobile Cards */}
        <div className="md:hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400">Loading...</div>
          ) : users.length === 0 ? (
            <div className="py-12 text-center text-gray-400">No users found</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {users.map((u) => (
                <div key={u._id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-800">{u.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{u.email}</p>
                      {u.phone && <p className="text-xs text-gray-400">{u.phone}</p>}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleActive(u)}
                        disabled={!can('users', 'edit')}
                        className={`px-2.5 py-1.5 rounded-full text-xs font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </button>
                      {can('users', 'edit') && (
                        <button onClick={() => openEdit(u)}
                          className="p-2.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                      {u.role?.name || '-'}
                    </span>
                    {u.hospital && (
                      <span className="text-xs text-gray-500">{u.hospital.name}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Desktop Table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Role</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hospital</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : users.map((u, idx) => (
                <tr key={u._id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="py-3 px-4 text-sm font-medium text-gray-800">{u.name}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{u.email}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-100 text-primary-700">
                      {u.role?.name || '-'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">{u.hospital?.name || '-'}</td>
                  <td className="py-3 px-4">
                    <button onClick={() => toggleActive(u)}
                      disabled={!can('users', 'edit')}
                      className={`px-2 py-1 rounded-full text-xs font-medium cursor-pointer ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right">
                    {can('users', 'edit') && (
                      <button onClick={() => openEdit(u)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal — bottom sheet on mobile, centered on desktop */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-white rounded-t-2xl sm:rounded-t-2xl border-b border-gray-100 px-6 py-4 flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-800">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setShowModal(false)} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg">
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setField('name', e.target.value)}
                  className={inputCls(!!errors.name)} placeholder="Full name" />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setField('email', e.target.value)}
                  className={inputCls(!!errors.email)} placeholder="name@example.com" />
                {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editId ? '(leave blank to keep)' : '*'}
                </label>
                <input type="password" value={form.password} onChange={(e) => setField('password', e.target.value)}
                  className={inputCls(!!errors.password)} placeholder="Min. 6 characters" />
                {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select value={form.role} onChange={(e) => setField('role', e.target.value)}
                  className={inputCls(!!errors.role)}>
                  <option value="">Select Role</option>
                  {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                </select>
                {errors.role && <p className="text-xs text-red-500 mt-1">{errors.role}</p>}
              </div>
              {isHospitalRole && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
                  <select value={form.hospital} onChange={(e) => setField('hospital', e.target.value)}
                    className={inputCls(!!errors.hospital)}>
                    <option value="">Select Hospital</option>
                    {hospitals.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
                  </select>
                  {errors.hospital && <p className="text-xs text-red-500 mt-1">{errors.hospital}</p>}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone * <span className="text-gray-400 font-normal">(10 digits)</span></label>
                <input
                  value={form.phone}
                  onChange={(e) => setField('phone', onPhoneInput(e.target.value))}
                  inputMode="numeric"
                  maxLength={10}
                  className={inputCls(!!errors.phone)}
                  placeholder="e.g. 9876543210"
                />
                <p className="text-xs text-gray-400 mt-1">{form.phone.length}/10 digits</p>
                {errors.phone && <p className="text-xs text-red-500 mt-0.5">{errors.phone}</p>}
              </div>
              <div className="flex gap-3 pt-2 pb-2">
                <button type="submit"
                  className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-3 rounded-lg text-sm font-medium">
                  {editId ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-3 rounded-lg text-sm font-medium">
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserList;
