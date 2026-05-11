import React, { useState, useEffect } from 'react';
import { getUsersAPI, createUserAPI, updateUserAPI, getHospitalsAPI, getRolesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineX } from 'react-icons/hi';

const emptyForm = { name: '', email: '', password: '', role: '', hospital: '', phone: '' };

const UserList = () => {
  const { can } = useAuth();
  const [users, setUsers] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [roles, setRoles] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(emptyForm);
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

  // Check if selected role is a hospital-type role
  const selectedRole = roles.find(r => r._id === form.role);
  const isHospitalRole = selectedRole?.slug === 'hospital';

  const handleSubmit = async (e) => {
    e.preventDefault();
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
      setEditId(null);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save user');
    }
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
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-5 h-5" /> Add User
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
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

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">{editId ? 'Edit User' : 'Add User'}</h2>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Password {editId ? '(leave blank to keep)' : '*'}
                </label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={!editId} minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                  <option value="">Select Role</option>
                  {roles.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
                </select>
              </div>
              {isHospitalRole && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
                  <select value={form.hospital} onChange={(e) => setForm({ ...form, hospital: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                    <option value="">Select Hospital</option>
                    {hospitals.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit"
                  className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2.5 rounded-lg text-sm font-medium">
                  {editId ? 'Update' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowModal(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 py-2.5 rounded-lg text-sm font-medium">
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
