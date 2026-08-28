import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { invoiceDisplayName } from '../../utils/invoice';
import { formatDate } from '../../utils/format';

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
  bankAccountId: '',
  utrNumber: '',
  chequeNumber: '',
};

// `lockDirection` ('in' | 'out') locks the entry direction to a single value and
// hides the other toggle button — used when the modal is opened from a context
// that only makes sense one way: Invoices/mark-paid → 'in' (money received),
// Expenses/record-payment → 'out' (money paid). Left null on the Cash/Bank
// ledger page, where the operator freely picks IN or OUT.
// `defaults` pre-fills a NEW entry (ignored when editing) — used by the Bank
// Accounts page's Deposit/Withdraw to preset mode/direction/bankAccountId.
const CashBankFormModal = ({ open, initial, defaults = null, invoices, expenses, bankAccounts = [], loadingInvoices = false, loadingExpenses = false, loadingBankAccounts = false, lockDirection = null, allowSplit = false, allowMultiLink = false, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  // Extra allocations. With allowSplit these hold the "unused" amount when the
  // entered amount exceeds the linked bill's pending. With allowMultiLink they
  // are additional bills the operator links to one payment. Each: { id, amount }.
  const [extras, setExtras] = useState([]);
  // allowMultiLink: the primary bill's own allocation amount (the entry Amount
  // then becomes the sum of the primary + every extra).
  const [primaryAmount, setPrimaryAmount] = useState('');

  useEffect(() => {
    if (!open) return;
    setExtras([]);
    if (initial) {
      const linked = initial.invoice ? 'invoice' : initial.expense ? 'expense' : 'none';
      setForm({
        date: (initial.date || '').slice(0, 10),
        direction: lockDirection || initial.direction || 'in',
        mode: initial.mode || 'cash',
        amount: initial.amount ?? 0,
        notes: initial.notes || '',
        link: linked,
        invoiceId: initial.invoice?._id || '',
        expenseId: initial.expense?._id || '',
        bankAccountId: initial.bankAccount?._id || initial.bankAccountId || '',
        utrNumber: initial.utrNumber || '',
        chequeNumber: initial.chequeNumber || '',
      });
    } else {
      setForm({ ...blank, direction: lockDirection || blank.direction, ...(defaults || {}) });
    }
  }, [open, initial, lockDirection, defaults]);

  // When mode flips to bank/upi and no account is picked yet, auto-select the
  // operator's default account so the operator can just click Save.
  useEffect(() => {
    if (!open) return;
    if ((form.mode === 'bank' || form.mode === 'upi') && !form.bankAccountId && bankAccounts.length) {
      const def = bankAccounts.find((a) => a.isDefault) || bankAccounts[0];
      if (def) setForm((f) => ({ ...f, bankAccountId: def._id }));
    }
    if (form.mode === 'cash' && form.bankAccountId) {
      // Cash entries never carry a bank account — drop the leftover when the
      // operator toggles back from bank/upi to cash.
      setForm((f) => ({ ...f, bankAccountId: '' }));
    }
  }, [form.mode, form.bankAccountId, bankAccounts, open]);

  // Reset the extra allocations whenever the primary link changes.
  useEffect(() => { setExtras([]); setPrimaryAmount(''); }, [form.link, form.invoiceId, form.expenseId]);

  if (!open) return null;

  // ── Split-on-excess bookkeeping ──
  const linkType = form.link; // 'invoice' | 'expense' | 'none'
  const items = linkType === 'invoice' ? (invoices || []) : linkType === 'expense' ? (expenses || []) : [];
  const pendingOf = (it) => Math.max(0, Math.round(Number(it?.amountPending ?? it?.amount ?? 0)));
  const primaryId = linkType === 'invoice' ? form.invoiceId : linkType === 'expense' ? form.expenseId : '';
  const primaryItem = items.find((it) => it._id === primaryId);
  const primaryPending = primaryItem ? pendingOf(primaryItem) : 0;
  const enteredAmount = Math.max(0, Math.round(Number(form.amount) || 0));
  // Show the "link the excess" panel only when the amount is MORE than the
  // linked bill's pending — otherwise this is an ordinary single entry.
  const canSplit = allowSplit && !!primaryId && enteredAmount > primaryPending;
  const primaryAlloc = primaryId ? Math.min(enteredAmount, primaryPending) : enteredAmount;
  const sumExtras = extras.reduce((s, x) => s + Math.max(0, Math.round(Number(x.amount) || 0)), 0);
  const unused = Math.max(0, enteredAmount - primaryAlloc - sumExtras);
  const itemLabel = (it) => {
    if (linkType === 'invoice') {
      const num = it.invoiceNumber || `Draft-${(it._id || '').slice(0, 8)}`;
      const dstr = it.invoiceDate ? `${formatDate(it.invoiceDate)} - ` : '';
      const nm = invoiceDisplayName(it);
      return `${dstr}${num}${nm ? ` • ${nm}` : ''} — ₹${pendingOf(it).toLocaleString('en-IN')}`;
    }
    return `${it.category?.label || 'Expense'} — ₹${pendingOf(it).toLocaleString('en-IN')}`;
  };
  const usedIds = new Set([primaryId, ...extras.map((x) => x.id)].filter(Boolean));
  const rowOptions = (ownId) => items
    .filter((it) => pendingOf(it) > 0 && (it._id === ownId || !usedIds.has(it._id)))
    .map((it) => ({ value: it._id, label: itemLabel(it) }));
  const setExtra = (idx, patch) => setExtras((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const addExtra = () => setExtras((prev) => [...prev, { id: '', amount: '' }]);
  const removeExtra = (idx) => setExtras((prev) => prev.filter((_, i) => i !== idx));

  // ── Multi-link (allowMultiLink): link ONE payment to several bills. Each
  // becomes its own entry on save (see submit → allocations). Create-only. ──
  const isEditing = !!(initial && initial._id);
  const canMultiLink = allowMultiLink && !isEditing && (linkType === 'invoice' || linkType === 'expense') && !!primaryId;
  const multi = canMultiLink && extras.length > 0;
  const primaryAmt = Math.round(Number(primaryAmount) || 0);
  const multiTotal = primaryAmt + sumExtras;
  // First "+ Link another": seed the primary's own amount from its pending, then
  // open a second row.
  const openMulti = () => {
    if (primaryAmount === '') setPrimaryAmount(String(primaryPending || enteredAmount || ''));
    addExtra();
  };
  // Selecting a bill in an extra row auto-fills its amount from that bill's
  // pending (unless the operator already typed one).
  const selectExtra = (idx, v) => {
    const it = items.find((i) => i._id === v);
    const cur = extras[idx];
    const patch = { id: v || '' };
    if (v && (!cur.amount || Math.round(Number(cur.amount)) === 0)) patch.amount = it ? pendingOf(it) : '';
    setExtra(idx, patch);
  };
  const autoFillExtras = () => {
    let remaining = enteredAmount - primaryPending;
    const out = [];
    for (const it of items) {
      if (it._id === primaryId || remaining <= 0) continue;
      const p = pendingOf(it);
      if (p <= 0) continue;
      const give = Math.min(remaining, p);
      out.push({ id: it._id, amount: give });
      remaining -= give;
    }
    setExtras(out);
  };

  const submit = async (e) => {
    e.preventDefault();
    const activeExtras = (allowSplit || allowMultiLink) ? extras.filter((x) => x.id && Math.round(Number(x.amount)) > 0) : [];
    const total = multi ? multiTotal : enteredAmount;
    if (total <= 0) return;
    setSaving(true);
    try {
      const shared = {
        date: form.date,
        direction: form.direction,
        mode: form.mode,
        notes: form.notes,
        bankAccountId: (form.mode === 'bank' || form.mode === 'upi') ? (form.bankAccountId || null) : null,
        utrNumber: form.utrNumber,
        chequeNumber: form.chequeNumber,
      };
      if (multi) {
        // One entry per linked bill: the primary + every extra with an amount.
        const allocations = [
          { id: primaryId, amount: primaryAmt },
          ...activeExtras.map((x) => ({ id: x.id, amount: Math.round(Number(x.amount)) })),
        ]
          .filter((r) => r.id && r.amount > 0)
          .map((r) => ({
            invoiceId: linkType === 'invoice' ? r.id : null,
            expenseId: linkType === 'expense' ? r.id : null,
            amount: r.amount,
          }));
        if (!allocations.length) { setSaving(false); return; }
        await onSave({ ...shared, allocations });
      } else if (canSplit && activeExtras.length) {
        // One entry per linked bill: the primary (capped at its pending) + extras.
        const allocations = [
          { invoiceId: linkType === 'invoice' ? primaryId : null, expenseId: linkType === 'expense' ? primaryId : null, amount: primaryAlloc },
          ...activeExtras.map((x) => ({
            invoiceId: linkType === 'invoice' ? x.id : null,
            expenseId: linkType === 'expense' ? x.id : null,
            amount: Math.round(Number(x.amount)),
          })),
        ].filter((a) => a.amount > 0);
        await onSave({ ...shared, allocations });
      } else {
        await onSave({
          ...shared,
          amount: enteredAmount,
          invoiceId: form.link === 'invoice' ? (form.invoiceId || null) : null,
          expenseId: form.link === 'expense' ? (form.expenseId || null) : null,
        });
      }
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

  // The expense picker only lists expenses not yet paid by a cash/bank entry.
  // When editing an entry that's already linked to an expense, that expense is
  // absent from the list — merge it back in so the current selection stays
  // visible and selectable.
  const expenseLabel = (e) => `${e.category?.label || ''} • ₹${e.amount} • ${(e.date || '').slice(0, 10)}`;
  const expenseOptions = expenses.map((e) => ({ value: e._id, label: expenseLabel(e) }));
  if (initial?.expense && !expenseOptions.some((o) => o.value === initial.expense._id)) {
    expenseOptions.unshift({ value: initial.expense._id, label: expenseLabel(initial.expense) });
  }

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
          {lockDirection ? (
            <div className={`px-3 py-2 rounded-lg text-sm font-medium border text-center ${
              lockDirection === 'in' ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'
            }`}>
              {lockDirection === 'in' ? 'IN — Money received' : 'OUT — Money paid'}
            </div>
          ) : (
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
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
              <input type="date" required value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) *</label>
              {multi ? (
                <input type="number" readOnly value={multiTotal}
                  title="Sum of the linked bills"
                  className="w-full px-3 py-2 border border-gray-200 bg-gray-50 rounded-lg text-sm text-gray-700 cursor-not-allowed" />
              ) : (
                <input type="number" min="1" required value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              )}
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

          {(form.mode === 'bank' || form.mode === 'upi') && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account *</label>
              <SearchableSelect
                isLoading={loadingBankAccounts}
                value={form.bankAccountId}
                onChange={(v) => setForm((f) => ({ ...f, bankAccountId: v || '' }))}
                placeholder={bankAccounts.length ? 'Select bank account' : 'No bank accounts configured'}
                searchPlaceholder="Search bank accounts..."
                options={bankAccounts.map((b) => ({
                  value: b._id,
                  label: `${b.bankName}${b.accountNumber ? ` • A/C ${b.accountNumber.slice(-4).padStart(4, '·')}` : ''}${b.isDefault ? ' (Default)' : ''}`,
                }))}
              />
              {!bankAccounts.length && !loadingBankAccounts && (
                <p className="text-xs text-amber-700 mt-1">
                  Add an account in Settings → Bank Accounts before recording bank or UPI entries.
                </p>
              )}
            </div>
          )}

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
                  <SearchableSelect
                    isLoading={loadingInvoices}
                    value={form.invoiceId}
                    onChange={(v) => setForm((f) => ({ ...f, invoiceId: v }))}
                    placeholder="Select invoice"
                    searchPlaceholder="Search invoices..."
                    allowClear
                    options={invoices
                      // Only invoices with an outstanding balance are receivable.
                      // Fully-received ones are hidden — except the one this entry
                      // is already linked to, so edit mode keeps its selection.
                      .filter((i) => (i.amountPending || 0) > 0 || i._id === form.invoiceId)
                      .map((i) => {
                        const name = invoiceDisplayName(i);
                        const num = i.invoiceNumber || `Draft-${i._id.slice(0, 8)}`;
                        const dstr = i.invoiceDate ? `${formatDate(i.invoiceDate)} - ` : '';
                        const bal = `₹${Math.round(i.amountPending || 0).toLocaleString('en-IN')}`;
                        return { value: i._id, label: `${dstr}${num}${name ? ` • ${name}` : ''} — ${bal}` };
                      })}
                  />
                </>
              )}
              {form.link === 'expense' && (
                <>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Expense</label>
                  <SearchableSelect
                    isLoading={loadingExpenses}
                    value={form.expenseId}
                    onChange={(v) => setForm((f) => ({ ...f, expenseId: v }))}
                    placeholder="Select expense"
                    searchPlaceholder="Search expenses..."
                    allowClear
                    options={expenseOptions}
                  />
                </>
              )}
            </div>
          </div>

          {/* Appears only when the amount is MORE than the linked bill's pending:
              apply its pending to that bill and link the remaining to other bills. */}
          {canSplit && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-amber-800">
                  ₹{primaryPending.toLocaleString('en-IN')} applied here · link the remaining ₹{(enteredAmount - primaryPending).toLocaleString('en-IN')}
                </p>
                <button type="button" onClick={autoFillExtras}
                  className="text-xs font-semibold text-primary-700 border border-primary-300 rounded px-2 py-1 hover:bg-primary-50 shrink-0">
                  Auto link
                </button>
              </div>
              {extras.map((x, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      value={x.id}
                      onChange={(v) => setExtra(idx, { id: v || '' })}
                      placeholder={`Select ${linkType}`}
                      searchPlaceholder="Search…"
                      allowClear
                      options={rowOptions(x.id)}
                    />
                  </div>
                  <input type="number" min="0" value={x.amount}
                    onChange={(e) => setExtra(idx, { amount: e.target.value })}
                    placeholder="0"
                    className="w-28 px-2 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  <button type="button" onClick={() => removeExtra(idx)} className="p-1.5 text-gray-400 hover:text-red-600 shrink-0">
                    <HiOutlineX className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={addExtra} className="text-xs font-semibold text-primary-700 hover:text-primary-800">
                  + Link another {linkType}
                </button>
                <span className={`text-xs font-semibold ${unused > 0 ? 'text-amber-700' : 'text-green-700'}`}>
                  Unused ₹{unused.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          )}

          {/* Multi-link (new entries only): link ONE payment to several bills.
              Each becomes its own entry on save; Amount above = the sum. */}
          {canMultiLink && (extras.length === 0 ? (
            <button type="button" onClick={openMulti}
              className="text-xs font-semibold text-primary-700 hover:text-primary-800">
              + Link another {linkType}
            </button>
          ) : (
            <div className="rounded-lg border border-primary-200 bg-primary-50/60 p-3 space-y-2">
              <p className="text-xs font-medium text-primary-800">
                One payment linked to {1 + extras.length} {linkType === 'invoice' ? 'invoices' : 'expenses'} — saved as one entry each.
              </p>
              {/* Primary bill row */}
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 text-sm text-gray-700 truncate" title={primaryItem ? itemLabel(primaryItem) : ''}>
                  {primaryItem ? itemLabel(primaryItem) : '—'}
                </div>
                <input type="number" min="0" value={primaryAmount}
                  onChange={(e) => setPrimaryAmount(e.target.value)}
                  placeholder="0"
                  className="w-28 px-2 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                <span className="w-6 shrink-0" />
              </div>
              {/* Extra bills */}
              {extras.map((x, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      value={x.id}
                      onChange={(v) => selectExtra(idx, v)}
                      placeholder={`Select ${linkType}`}
                      searchPlaceholder="Search…"
                      allowClear
                      options={rowOptions(x.id)}
                    />
                  </div>
                  <input type="number" min="0" value={x.amount}
                    onChange={(e) => setExtra(idx, { amount: e.target.value })}
                    placeholder="0"
                    className="w-28 px-2 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  <button type="button" onClick={() => removeExtra(idx)} className="p-1.5 text-gray-400 hover:text-red-600 shrink-0">
                    <HiOutlineX className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button type="button" onClick={addExtra} className="text-xs font-semibold text-primary-700 hover:text-primary-800">
                  + Link another {linkType}
                </button>
                <span className="text-xs font-semibold text-gray-700">
                  Total ₹{multiTotal.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          ))}

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
            <button type="submit" disabled={saving || (multi ? multiTotal <= 0 : Number(form.amount) <= 0)}
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
