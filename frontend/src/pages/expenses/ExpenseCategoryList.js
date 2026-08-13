import React, { useEffect, useState } from 'react';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineX } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getExpenseCategoriesAPI, createExpenseCategoryAPI, updateExpenseCategoryAPI, deleteExpenseCategoryAPI,
} from '../../services/api';

// Accounting nature — capital / fixed-asset categories are excluded from P&L
// (Profit report + Dashboard).
const NATURE = {
  expense:     { label: 'Expense',     cls: 'bg-gray-100 text-gray-600' },
  capital:     { label: 'Capital',     cls: 'bg-indigo-50 text-indigo-700' },
  fixed_asset: { label: 'Fixed Asset', cls: 'bg-teal-50 text-teal-700' },
};

const blank = { label: '', order: 0, isActive: true, nature: 'expense' };

const CategoryModal = ({ open, initial, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(initial
      ? { label: initial.label || '', order: initial.order ?? 0, isActive: initial.isActive, nature: initial.nature || 'expense' }
      : blank);
  }, [open, initial]);
  if (!open) return null;
  const submit = async (e) => {
    e.preventDefault();
    if (!form.label.trim()) return;
    setSaving(true);
    try { await onSave({ ...form, order: Number(form.order) || 0 }); }
    finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Category' : 'Add Category'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
            <input value={form.label} required
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nature</label>
            <select value={form.nature}
              onChange={(e) => setForm((f) => ({ ...f, nature: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="expense">Expense (P&L)</option>
              <option value="capital">Capital</option>
              <option value="fixed_asset">Fixed Asset</option>
            </select>
            <p className="text-xs text-gray-400 mt-1">Capital &amp; Fixed Asset are excluded from Profit &amp; Loss.</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Order</label>
              <input type="number" value={form.order}
                onChange={(e) => setForm((f) => ({ ...f, order: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                  className="rounded border-gray-300 text-primary-600" />
                Active
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.label.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ExpenseCategoryList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('expense_categories', 'create');
  const canEdit = can('expense_categories', 'edit');
  const canDelete = can('expense_categories', 'delete');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });

  const fetchAll = async () => {
    setLoading(true);
    try {
      const { data } = await getExpenseCategoriesAPI();
      setItems(data);
    } catch { toast.error('Failed to load categories'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateExpenseCategoryAPI(modal.item._id, form);
        toast.success('Category updated');
      } else {
        await createExpenseCategoryAPI(form);
        toast.success('Category added');
      }
      setModal({ open: false, item: null });
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
      throw e;
    }
  };

  const toggleActive = async (item) => {
    if (!canEdit) return;
    try {
      await updateExpenseCategoryAPI(item._id, { isActive: !item.isActive });
      toast.success(item.isActive ? 'Category deactivated' : 'Category activated');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to update');
    }
  };

  const handleDelete = async (item) => {
    if (item.isSystem) { toast.error('System categories cannot be deleted'); return; }
    if (!(await confirm(`Delete "${item.label}"?`, { title: 'Delete Category', confirmLabel: 'Delete' }))) return;
    try {
      const { data } = await deleteExpenseCategoryAPI(item._id);
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
            <HiOutlinePlus className="w-4 h-4" /> Add Category
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {loading ? (
          <Loader label="Loading…" className="py-8" />
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No categories</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Label</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Slug</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Nature</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Order</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((c) => (
                  <tr key={c._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">
                      {c.label}
                      {c.isSystem && <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-primary-50 text-primary-700 rounded">SYSTEM</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.slug}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${(NATURE[c.nature] || NATURE.expense).cls}`}>
                        {(NATURE[c.nature] || NATURE.expense).label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{c.order}</td>
                    <td className="py-3 px-4">
                      <button
                        onClick={() => toggleActive(c)}
                        disabled={!canEdit}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${c.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'} ${!canEdit ? 'cursor-default opacity-70' : 'cursor-pointer'}`}
                      >
                        {c.isActive ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <button onClick={() => setModal({ open: true, item: c })}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && !c.isSystem && (
                          <button onClick={() => handleDelete(c)}
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

      <CategoryModal open={modal.open} initial={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave} />
    </div>
  );
};

export default ExpenseCategoryList;
