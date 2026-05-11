import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRolesAPI, deleteRoleAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineLockClosed } from 'react-icons/hi';

const RoleList = () => {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRoles = async () => {
    try {
      const { data } = await getRolesAPI();
      setRoles(data);
    } catch { toast.error('Failed to fetch roles'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchRoles(); }, []);

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete role "${name}"? Users assigned to this role will lose access.`)) return;
    try {
      await deleteRoleAPI(id);
      toast.success('Role deleted');
      fetchRoles();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to delete');
    }
  };

  const countPermissions = (role) => {
    let count = 0;
    role.modulePermissions?.forEach(m => {
      Object.values(m.permissions).forEach(v => { if (v) count++; });
    });
    return count;
  };

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Roles & Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">Manage access control for your system</p>
        </div>
        {can('roles', 'create') && (
          <button onClick={() => navigate('/roles/new')}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-5 h-5" /> Create Role
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full py-8 text-center text-gray-400">Loading...</div>
        ) : roles.map((role) => (
          <div key={role._id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-gray-800">{role.name}</h3>
                  {role.isSystem && (
                    <HiOutlineLockClosed className="w-4 h-4 text-gray-400" title="System role" />
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{role.slug}</p>
              </div>
              <span className="px-2 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                {countPermissions(role)} permissions
              </span>
            </div>

            {role.description && (
              <p className="text-sm text-gray-500 mb-3">{role.description}</p>
            )}

            {/* Module badges */}
            <div className="flex flex-wrap gap-1 mb-4">
              {role.modulePermissions
                ?.filter(m => m.permissions.view)
                .map(m => (
                  <span key={m.module} className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-600 capitalize">
                    {m.module}
                  </span>
                ))}
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
              {can('roles', 'edit') && (
                <button onClick={() => navigate(`/roles/${role._id}/edit`)}
                  className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium">
                  <HiOutlinePencil className="w-4 h-4" /> Edit
                </button>
              )}
              {can('roles', 'delete') && !role.isSystem && (
                <button onClick={() => handleDelete(role._id, role.name)}
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-700 font-medium ml-auto">
                  <HiOutlineTrash className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RoleList;
