import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX, HiOutlineCash, HiOutlineLink, HiChevronRight } from 'react-icons/hi';
import { toast } from 'react-toastify';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { allocatePartyPaymentAPI } from '../../services/api';
import { formatDateTime } from '../../utils/format';

const formatINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateOnly = (d) => (d ? formatDateTime(d).split(',')[0] : '-');

// Two-step, Vyapar-style flow:
//   1. Payment entry (date / mode / amount) + a "Link Payment" button showing the
//      unused amount.
//   2. Clicking it opens a SEPARATE "Link Payment to Txns" modal to allocate the
//      amount across the party's open invoices ('in') / expenses ('out').
const PartyPaymentAllocateModal = ({ open, partyId, partyName, direction, rows = [], focusRefId = null, bankAccounts = [], loadingBankAccounts = false, onClose, onSaved }) => {
  const isIn = direction === 'in';
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [lump, setLump] = useState('');
  const [allocations, setAllocations] = useState([]);
  const [linking, setLinking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().slice(0, 10));
    setMode('cash'); setBankAccountId(''); setUtrNumber(''); setChequeNumber(''); setNotes('');
    setLinking(false);
    // Opened from a specific row → pre-fill the amount with that item's balance
    // and auto-link it, so the common "pay this one bill in full" case is one click.
    const focus = focusRefId ? rows.find((r) => r.refId === focusRefId) : null;
    const focusBal = focus ? Math.max(0, Math.round(focus.balance || 0)) : 0;
    setLump(focus ? String(focusBal) : '');
    setAllocations(rows.map((r) => ({
      refId: r.refId,
      row: r,
      amount: (focus && r.refId === focusRefId) ? focusBal : 0,
    })));
  }, [open, rows, focusRefId]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'bank' || mode === 'upi') {
      if (!bankAccountId) {
        const def = bankAccounts.find((b) => b.isDefault) || bankAccounts[0];
        if (def) setBankAccountId(def._id);
      }
    } else {
      setBankAccountId('');
    }
  }, [mode, bankAccounts, bankAccountId, open]);

  const totalPending = useMemo(() => rows.reduce((s, r) => s + Math.max(0, Math.round(r.balance || 0)), 0), [rows]);
  const totalAllocated = useMemo(() => allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0), [allocations]);
  const linkedCount = allocations.filter((a) => Number(a.amount) > 0).length;
  const unused = Math.round((Number(lump) || 0) - totalAllocated);

  const updateAlloc = (refId, amount) => setAllocations((prev) => prev.map((a) => (a.refId === refId ? { ...a, amount } : a)));

  // Spread the entered amount across rows, oldest first, up to each balance.
  const autoLink = () => {
    let remaining = Math.round(Number(lump) || 0);
    if (remaining <= 0) { toast.error(`Enter the amount ${isIn ? 'received' : 'paid'} first`); return; }
    const sorted = [...allocations].sort((a, b) => new Date(a.row.date) - new Date(b.row.date));
    const map = new Map();
    for (const a of sorted) {
      const pending = Math.max(0, Math.round(a.row.balance || 0));
      const give = Math.max(0, Math.min(remaining, pending));
      map.set(a.refId, give);
      remaining -= give;
      if (remaining <= 0) break;
    }
    setAllocations((prev) => prev.map((a) => ({ ...a, amount: map.get(a.refId) ?? 0 })));
  };

  const save = async () => {
    const positive = allocations.filter((a) => Number(a.amount) > 0);
    if (!positive.length) { toast.error('Link the payment to at least one transaction'); return; }
    for (const a of positive) {
      if (Number(a.amount) > Math.round(a.row.balance || 0)) {
        toast.error(`Allocation for ${a.row.number || a.row.name} exceeds its balance`);
        return;
      }
    }
    setSaving(true);
    try {
      await allocatePartyPaymentAPI({
        partyId,
        direction,
        date,
        mode,
        bankAccountId: (mode === 'bank' || mode === 'upi') ? bankAccountId : undefined,
        utrNumber,
        chequeNumber,
        notes,
        allocations: positive.map((a) => ({ refId: a.refId, amount: Number(a.amount) })),
      });
      toast.success(`Payment recorded against ${positive.length} ${isIn ? 'invoice' : 'expense'}${positive.length === 1 ? '' : 's'}`);
      onSaved?.();
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to record payment');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;
  const showBank = mode === 'bank' || mode === 'upi';

  return (
    <>
      {/* ── Step 1: payment entry ── */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
          <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <HiOutlineCash className={`w-5 h-5 ${isIn ? 'text-green-600' : 'text-red-600'}`} />
                {isIn ? 'Receive Payment' : 'Make Payment'}
              </h3>
              <p className="text-xs text-gray-500 mt-1">
                {partyName || '-'} · {rows.length} open {isIn ? 'invoice' : 'expense'}{rows.length === 1 ? '' : 's'} · Balance {formatINR(totalPending)}
              </p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <HiOutlineX className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">{isIn ? 'Amount received' : 'Amount paid'}</label>
                <input type="number" min="0" value={lump} onChange={(e) => setLump(e.target.value)} placeholder="0"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mode</label>
                <SearchableSelect
                  value={mode}
                  onChange={(v) => setMode(v || 'cash')}
                  options={[
                    { value: 'cash', label: 'Cash' },
                    { value: 'bank', label: 'Bank' },
                    { value: 'upi', label: 'UPI' },
                  ]}
                />
              </div>
              {showBank && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Bank Account</label>
                  <SearchableSelect
                    value={bankAccountId}
                    onChange={(v) => setBankAccountId(v || '')}
                    placeholder={loadingBankAccounts ? 'Loading…' : 'Select account'}
                    options={bankAccounts.map((b) => ({
                      value: b._id,
                      label: `${b.bankName}${b.accountNumber ? ' · ' + b.accountNumber.slice(-4).padStart(b.accountNumber.length, '•') : ''}${b.isDefault ? ' (default)' : ''}`,
                    }))}
                    allowClear
                  />
                </div>
              )}
              {mode === 'bank' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">UTR / Ref No.</label>
                  <input type="text" value={utrNumber} onChange={(e) => setUtrNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                </div>
              )}
              {mode === 'cash' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Cheque No. (optional)</label>
                  <input type="text" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                </div>
              )}
            </div>

            {/* The allocation prompt only appears when the entered amount is MORE than
                what's linked (an unused excess to distribute). When it matches, we
                show only a quiet "linked" confirmation with an Edit link. */}
            {unused > 0 ? (
              <button
                type="button"
                onClick={() => setLinking(true)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors text-left"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">
                  <HiOutlineLink className="w-4 h-4" />
                  {linkedCount > 0 ? `Link the remaining ${formatINR(unused)}` : `Link this payment to ${isIn ? 'invoices' : 'expenses'}`}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-right">
                    <span className="block text-[10px] uppercase tracking-wide text-gray-400 leading-none">Unused</span>
                    <span className="block text-sm font-bold tabular-nums leading-tight text-amber-700">{formatINR(unused)}</span>
                  </span>
                  <HiChevronRight className="w-4 h-4 text-gray-400" />
                </span>
              </button>
            ) : linkedCount > 0 ? (
              <button
                type="button"
                onClick={() => setLinking(true)}
                className="w-full flex items-center justify-between gap-2 px-1 text-xs text-gray-500 hover:text-gray-700"
              >
                <span className="inline-flex items-center gap-1.5">
                  <HiOutlineLink className="w-3.5 h-3.5 text-green-600" />
                  Linked to {linkedCount} of {rows.length} · <span className="font-semibold text-gray-700">{formatINR(totalAllocated)}</span>
                </span>
                <span className="text-primary-600 font-medium">Edit</span>
              </button>
            ) : null}

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Notes (optional)</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
            <button onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium disabled:opacity-60">
              Cancel
            </button>
            <button onClick={save} disabled={saving || totalAllocated <= 0}
              className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50 shadow-sm">
              {saving ? 'Saving…' : `${isIn ? 'Receive' : 'Pay'} ${formatINR(totalAllocated)}`}
            </button>
          </div>
        </div>
      </div>

      {/* ── Step 2: separate "Link Payment to Txns" modal ── */}
      {linking && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-gray-900">Link Payment to Txns</h3>
                <p className="text-xs text-gray-500 mt-1">{partyName || '-'} · {isIn ? 'Received' : 'Paid'} {formatINR(Number(lump) || 0)}</p>
              </div>
              <button onClick={() => setLinking(false)} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
                <HiOutlineX className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-gray-100 bg-gray-50">
              <button type="button" onClick={autoLink}
                className="px-3 py-1.5 text-sm font-semibold rounded-lg border border-primary-300 text-primary-700 hover:bg-primary-50">
                Auto link
              </button>
              <div className="text-right">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">Unused</span>
                <span className={`ml-2 text-sm font-bold tabular-nums ${unused < 0 ? 'text-red-600' : 'text-gray-700'}`}>{formatINR(unused)}</span>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              <table className="w-full text-sm">
                <thead className="bg-white border-b border-gray-100 sticky top-0">
                  <tr>
                    <th className="text-left py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase">{isIn ? 'Invoice' : 'Expense'}</th>
                    <th className="text-right py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase">Balance</th>
                    <th className="text-right py-2 px-4 text-[11px] font-semibold text-gray-500 uppercase">Allocate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {allocations.map((a) => {
                    const pending = Math.max(0, Math.round(a.row.balance || 0));
                    return (
                      <tr key={a.refId}>
                        <td className="py-2 px-4 text-gray-600 whitespace-nowrap">{dateOnly(a.row.date)}</td>
                        <td className="py-2 px-4 text-gray-800 font-medium truncate max-w-[220px]">{a.row.number || a.row.name || '—'}</td>
                        <td className="py-2 px-4 text-right text-gray-600">{formatINR(pending)}</td>
                        <td className="py-2 px-4 text-right">
                          <input type="number" min="0" max={pending} value={a.amount}
                            onChange={(e) => updateAlloc(a.refId, e.target.value)}
                            className="w-32 px-2 py-1 text-right border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <span className="text-sm text-gray-500">Linked <span className="font-semibold text-gray-800">{formatINR(totalAllocated)}</span></span>
              <button onClick={() => setLinking(false)}
                className="px-5 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-sm">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PartyPaymentAllocateModal;
