import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineX } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getTdsRatesAPI, createTdsRateAPI, updateTdsRateAPI, deleteTdsRateAPI,
} from '../../services/api';

const blank = { taxName: '', rate: 0, section: '' };

const TdsRateFormModal = ({ open, initial, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      taxName: initial.taxName || '',
      rate: initial.rate ?? 0,
      section: initial.section || '',
    } : blank);
  }, [open, initial]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.taxName.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, rate: Number(form.rate) || 0 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit TDS Rate' : 'Add TDS Rate'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tax Name *</label>
            <input value={form.taxName} required
              onChange={(e) => setForm((f) => ({ ...f, taxName: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate (%)</label>
              <input type="number" min="0" max="100" step="0.01" value={form.rate}
                onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Section</label>
              <input value={form.section}
                onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))}
                placeholder="e.g. 194J(i)"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.taxName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TdsRateList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('tds_rates', 'create');
  const canEdit = can('tds_rates', 'edit');
  const canDelete = can('tds_rates', 'delete');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data } = await getTdsRatesAPI();
      setItems(data);
    } catch { toast.error('Failed to load TDS rates'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateTdsRateAPI(modal.item._id, form);
        toast.success('TDS rate updated');
      } else {
        await createTdsRateAPI(form);
        toast.success('TDS rate added');
      }
      setModal({ open: false, item: null });
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
      throw e;
    }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete "${item.taxName}"?`, { title: 'Delete TDS Rate', confirmLabel: 'Delete' }))) return;
    try {
      const { data } = await deleteTdsRateAPI(item._id);
      toast.success(data.message || 'Deleted');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div>
      {canCreate && (
        <div className="flex justify-end mb-4 gap-2">
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add TDS Rate
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No TDS rates configured yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Tax Name</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Rate (%)</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Section</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((r) => (
                  <tr key={r._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">{r.taxName}</td>
                    <td className="py-3 px-4 text-gray-600">{r.rate}%</td>
                    <td className="py-3 px-4 text-gray-600">{r.section || '-'}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <button onClick={() => setModal({ open: true, item: r })}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => handleDelete(r)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
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
        )}
      </div>

      <TdsRateFormModal
        open={modal.open}
        initial={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default TdsRateList;
