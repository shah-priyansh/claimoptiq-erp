import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';

const todayIso = () => new Date().toISOString().slice(0, 10);

const blank = {
  date: todayIso(),
  entryType: 'general',
  remarks: '',
  debit: 0,
  credit: 0,
  fromMode: 'bank',
  toMode: 'cash',
  amount: 0,
};

const AccountEntryFormModal = ({ open, initial, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      date: (initial.date || '').slice(0, 10),
      entryType: initial.entryType || 'general',
      remarks: initial.remarks || '',
      debit: initial.debit ?? 0,
      credit: initial.credit ?? 0,
      fromMode: initial.fromMode || 'bank',
      toMode: initial.toMode || 'cash',
      amount: initial.amount ?? 0,
    } : blank);
  }, [open, initial]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    const isGeneral = form.entryType === 'general';
    if (isGeneral && Number(form.debit) <= 0 && Number(form.credit) <= 0) return;
    if (!isGeneral && Number(form.amount) <= 0) return;
    if (!isGeneral && form.fromMode === form.toMode) return;

    setSaving(true);
    try {
      const payload = {
        date: form.date,
        entryType: form.entryType,
        remarks: form.remarks,
      };
      if (isGeneral) {
        payload.debit = Number(form.debit) || 0;
        payload.credit = Number(form.credit) || 0;
      } else {
        payload.fromMode = form.fromMode;
        payload.toMode = form.toMode;
        payload.amount = Number(form.amount) || 0;
      }
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Account Entry' : 'Add Account Entry'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        <div className="px-5 pt-4">
          <div className="flex gap-2 border-b border-gray-100">
            {['general', 'contra'].map((t) => (
              <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, entryType: t }))}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  form.entryType === t ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}>
                {t === 'general' ? 'General' : 'Contra'}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
            <input type="date" required value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>

          {form.entryType === 'general' ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Debit (₹)</label>
                <input type="number" min="0" value={form.debit}
                  onChange={(e) => setForm((f) => ({ ...f, debit: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Credit (₹)</label>
                <input type="number" min="0" value={form.credit}
                  onChange={(e) => setForm((f) => ({ ...f, credit: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">From *</label>
                  <select value={form.fromMode}
                    onChange={(e) => setForm((f) => ({ ...f, fromMode: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                    {['cash', 'bank', 'upi'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">To *</label>
                  <select value={form.toMode}
                    onChange={(e) => setForm((f) => ({ ...f, toMode: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                    {['cash', 'bank', 'upi'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                  </select>
                </div>
              </div>
              {form.fromMode === form.toMode && (
                <p className="text-xs text-red-600">From and To must be different modes.</p>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) *</label>
                <input type="number" min="1" required value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
            <textarea rows={2} value={form.remarks}
              onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AccountEntryFormModal;
