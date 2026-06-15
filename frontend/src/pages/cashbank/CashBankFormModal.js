import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';

const todayIso = () => new Date().toISOString().slice(0, 10);
const blank = {
  date: todayIso(),
  direction: 'in',
  mode: 'cash',
  amount: 0,
  notes: '',
  link: 'none',           // 'none' | 'invoice' | 'expense'
  invoiceId: '',
  expenseId: '',
  utrNumber: '',
  chequeNumber: '',
};

const CashBankFormModal = ({ open, initial, invoices, expenses, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const linked = initial.invoice ? 'invoice' : initial.expense ? 'expense' : 'none';
      setForm({
        date: (initial.date || '').slice(0, 10),
        direction: initial.direction || 'in',
        mode: initial.mode || 'cash',
        amount: initial.amount ?? 0,
        notes: initial.notes || '',
        link: linked,
        invoiceId: initial.invoice?._id || '',
        expenseId: initial.expense?._id || '',
        utrNumber: initial.utrNumber || '',
        chequeNumber: initial.chequeNumber || '',
      });
    } else {
      setForm(blank);
    }
  }, [open, initial]);

  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (Number(form.amount) <= 0) return;
    setSaving(true);
    try {
      await onSave({
        date: form.date,
        direction: form.direction,
        mode: form.mode,
        amount: Number(form.amount) || 0,
        notes: form.notes,
        invoiceId: form.link === 'invoice' ? (form.invoiceId || null) : null,
        expenseId: form.link === 'expense' ? (form.expenseId || null) : null,
        utrNumber: form.utrNumber,
        chequeNumber: form.chequeNumber,
      });
    } finally {
      setSaving(false);
    }
  };

  const showUtr = form.mode === 'bank' || form.mode === 'upi';
  const showCheque = form.mode === 'cash' || form.mode === 'bank';
  // For OUT direction we restrict the link picker to none/expense; for IN, none/invoice.
  const availableLinks = form.direction === 'in'
    ? [{ v: 'none', l: 'No link' }, { v: 'invoice', l: 'Invoice (receipt)' }]
    : [{ v: 'none', l: 'No link' }, { v: 'expense', l: 'Expense (payout)' }];

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Entry' : 'Add Cash / Bank Entry'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setForm((f) => ({ ...f, direction: 'in', link: f.link === 'expense' ? 'none' : f.link }))}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                form.direction === 'in' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              IN — Money received
            </button>
            <button type="button" onClick={() => setForm((f) => ({ ...f, direction: 'out', link: f.link === 'invoice' ? 'none' : f.link }))}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                form.direction === 'out' ? 'bg-red-50 border-red-300 text-red-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              OUT — Money paid
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" required value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) *</label>
              <input type="number" min="1" required value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Mode *</label>
            <div className="grid grid-cols-3 gap-2">
              {['cash', 'bank', 'upi'].map((m) => (
                <button key={m} type="button" onClick={() => setForm((f) => ({ ...f, mode: m }))}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                    form.mode === m ? 'bg-primary-50 border-primary-300 text-primary-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  {m.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Link to</label>
              <select value={form.link}
                onChange={(e) => setForm((f) => ({ ...f, link: e.target.value, invoiceId: '', expenseId: '' }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                {availableLinks.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
              </select>
            </div>
            <div>
              {form.link === 'invoice' && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice</label>
                  <select value={form.invoiceId}
                    onChange={(e) => setForm((f) => ({ ...f, invoiceId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                    <option value="">— Select invoice —</option>
                    {invoices.map((i) => <option key={i._id} value={i._id}>{i.invoiceNumber || `Draft-${i._id.slice(0,8)}`} • {i.hospital?.name}</option>)}
                  </select>
                </>
              )}
              {form.link === 'expense' && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expense</label>
                  <select value={form.expenseId}
                    onChange={(e) => setForm((f) => ({ ...f, expenseId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                    <option value="">— Select expense —</option>
                    {expenses.map((e) => <option key={e._id} value={e._id}>{e.category?.label} • ₹{e.amount} • {(e.date || '').slice(0,10)}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {showUtr && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">UTR / Txn No.</label>
                <input value={form.utrNumber}
                  onChange={(e) => setForm((f) => ({ ...f, utrNumber: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            )}
            {showCheque && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cheque No.</label>
                <input value={form.chequeNumber}
                  onChange={(e) => setForm((f) => ({ ...f, chequeNumber: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
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
            <button type="submit" disabled={saving || Number(form.amount) <= 0}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CashBankFormModal;
