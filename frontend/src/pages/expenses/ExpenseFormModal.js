import React, { useEffect, useState } from 'react';
import { HiOutlineX, HiOutlineTrash } from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';

const todayIso = () => new Date().toISOString().slice(0, 10);

// Money is stored to the paisa (e.g. a ₹899.37 petrol bill), so round to 2
// decimals — never to whole rupees, which would drop the paisa and leave a
// stale Balance (₹899.37 paid on a ₹899.37 bill must read ₹0.00, not ₹0.37).
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Mirror of backend utils/lineQty.js so a line's amount updates live as the
// operator types "2" or "50%". The server always recomputes on save.
const parseQty = (raw) => {
  const s = String(raw ?? '1').trim();
  const isPercent = s.includes('%');
  const parsed = parseFloat(s.replace('%', ''));
  const qtyValue = Number.isFinite(parsed) ? parsed : (isPercent ? 0 : 1);
  return { isPercent, qtyValue };
};
const calcLineAmount = (rate, qtyRaw) => {
  const { isPercent, qtyValue } = parseQty(qtyRaw);
  const r = Number(rate) || 0;
  return round2(isPercent ? (r * qtyValue) / 100 : r * qtyValue);
};

const blankLine = () => ({ description: '', qtyRaw: '1', rate: '' });
const blank = { date: todayIso(), categoryId: '', lineItems: [blankLine()], notes: '', partyName: '', referenceId: '', partyId: '', paymentMode: 'cash', bankAccountId: '', paidAmount: '' };

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
      // Prefer the stored line items; fall back to a single line derived from the
      // flat amount for any expense predating line items.
      const lineItems = (initial.lineItems || []).length
        ? initial.lineItems.map((l) => ({ description: l.description || '', qtyRaw: l.qtyRaw || '1', rate: l.rate ?? l.amount ?? '' }))
        : [{ description: initial.notes || '', qtyRaw: '1', rate: initial.amount ?? '' }];
      setForm({
        date: isDuplicate ? todayIso() : (initial.date || '').slice(0, 10),
        categoryId: initial.category?._id || initial.categoryId || '',
        lineItems,
        notes: initial.notes || '',
        partyName: initial.partyName || '',
        referenceId: initial.reference?._id || initial.referenceId || '',
        partyId: initial.party?._id || initial.partyId || '',
        paymentMode: isDuplicate ? 'cash' : (pay?.mode || 'cash'),
        bankAccountId: isDuplicate ? '' : (pay?.bankAccount?._id || pay?.bankAccountId || ''),
        paidAmount: isDuplicate ? '' : (initial.amountPaid ? String(initial.amountPaid) : ''),
      });
    } else {
      setForm({ ...blank, lineItems: [blankLine()], categoryId: categories[0]?._id || '' });
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

  const lines = form.lineItems || [];
  const linesTotal = round2(lines.reduce((s, l) => s + calcLineAmount(l.rate, l.qtyRaw), 0));
  const amountNum = linesTotal;
  const paidNum = form.paidAmount === '' ? 0 : round2(form.paidAmount);
  const balance = round2(amountNum - paidNum);
  const needsBank = form.paymentMode === 'bank' || form.paymentMode === 'upi';
  const validLines = lines.filter((l) => (l.description || '').trim() || Number(l.rate));

  const updateRow = (idx, patch) => setForm((f) => ({ ...f, lineItems: f.lineItems.map((l, i) => (i === idx ? { ...l, ...patch } : l)) }));
  const addRow = () => setForm((f) => ({ ...f, lineItems: [...f.lineItems, blankLine()] }));
  const removeRow = (idx) => setForm((f) => ({ ...f, lineItems: f.lineItems.length > 1 ? f.lineItems.filter((_, i) => i !== idx) : f.lineItems }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.categoryId || !form.date) return;
    const lineItems = lines
      .map((l) => ({ description: (l.description || '').trim(), qtyRaw: String(l.qtyRaw ?? '1'), rate: Number(l.rate) || 0 }))
      .filter((l) => l.description || l.rate);
    if (!lineItems.length) return;
    setSaving(true);
    try {
      await onSave({
        date: form.date,
        categoryId: form.categoryId,
        // Amount is the summed line total (backend recomputes it authoritatively).
        amount: amountNum,
        lineItems,
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
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-800">{isEdit ? 'Edit Expense' : isDuplicate ? 'Duplicate Expense' : 'Add Expense'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="flex flex-col min-h-0 flex-1">
          <div className="p-5 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" required value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
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
          </div>

          {/* Line items — same qty x rate format as invoices. The expense amount
              is the sum of these lines. */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Items *</label>
              <button type="button" onClick={addRow}
                className="text-xs font-medium text-primary-600 hover:text-primary-700">+ Add Item</button>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-16">Qty</th>
                    <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-28">Rate</th>
                    <th className="text-right py-2 px-2 text-[11px] font-semibold text-gray-500 uppercase w-28">Amount</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-1.5 px-2">
                        <input type="text" value={l.description} maxLength={300}
                          onChange={(e) => updateRow(idx, { description: e.target.value })}
                          placeholder="Item description"
                          className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="text" value={l.qtyRaw} placeholder="1" title="e.g. 2 or 50%"
                          onChange={(e) => updateRow(idx, { qtyRaw: e.target.value })}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-1.5 px-2">
                        <input type="number" step="0.01" value={l.rate} placeholder="0"
                          onChange={(e) => updateRow(idx, { rate: e.target.value })}
                          className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-gray-800 font-medium">
                        {fmtINR(calcLineAmount(l.rate, l.qtyRaw))}
                      </td>
                      <td className="py-1.5 px-1 text-center">
                        <button type="button" onClick={() => removeRow(idx)} disabled={lines.length <= 1}
                          title="Remove item"
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400">
                          <HiOutlineTrash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50 border-t border-gray-200">
                  <tr>
                    <td colSpan={3} className="py-2 px-2 text-right text-[11px] uppercase text-gray-500 font-semibold">Total</td>
                    <td className="py-2 px-2 text-right font-semibold text-gray-800 tabular-nums">{fmtINR(linesTotal)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="text-xs text-gray-400 mt-1">Tip: leave Qty as 1 and type the amount in Rate for a simple single-amount expense. Qty also accepts a percent like "50%".</p>
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
                    onClick={() => setForm((f) => ({ ...f, paidAmount: String(Math.abs(amountNum)) }))}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700">Full</button>
                </div>
                <input type="number" min="0" step="0.01" value={form.paidAmount}
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

          </div>

          <div className="flex justify-end gap-2 p-5 pt-3 border-t border-gray-100 flex-shrink-0">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.categoryId || !validLines.length}
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
