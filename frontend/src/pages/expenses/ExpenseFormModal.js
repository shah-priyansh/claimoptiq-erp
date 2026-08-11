import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';

const todayIso = () => new Date().toISOString().slice(0, 10);

const blank = { date: todayIso(), categoryId: '', amount: 0, notes: '', partyName: '', referenceId: '', partyId: '' };

const ExpenseFormModal = ({ open, initial, mode = 'create', categories, references, parties = [], loadingRefs = false, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const isEdit = mode === 'edit';
  const isDuplicate = mode === 'duplicate';

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        date: isDuplicate ? todayIso() : (initial.date || '').slice(0, 10),
        categoryId: initial.category?._id || initial.categoryId || '',
        amount: initial.amount ?? 0,
        notes: initial.notes || '',
        partyName: initial.partyName || '',
        referenceId: initial.reference?._id || initial.referenceId || '',
        partyId: initial.party?._id || initial.partyId || '',
      });
    } else {
      setForm({ ...blank, categoryId: categories[0]?._id || '' });
    }
  }, [open, initial, categories, isDuplicate]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.categoryId || !form.date) return;
    setSaving(true);
    try {
      await onSave({
        date: form.date,
        categoryId: form.categoryId,
        amount: Number(form.amount) || 0,
        notes: form.notes,
        partyName: form.partyName,
        referenceId: form.referenceId || null,
        partyId: form.partyId || null,
      });
    } finally {
      setSaving(false);
    }
  };

  const selectedSlug = categories.find((c) => c._id === form.categoryId)?.slug;
  const showRefHint = selectedSlug === 'reference_commission' && !form.referenceId;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{isEdit ? 'Edit Expense' : isDuplicate ? 'Duplicate Expense' : 'Add Expense'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" required value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) *</label>
              <input type="number" required value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="Negative for reversals"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Category *</label>
            <SearchableSelect
              required
              value={form.categoryId}
              onChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              placeholder="Select category"
              searchPlaceholder="Search categories..."
              options={categories.filter((c) => c.isActive).map((c) => ({ value: c._id, label: c.label }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Reference (optional)
              {selectedSlug === 'reference_commission' && <span className="text-xs text-gray-400 ml-1">— attributing helps reports</span>}
            </label>
            <SearchableSelect
              isLoading={loadingRefs}
              value={form.referenceId}
              onChange={(v) => setForm((f) => ({ ...f, referenceId: v }))}
              placeholder="Pick a reference"
              searchPlaceholder="Search references..."
              noneLabel="— None —"
              allowClear
              options={references.map((r) => ({ value: r._id, label: `${r.name}${r.commissionRate ? ` (${r.commissionRate}%)` : ''}` }))}
            />
            {showRefHint && (
              <p className="text-xs text-amber-600 mt-1">No reference picked — this row will show as "unattributed" in reports.</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Party</label>
            <SearchableSelect
              value={form.partyId}
              onChange={(v) => {
                const p = parties.find((x) => x._id === v);
                setForm((f) => ({ ...f, partyId: v, partyName: p ? p.name : f.partyName }));
              }}
              placeholder="Link an existing party"
              searchPlaceholder="Search parties..."
              noneLabel="— None —"
              allowClear
              options={parties.map((p) => ({ value: p._id, label: p.name }))}
            />
            {!form.partyId && (
              <input type="text" value={form.partyName} maxLength={200}
                onChange={(e) => setForm((f) => ({ ...f, partyName: e.target.value }))}
                placeholder="…or type a new party / vendor name"
                className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.categoryId}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ExpenseFormModal;
