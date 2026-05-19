import React, { useState, useEffect } from 'react';
import { getEmployeesAPI, createEmployeeAPI, updateEmployeeAPI, getUsersAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineX, HiOutlineTrash } from 'react-icons/hi';
import Toggle from '../../components/ui/Toggle';
import { formatCurrency } from '../../utils/format';

const emptyForm = {
  name: '', basicSalary: '', shiftStart: '09:00', shiftEnd: '18:00',
  standardHours: '9', userId: '', allowances: [],
};

const EmployeeForm = ({ emp, users, onSave, onClose }) => {
  const [form, setForm] = useState(
    emp
      ? {
          name: emp.name, basicSalary: emp.basicSalary, shiftStart: emp.shiftStart,
          shiftEnd: emp.shiftEnd, standardHours: emp.standardHours,
          userId: emp.userId || '', allowances: emp.allowances || [],
        }
      : { ...emptyForm }
  );
  const [saving, setSaving] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const addAllowance = () => setForm(f => ({ ...f, allowances: [...f.allowances, { name: '', amount: '' }] }));
  const removeAllowance = (i) => setForm(f => ({ ...f, allowances: f.allowances.filter((_, idx) => idx !== i) }));
  const setAllowance = (i, k, v) => setForm(f => ({
    ...f,
    allowances: f.allowances.map((a, idx) => idx === i ? { ...a, [k]: v } : a),
  }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (emp) {
        await updateEmployeeAPI(emp.id, form);
        toast.success('Employee updated');
      } else {
        await createEmployeeAPI(form);
        toast.success('Employee created');
      }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-lg max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl sm:rounded-t-xl flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">{emp ? 'Edit Employee' : 'Add Employee'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><HiOutlineX className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Full Name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Basic Salary (₹) *</label>
              <input required type="number" min="0" value={form.basicSalary} onChange={e => set('basicSalary', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Standard Hours/Day *</label>
              <input required type="number" min="1" max="24" step="0.5" value={form.standardHours} onChange={e => set('standardHours', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Shift Start *</label>
              <input required type="time" value={form.shiftStart} onChange={e => set('shiftStart', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Shift End *</label>
              <input required type="time" value={form.shiftEnd} onChange={e => set('shiftEnd', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Link to System User (for self-service)</label>
            <select value={form.userId} onChange={e => set('userId', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">— None —</option>
              {users.map(u => <option key={u._id} value={u._id}>{u.name} ({u.email})</option>)}
            </select>
          </div>

          {/* Fixed Allowances */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-gray-600">Fixed Allowances</label>
              <button type="button" onClick={addAllowance}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
            </div>
            {form.allowances.length === 0 && (
              <p className="text-xs text-gray-400 italic">No fixed allowances</p>
            )}
            <div className="space-y-2">
              {form.allowances.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input placeholder="Name (e.g. HRA)" value={a.name} onChange={e => setAllowance(i, 'name', e.target.value)}
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500" />
                  <input placeholder="₹ Amount" type="number" min="0" value={a.amount} onChange={e => setAllowance(i, 'amount', e.target.value)}
                    className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-1 focus:ring-primary-500" />
                  <button type="button" onClick={() => removeAllowance(i)} className="text-red-400 hover:text-red-600">
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : emp ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const EmployeeList = ({ canEdit }) => {
  const confirm = useConfirm();
  const [employees, setEmployees] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editEmp, setEditEmp] = useState(null);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [empRes, usersRes] = await Promise.all([getEmployeesAPI(), getUsersAPI()]);
      setEmployees(empRes.data);
      setUsers(usersRes.data);
    } catch { toast.error('Failed to load employees'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleToggleActive = async (emp) => {
    const ok = await confirm(`${emp.isActive ? 'Deactivate' : 'Activate'} ${emp.name}?`, {
      title: emp.isActive ? 'Deactivate Employee' : 'Activate Employee',
      confirmLabel: emp.isActive ? 'Deactivate' : 'Activate',
      variant: emp.isActive ? 'danger' : 'primary',
    });
    if (!ok) return;
    try {
      await updateEmployeeAPI(emp.id, { isActive: !emp.isActive });
      toast.success(`Employee ${emp.isActive ? 'deactivated' : 'activated'}`);
      load();
    } catch { toast.error('Failed to update'); }
  };

  const filtered = employees.filter(e =>
    e.name.toLowerCase().includes(search.toLowerCase()) ||
    e.empNumber.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or EMP no..."
          className="w-full sm:w-64 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        {canEdit && (
          <button onClick={() => { setEditEmp(null); setShowForm(true); }}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap">
            <HiOutlinePlus className="w-4 h-4" /> Add Employee
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['EMP No', 'Name', 'Basic Salary', 'Shift', 'Std Hours', 'Fixed Allowances', 'User', 'Status', ''].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400 text-sm">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="py-10 text-center text-gray-400 text-sm">No employees found</td></tr>
              ) : filtered.map(emp => (
                <tr key={emp.id} className="hover:bg-gray-50 text-sm">
                  <td className="py-3 px-4 font-semibold text-primary-600">{emp.empNumber}</td>
                  <td className="py-3 px-4 font-medium text-gray-800">{emp.name}</td>
                  <td className="py-3 px-4 text-gray-700">{formatCurrency(emp.basicSalary)}</td>
                  <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{emp.shiftStart} – {emp.shiftEnd}</td>
                  <td className="py-3 px-4 text-gray-500">{emp.standardHours} hrs</td>
                  <td className="py-3 px-4 text-gray-500">
                    {emp.allowances?.length > 0
                      ? emp.allowances.map(a => `${a.name}: ${formatCurrency(a.amount)}`).join(', ')
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-4 text-gray-500">
                    {emp.user?.name || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    {canEdit ? (
                      <Toggle checked={emp.isActive} onChange={() => handleToggleActive(emp)} />
                    ) : (
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${emp.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {emp.isActive ? 'Active' : 'Inactive'}
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {canEdit && (
                      <button onClick={() => { setEditEmp(emp); setShowForm(true); }}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
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

      {showForm && (
        <EmployeeForm
          emp={editEmp}
          users={users}
          onSave={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}
    </div>
  );
};

export default EmployeeList;
