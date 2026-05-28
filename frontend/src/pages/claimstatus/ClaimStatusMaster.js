import React, { useState, useEffect } from 'react';
import { getClaimStatusesAPI, createClaimStatusAPI, updateClaimStatusAPI, deleteClaimStatusAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash,
  HiOutlineLockClosed, HiOutlineX, HiOutlineCheck
} from 'react-icons/hi';
import Toggle from '../../components/ui/Toggle';

const COLOR_OPTIONS = [
  { key: 'blue',   label: 'Blue',   classes: 'bg-blue-100 text-blue-700' },
  { key: 'green',  label: 'Green',  classes: 'bg-green-100 text-green-700' },
  { key: 'red',    label: 'Red',    classes: 'bg-red-100 text-red-700' },
  { key: 'yellow', label: 'Yellow', classes: 'bg-yellow-100 text-yellow-700' },
  { key: 'purple', label: 'Purple', classes: 'bg-purple-100 text-purple-700' },
  { key: 'orange', label: 'Orange', classes: 'bg-orange-100 text-orange-700' },
  { key: 'pink',   label: 'Pink',   classes: 'bg-pink-100 text-pink-700' },
  { key: 'indigo', label: 'Indigo', classes: 'bg-indigo-100 text-indigo-700' },
  { key: 'teal',   label: 'Teal',   classes: 'bg-teal-100 text-teal-700' },
  { key: 'gray',   label: 'Gray',   classes: 'bg-gray-100 text-gray-700' },
];

export const STATUS_COLOR_MAP = Object.fromEntries(
  COLOR_OPTIONS.map(c => [c.key, c.classes])
);

const emptyForm = { label: '', slug: '', color: 'blue', order: '' };

const Modal = ({ title, form, setForm, onSave, onClose, saving }) => {
  const handleLabelChange = (val) => {
    setForm(f => ({
      ...f,
      label: val,
      slug: f._id ? f.slug : val.toLowerCase().replace(/\s+/g, '_'),
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl sm:rounded-t-xl flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-2.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
            <input
              value={form.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. Under Review"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              value={form.slug}
              onChange={(e) => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
              placeholder="e.g. under_review"
              disabled={form.isSystem}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1">Used internally — cannot be changed after creation</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex flex-wrap gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c.key }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border-2 transition-all ${c.classes} ${form.color === c.key ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
            <input
              type="number"
              value={form.order}
              onChange={(e) => setForm(f => ({ ...f, order: e.target.value }))}
              placeholder="e.g. 7"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Preview */}
          {form.label && (
            <div className="pt-2">
              <p className="text-xs text-gray-500 mb-2">Preview:</p>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLOR_MAP[form.color] || 'bg-gray-100 text-gray-700'}`}>
                {form.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || !form.label.trim()}
            className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ClaimStatusMaster = () => {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [modal, setModal] = useState(null); // null | 'create' | 'edit'
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    try {
      const { data } = await getClaimStatusesAPI();
      setStatuses(data);
    } catch { toast.error('Failed to fetch statuses'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setForm(emptyForm); setModal('create'); };
  const openEdit = (s) => { setForm({ ...s, order: s.order ?? '' }); setModal('edit'); };
  const closeModal = () => { setModal(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.label.trim()) return toast.error('Label is required');
    setSaving(true);
    try {
      if (modal === 'create') {
        await createClaimStatusAPI({ label: form.label, slug: form.slug, color: form.color, order: form.order || undefined });
        toast.success('Status created');
      } else {
        await updateClaimStatusAPI(form._id, { label: form.label, color: form.color, order: form.order || undefined });
        toast.success('Status updated');
      }
      closeModal();
      fetch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleToggleActive = async (s) => {
    setTogglingId(s._id);
    try {
      await updateClaimStatusAPI(s._id, { isActive: !s.isActive });
      toast.success(`Status ${s.isActive ? 'deactivated' : 'activated'}`);
      fetch();
    } catch { toast.error('Failed to update'); }
    finally { setTogglingId(null); }
  };

  const handleDelete = async (s) => {
    if (!await confirm(`Delete status "${s.label}"?`, { title: 'Delete Status', confirmLabel: 'Delete' })) return;
    try {
      await deleteClaimStatusAPI(s._id);
      toast.success('Status deleted');
      fetch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-4 mb-6">
        {can('claim_statuses', 'create') && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Status
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-12">Order</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Slug</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Active</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Loading...</td></tr>
            ) : statuses.length === 0 ? (
              <tr><td colSpan={6} className="py-10 text-center text-gray-400">No statuses found. Run seed to add defaults.</td></tr>
            ) : statuses.map((s) => (
              <tr key={s._id} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-sm text-gray-400 font-mono">{s.order}</td>
                <td className="py-3 px-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700'}`}>
                    {s.label}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-gray-500 font-mono">{s.slug}</td>
                <td className="py-3 px-4 text-center">
                  <Toggle checked={s.isActive} onChange={() => handleToggleActive(s)} loading={togglingId === s._id} size="sm" />
                </td>
                <td className="py-3 px-4 text-center">
                  {s.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <HiOutlineLockClosed className="w-3.5 h-3.5" /> System
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Custom</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-1">
                    {can('claim_statuses', 'edit') && (
                      <button onClick={() => openEdit(s)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                    )}
                    {can('claim_statuses', 'delete') && !s.isSystem && (
                      <button onClick={() => handleDelete(s)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Add New Status' : 'Edit Status'}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
};

export default ClaimStatusMaster;
