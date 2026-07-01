import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX, HiOutlineCash } from 'react-icons/hi';
import { toast } from 'react-toastify';
import { bulkReceivePaymentAPI } from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatMonth = (d) => {
  if (!d) return '-';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};

// Per-invoice "own" pending — excludes the previousBalance that gets baked
// into amountPending at issue time. Using amountPending here would double-
// count older invoices once the operator selects them together (the older
// invoice's pending sits both in its own row AND inside the newer invoice's
// previousBalance carry-forward).
const ownPending = (inv) => {
  if (!inv) return 0;
  const netTotal = inv.netTotal != null
    ? Number(inv.netTotal)
    : (Number(inv.grandTotal || 0) - Number(inv.previousBalance || 0));
  const paid = Number(inv.amountPaid || 0);
  return Math.max(0, Math.round(netTotal - paid));
};

// Receives one payment from a hospital and splits it across several of that
// hospital's invoices. Each invoice gets its own cash/bank entry on the
// backend so paid-status rollup stays per-invoice.
const BulkReceivePaymentModal = ({ open, invoices, bankAccounts, onClose, onSaved }) => {
  const hospital = invoices[0]?.hospital || null;
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [utrNumber, setUtrNumber] = useState('');
  const [chequeNumber, setChequeNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState([]);
  const [saving, setSaving] = useState(false);

  // Reset state every time the modal reopens with a fresh selection. Default
  // allocation = invoice's pending amount (typical case is paying in full).
  useEffect(() => {
    if (!open) return;
    setDate(new Date().toISOString().slice(0, 10));
    setMode('cash');
    setBankAccountId('');
    setUtrNumber('');
    setChequeNumber('');
    setNotes('');
    setAllocations(
      invoices.map((inv) => ({
        invoiceId: inv._id,
        invoice: inv,
        amount: ownPending(inv),
      })),
    );
  }, [open, invoices]);

  // Default to the flagged-default bank account when switching to bank/upi
  // so the operator doesn't have to pick it every time.
  useEffect(() => {
    if (mode === 'bank' || mode === 'upi') {
      if (!bankAccountId) {
        const def = bankAccounts.find((b) => b.isDefault) || bankAccounts[0];
        if (def) setBankAccountId(def._id);
      }
    } else {
      setBankAccountId('');
    }
  }, [mode, bankAccounts, bankAccountId]);

  const totalSelected = useMemo(
    () => allocations.reduce((s, a) => s + (Number(a.amount) || 0), 0),
    [allocations],
  );
  const totalPending = useMemo(
    () => invoices.reduce((s, inv) => s + ownPending(inv), 0),
    [invoices],
  );

  const updateAlloc = (invoiceId, amount) => {
    setAllocations((prev) => prev.map((a) => (a.invoiceId === invoiceId ? { ...a, amount } : a)));
  };

  // Spread a single amount across selected invoices in order (oldest first).
  // Useful when the operator received a round sum and wants the system to
  // fill each invoice in turn.
  const [spreadAmount, setSpreadAmount] = useState('');
  const applySpread = () => {
    let remaining = Math.max(0, Math.round(Number(spreadAmount) || 0));
    if (remaining <= 0) {
      toast.error('Enter an amount to distribute');
      return;
    }
    const sorted = [...allocations].sort((a, b) => new Date(a.invoice.month) - new Date(b.invoice.month));
    const map = new Map();
    for (const a of sorted) {
      const pending = ownPending(a.invoice);
      const give = Math.min(remaining, pending);
      map.set(a.invoiceId, give);
      remaining -= give;
      if (remaining <= 0) break;
    }
    setAllocations((prev) => prev.map((a) => ({ ...a, amount: map.get(a.invoiceId) ?? 0 })));
    setSpreadAmount('');
  };

  const save = async () => {
    const positiveAllocs = allocations.filter((a) => Number(a.amount) > 0);
    if (!positiveAllocs.length) {
      toast.error('Enter at least one allocation amount');
      return;
    }
    for (const a of positiveAllocs) {
      const pending = ownPending(a.invoice);
      if (Number(a.amount) > pending) {
        toast.error(`Allocation for ${a.invoice.invoiceNumber || 'invoice'} exceeds its pending amount`);
        return;
      }
    }
    setSaving(true);
    try {
      await bulkReceivePaymentAPI({
        hospitalId: hospital?._id,
        date,
        mode,
        bankAccountId: (mode === 'bank' || mode === 'upi') ? bankAccountId : undefined,
        utrNumber,
        chequeNumber,
        notes,
        allocations: positiveAllocs.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) })),
      });
      toast.success(`Payment recorded against ${positiveAllocs.length} invoice${positiveAllocs.length === 1 ? '' : 's'}`);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <HiOutlineCash className="w-5 h-5 text-primary-600" /> Receive Payment
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {hospital?.name || '-'} · {invoices.length} invoice{invoices.length === 1 ? '' : 's'} · Pending {formatINR(totalPending)}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
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
                  { value: 'upi',  label: 'UPI' },
                ]}
              />
            </div>
            {showBank && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Bank Account</label>
                <SearchableSelect
                  value={bankAccountId}
                  onChange={(v) => setBankAccountId(v || '')}
                  placeholder="Select account"
                  options={bankAccounts.map((b) => ({
                    value: b._id,
                    label: `${b.bankName}${b.accountNumber ? ' · ' + b.accountNumber.slice(-4).padStart(b.accountNumber.length, '•') : ''}${b.isDefault ? ' (default)' : ''}`,
                  }))}
                  allowClear
                />
              </div>
            )}
            {mode === 'bank' && (
              <div className="md:col-span-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">UTR / Ref No.</label>
                <input type="text" value={utrNumber} onChange={(e) => setUtrNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            )}
            {mode === 'cash' && (
              <div className="md:col-span-1">
                <label className="block text-xs font-medium text-gray-500 mb-1">Cheque No. (optional)</label>
                <input type="text" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            )}
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Allocations</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  placeholder="Distribute amount…"
                  value={spreadAmount}
                  onChange={(e) => setSpreadAmount(e.target.value)}
                  className="w-40 px-2 py-1 text-xs border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <button type="button" onClick={applySpread}
                  className="text-xs font-semibold text-primary-600 hover:text-primary-700 px-2 py-1 rounded hover:bg-primary-50">
                  Auto-distribute
                </button>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-white border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Invoice</th>
                  <th className="text-left py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Month</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Pending</th>
                  <th className="text-right py-2 px-3 text-[11px] font-semibold text-gray-500 uppercase">Allocate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {allocations.map((a) => {
                  const pending = ownPending(a.invoice);
                  return (
                    <tr key={a.invoiceId}>
                      <td className="py-2 px-3 text-gray-800 font-medium">
                        {a.invoice.invoiceNumber || 'Draft'}
                      </td>
                      <td className="py-2 px-3 text-gray-600">{formatMonth(a.invoice.month)}</td>
                      <td className="py-2 px-3 text-right text-gray-600">{formatINR(pending)}</td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          min="0"
                          max={pending}
                          value={a.amount}
                          onChange={(e) => updateAlloc(a.invoiceId, e.target.value)}
                          className="w-32 px-2 py-1 text-right border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-primary-50">
                <tr>
                  <td colSpan={2} className="py-2 px-3 text-xs font-semibold text-primary-700 uppercase tracking-wider">
                    Total
                  </td>
                  <td className="py-2 px-3 text-right text-gray-700 font-medium">{formatINR(totalPending)}</td>
                  <td className="py-2 px-3 text-right text-primary-700 font-bold">{formatINR(totalSelected)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

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
          <button onClick={save} disabled={saving || totalSelected <= 0}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50 shadow-sm">
            {saving ? 'Saving...' : `Receive ${formatINR(totalSelected)}`}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkReceivePaymentModal;
