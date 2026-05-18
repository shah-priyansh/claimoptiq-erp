import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getRolesAPI, deleteRoleAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineLockClosed, HiOutlineShieldCheck } from 'react-icons/hi';

const ROLE_COLORS = [
  { avatar: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700' },
  { avatar: 'bg-violet-100 text-violet-700', bar: 'bg-violet-500', badge: 'bg-violet-50 text-violet-700' },
  { avatar: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', badge: 'bg-emerald-50 text-emerald-700' },
  { avatar: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', badge: 'bg-amber-50 text-amber-700' },
  { avatar: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500', badge: 'bg-rose-50 text-rose-700' },
  { avatar: 'bg-cyan-100 text-cyan-700', bar: 'bg-cyan-500', badge: 'bg-cyan-50 text-cyan-700' },
];

const getInitials = (name) =>
  name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'R';

const SkeletonCard = () => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
    <div className="h-1 bg-gray-200" />
    <div className="p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-gray-200 flex-shrink-0" />
        <div className="flex-1">
          <div className="h-4 bg-gray-200 rounded w-28 mb-1.5" />
          <div className="h-3 bg-gray-100 rounded w-16" />
        </div>
      </div>
      <div className="h-3 bg-gray-100 rounded w-full mb-2" />
      <div className="h-3 bg-gray-100 rounded w-3/4 mb-4" />
      <div className="flex gap-2 mb-4">
        <div className="h-6 w-20 bg-gray-100 rounded-lg" />
        <div className="h-6 w-16 bg-gray-100 rounded-lg" />
      </div>
      <div className="flex gap-1 mb-4">
        {[1,2,3].map(i => <div key={i} className="h-5 w-16 bg-gray-100 rounded" />)}
      </div>
      <div className="pt-3 border-t border-gray-100">
        <div className="h-6 w-12 bg-gray-100 rounded" />
      </div>
    </div>
  </div>
);

const RoleList = () => {
  const navigate = useNavigate();
  const { can } = useAuth();
  const confirm = useConfirm();
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
    if (!await confirm(`Delete role "${name}"? Users assigned to this role will lose access.`, { title: 'Delete Role', confirmLabel: 'Delete' })) return;
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Roles & Permissions</h1>
          <p className="text-sm text-gray-500 mt-1">
            {!loading && `${roles.length} roles · `}Manage access control for your system
          </p>
        </div>
        {can('roles', 'create') && (
          <button
            onClick={() => navigate('/roles/new')}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <HiOutlinePlus className="w-4 h-4" /> Create Role
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading
          ? [1, 2, 3, 4].map(i => <SkeletonCard key={i} />)
          : roles.map((role, idx) => {
              const color = ROLE_COLORS[idx % ROLE_COLORS.length];
              const permCount = countPermissions(role);
              const visibleModules = role.modulePermissions?.filter(m => m.permissions.view) || [];
              const moduleCount = visibleModules.length;

              return (
                <div
                  key={role._id}
                  className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md hover:border-gray-300 transition-all duration-200 flex flex-col"
                >
                  {/* Accent bar */}
                  <div className={`h-1 w-full ${color.bar}`} />

                  <div className="p-5 flex flex-col flex-1">
                    {/* Role identity */}
                    <div className="flex items-center gap-3 mb-3">
                      <div className={`w-10 h-10 rounded-lg ${color.avatar} flex items-center justify-center font-bold text-sm flex-shrink-0`}>
                        {getInitials(role.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <h3 className="text-sm font-semibold text-gray-800 truncate">{role.name}</h3>
                          {role.isSystem && (
                            <HiOutlineLockClosed className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" title="System role" />
                          )}
                        </div>
                        <p className="text-xs text-gray-400 font-mono">{role.slug}</p>
                      </div>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-gray-500 mb-4 line-clamp-2 min-h-[2.5rem]">
                      {role.description || <span className="italic text-gray-400">No description</span>}
                    </p>

                    {/* Stats */}
                    <div className="flex items-center gap-2 mb-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${color.badge}`}>
                        <HiOutlineShieldCheck className="w-3.5 h-3.5" />
                        {permCount} permissions
                      </span>
                      <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium bg-gray-100 text-gray-600">
                        {moduleCount} modules
                      </span>
                    </div>

                    {/* Module tags */}
                    <div className="flex flex-wrap gap-1 flex-1 mb-4">
                      {visibleModules.slice(0, 6).map(m => (
                        <span
                          key={m.module}
                          className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-600 capitalize font-medium"
                        >
                          {m.module}
                        </span>
                      ))}
                      {visibleModules.length > 6 && (
                        <span className="px-2 py-0.5 rounded-md text-xs bg-gray-100 text-gray-500">
                          +{visibleModules.length - 6}
                        </span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 pt-3 border-t border-gray-100">
                      {can('roles', 'edit') && (
                        <button
                          onClick={() => navigate(`/roles/${role._id}/edit`)}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                        >
                          <HiOutlinePencil className="w-3.5 h-3.5" /> Edit
                        </button>
                      )}
                      {can('roles', 'delete') && !role.isSystem && (
                        <button
                          onClick={() => handleDelete(role._id, role.name)}
                          className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors ml-auto cursor-pointer"
                        >
                          <HiOutlineTrash className="w-3.5 h-3.5" /> Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
};

export default RoleList;
