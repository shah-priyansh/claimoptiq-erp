import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createRoleAPI, updateRoleAPI, getRoleAPI, getModulesAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { HiOutlineCog } from 'react-icons/hi';

const MODULE_GROUPS = [
  { label: null,             keys: ['dashboard', 'claims'] },
  { label: 'Administration', keys: ['hospitals', 'insurance', 'tpa', 'users', 'roles', 'claim_statuses', 'claim_document_types'] },
  { label: 'Documents',      keys: ['document_submissions'] },
  { label: null,             keys: ['reports'] },
];

const RoleForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [modules, setModules] = useState([]);
  const [form, setForm] = useState({
    name: '',
    description: '',
    modulePermissions: [],
  });
  const [isSystem, setIsSystem] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(true);

  // Load modules + role data together so we can merge missing modules
  useEffect(() => {
    if (isEdit) {
      Promise.all([getRoleAPI(id), getModulesAPI()])
        .then(([{ data: role }, { data: allModules }]) => {
          setModules(allModules);
          const existingMap = Object.fromEntries(
            (role.modulePermissions || []).map(m => [m.module, m])
          );
          // Ensure every known module has an entry (fills in newly added modules)
          const merged = allModules.map(m =>
            existingMap[m.key] || {
              module: m.key,
              permissions: { view: false, create: false, edit: false, delete: false, export: false },
            }
          );
          setForm({ name: role.name, description: role.description || '', modulePermissions: merged });
          setIsSystem(role.isSystem);
        })
        .catch(() => { toast.error('Role not found'); navigate('/roles'); })
        .finally(() => setFetchLoading(false));
    } else {
      getModulesAPI().then(({ data }) => {
        setModules(data);
        setForm(prev => ({
          ...prev,
          modulePermissions: data.map(m => ({
            module: m.key,
            permissions: { view: false, create: false, edit: false, delete: false, export: false },
          })),
        }));
      }).finally(() => setFetchLoading(false));
    }
  }, [id, isEdit, navigate]);

  const getPermission = (moduleKey, action) => {
    const mod = form.modulePermissions.find(m => m.module === moduleKey);
    return mod?.permissions?.[action] || false;
  };

  const togglePermission = (moduleKey, action) => {
    setForm(prev => ({
      ...prev,
      modulePermissions: prev.modulePermissions.map(m => {
        if (m.module !== moduleKey) return m;
        const newPerms = { ...m.permissions, [action]: !m.permissions[action] };
        // If unchecking 'view', uncheck everything for that module
        if (action === 'view' && m.permissions.view) {
          return { ...m, permissions: { view: false, create: false, edit: false, delete: false, export: false } };
        }
        // If checking any other action, auto-enable 'view'
        if (action !== 'view' && !m.permissions.view) {
          newPerms.view = true;
        }
        return { ...m, permissions: newPerms };
      })
    }));
  };

  const toggleAllForModule = (moduleKey) => {
    const mod = form.modulePermissions.find(m => m.module === moduleKey);
    const moduleConfig = modules.find(m => m.key === moduleKey);
    if (!mod || !moduleConfig) return;

    const allChecked = moduleConfig.actions.every(a => mod.permissions[a]);
    setForm(prev => ({
      ...prev,
      modulePermissions: prev.modulePermissions.map(m => {
        if (m.module !== moduleKey) return m;
        const newPerms = { ...m.permissions };
        moduleConfig.actions.forEach(a => { newPerms[a] = !allChecked; });
        return { ...m, permissions: newPerms };
      })
    }));
  };

  const selectAll = () => {
    setForm(prev => ({
      ...prev,
      modulePermissions: prev.modulePermissions.map(m => {
        const moduleConfig = modules.find(mc => mc.key === m.module);
        const newPerms = { view: false, create: false, edit: false, delete: false, export: false };
        moduleConfig?.actions.forEach(a => { newPerms[a] = true; });
        return { ...m, permissions: newPerms };
      })
    }));
  };

  const clearAll = () => {
    setForm(prev => ({
      ...prev,
      modulePermissions: prev.modulePermissions.map(m => ({
        ...m,
        permissions: { view: false, create: false, edit: false, delete: false, export: false }
      }))
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Role name is required');
    setLoading(true);
    try {
      if (isEdit) {
        await updateRoleAPI(id, form);
        toast.success('Role updated');
      } else {
        await createRoleAPI(form);
        toast.success('Role created');
      }
      navigate('/roles');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save role');
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {isEdit ? 'Edit Role' : 'Create New Role'}
      </h1>
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {isEdit ? 'Edit Role' : 'Create New Role'}
      </h1>

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Role Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role Name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                required disabled={isSystem}
                placeholder="e.g. Billing Manager"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 disabled:bg-gray-50" />
              {isSystem && <p className="text-xs text-amber-600 mt-1">System role name cannot be changed</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Brief description of this role"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        {/* Permissions Matrix */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Module Permissions</h2>
            <div className="flex gap-2">
              <button type="button" onClick={selectAll}
                className="text-xs text-primary-600 hover:text-primary-700 font-medium px-3 py-1 rounded-lg border border-primary-200 hover:bg-primary-50">
                Select All
              </button>
              <button type="button" onClick={clearAll}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium px-3 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">
                Clear All
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-48">Module</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">View</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Create</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Edit</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Delete</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Export</th>
                  <th className="text-center py-3 px-3 text-xs font-semibold text-gray-500 uppercase">All</th>
                </tr>
              </thead>
              <tbody>
                {MODULE_GROUPS.flatMap((group) => {
                  const groupMods = group.keys
                    .map(k => modules.find(m => m.key === k))
                    .filter(Boolean);
                  if (groupMods.length === 0) return [];

                  const rows = [];

                  if (group.label) {
                    rows.push(
                      <tr key={`__group_${group.label}__`}>
                        <td colSpan={7} className="px-4 pt-4 pb-1">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-primary-50 border border-primary-100 rounded-md px-2.5 py-1">
                              <HiOutlineCog className="w-3.5 h-3.5 text-primary-600" />
                              <span className="text-xs font-semibold text-primary-700 uppercase tracking-wide">{group.label}</span>
                            </div>
                            <div className="flex-1 h-px bg-primary-100" />
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  groupMods.forEach((mod) => {
                    const allChecked = mod.actions.every(a => getPermission(mod.key, a));
                    rows.push(
                      <tr key={mod.key} className="hover:bg-gray-50 border-b border-gray-100">
                        <td className={`py-3 px-4 ${group.label ? 'pl-8' : ''}`}>
                          <span className="text-sm font-medium text-gray-800">{mod.label}</span>
                        </td>
                        {['view', 'create', 'edit', 'delete', 'export'].map(action => (
                          <td key={action} className="py-3 px-3 text-center">
                            {mod.actions.includes(action) ? (
                              <input type="checkbox"
                                checked={getPermission(mod.key, action)}
                                onChange={() => togglePermission(mod.key, action)}
                                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer" />
                            ) : (
                              <span className="text-gray-300">-</span>
                            )}
                          </td>
                        ))}
                        <td className="py-3 px-3 text-center">
                          <input type="checkbox"
                            checked={allChecked}
                            onChange={() => toggleAllForModule(mod.key)}
                            className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500 cursor-pointer" />
                        </td>
                      </tr>
                    );
                  });

                  return rows;
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Saving...' : isEdit ? 'Update Role' : 'Create Role'}
          </button>
          <button type="button" onClick={() => navigate('/roles')}
            className="bg-white border border-gray-300 text-gray-700 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default RoleForm;
