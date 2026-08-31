import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';

const todayIso = () => new Date().toISOString().slice(0, 10);

const blank = { date: todayIso(), categoryId: '', amount: 0, notes: '', partyName: '', referenceId: '', partyId: '', paymentMode: 'cash', bankAccountId: '', paidAmount: '' };

const PAYMENT_MODES = [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }];

const ExpenseFormModal = ({ open, initial, mode = 'create', categories, references, parties = [], bankAccounts = [], loadingRefs = false, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  const isEdit = mode === 'edit';
  const isDuplicate = mode === 'duplicate';

  useEffect(() => {
    if (!open) return;
    if (initial) {
      // Prefill the paid amount + mode from the current linked payment. A
      // duplicate starts fresh (Unpaid) — its money hasn't moved yet.
      const pay = (initial.payments || [])[0];
      setForm({
        date: isDuplicate ? todayIso() : (initial.date || '').slice(0, 10),
        categoryId: initial.category?._id || initial.categoryId || '',
        amount: initial.amount ?? 0,
        notes: initial.notes || '',
        partyName: initial.partyName || '',
        referenceId: initial.reference?._id || initial.referenceId || '',
        partyId: initial.party?._id || initial.partyId || '',
        paymentMode: isDuplicate ? 'cash' : (pay?.mode || 'cash'),
        bankAccountId: isDuplicate ? '' : (pay?.bankAccount?._id || pay?.bankAccountId || ''),
        paidAmount: isDuplicate ? '' : (initial.amountPaid ? String(initial.amountPaid) : ''),
      });
    } else {
      setForm({ ...blank, categoryId: categories[0]?._id || '' });
    }
  }, [open, initial, categories, isDuplicate]);

  // Auto-pick the default bank when switching to Bank/UPI; drop it for Cash
  // (cash entries never carry a bank account). Mirrors the Cash/Bank form.
  useEffect(() => {
    if (!open) return;
    if ((form.paymentMode === 'bank' || form.paymentMode === 'upi') && !form.bankAccountId && bankAccounts.length) {
      const def = bankAccounts.find((a) => a.isDefault) || bankAccounts[0];
      if (def) setForm((f) => ({ ...f, bankAccountId: def._id }));
    }
    if (form.paymentMode === 'cash' && form.bankAccountId) {
      setForm((f) => ({ ...f, bankAccountId: '' }));
    }
  }, [form.paymentMode, form.bankAccountId, bankAccounts, open]);

  if (!open) return null;

  const amountNum = Math.round(Number(form.amount) || 0);
  const paidNum = form.paidAmount === '' ? 0 : Math.round(Number(form.paidAmount) || 0);
  const balance = amountNum - paidNum;
  const needsBank = form.paymentMode === 'bank' || form.paymentMode === 'upi';

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
        // Payment: paidAmount 0 => Unpaid. Backend clamps to [0, amount] and
        // records a cash/bank OUT entry for the paid portion.
        paymentMode: form.paymentMode,
        bankAccountId: needsBank ? (form.bankAccountId || null) : null,
        paidAmount: paidNum,
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

          {/* Payment — leave Paid blank/0 for an Unpaid expense; enter part of
              the amount for a partial payment. */}
          <div className="border-t border-gray-100 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode</label>
                <SearchableSelect
                  value={form.paymentMode}
                  onChange={(v) => setForm((f) => ({ ...f, paymentMode: v }))}
                  options={PAYMENT_MODES}
                  placeholder="Payment mode"
                  searchPlaceholder="Search..."
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium text-gray-700">Paid (₹)</label>
                  <button type="button"
                    onClick={() => setForm((f) => ({ ...f, paidAmount: String(Math.abs(Math.round(Number(f.amount) || 0))) }))}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700">Full</button>
                </div>
                <input type="number" min="0" value={form.paidAmount}
                  onChange={(e) => setForm((f) => ({ ...f, paidAmount: e.target.value }))}
                  placeholder="0 — leave blank for Unpaid"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>
            {needsBank && (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account *</label>
                {bankAccounts.length ? (
                  <SearchableSelect
                    value={form.bankAccountId}
                    onChange={(v) => setForm((f) => ({ ...f, bankAccountId: v }))}
                    options={bankAccounts.map((b) => ({ value: b._id, label: `${b.bankName}${b.accountNumber ? ` — ${b.accountNumber}` : ''}` }))}
                    placeholder="Select bank account"
                    searchPlaceholder="Search banks..."
                  />
                ) : (
                  <p className="text-xs text-amber-600">No bank accounts. Add one in Settings → Bank Accounts, or use Cash.</p>
                )}
              </div>
            )}
            <div className="flex items-center justify-between mt-3 text-sm">
              <span className="text-gray-500">Balance</span>
              <span className={`font-semibold ${balance < 0 ? 'text-red-600' : balance === 0 ? 'text-green-600' : 'text-gray-800'}`}>
                ₹{Math.abs(balance).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{balance < 0 ? ' over' : ''}
              </span>
            </div>
            {balance < 0 && <p className="text-xs text-red-600 mt-1">Paid exceeds the amount — it will be capped to ₹{amountNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}.</p>}
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
