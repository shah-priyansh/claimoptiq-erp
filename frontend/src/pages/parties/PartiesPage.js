import React, { useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineSearch, HiOutlineUserGroup, HiOutlineX, HiOutlineSwitchHorizontal, HiOutlineCash, HiOutlineDownload } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import SearchableSelect from '../../components/ui/SearchableSelect';
import PartyPaymentAllocateModal from './PartyPaymentAllocateModal';
import {
  getPartiesAPI, getPartyLedgerAPI, createPartyAPI, updatePartyAPI, mergePartyAPI,
  getBankAccountsAPI,
} from '../../services/api';
import { formatDateTime } from '../../utils/format';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const TYPE_LABELS = {
  invoice: 'Invoice', expense: 'Expense', payment_in: 'Payment-In', payment_out: 'Payment-Out',
};

// Status badge styling across invoice + expense + payment rows.
const STATUS = {
  issued:         { label: 'Pending',      cls: 'bg-blue-50 text-blue-700' },
  partially_paid: { label: 'Partial',      cls: 'bg-amber-50 text-amber-700' },
  paid:           { label: 'Paid',         cls: 'bg-green-50 text-green-700' },
  partial:        { label: 'Part Payment', cls: 'bg-amber-50 text-amber-700' },
  pending:        { label: 'Pending',      cls: 'bg-gray-100 text-gray-600' },
  draft:          { label: 'Draft',        cls: 'bg-gray-100 text-gray-600' },
  void:           { label: 'Void',         cls: 'bg-red-50 text-red-700' },
  used:           { label: 'Used',         cls: 'bg-green-50 text-green-700' },
};

const GST_TYPES = [
  { value: 'unregistered', label: 'Unregistered / Consumer' },
  { value: 'registered',   label: 'Registered Business' },
  { value: 'composition',  label: 'Composition' },
];

const emptyParty = {
  name: '', phone: '', gstin: '', email: '', partyGroup: '',
  gstType: 'unregistered', state: '', billingAddress: '', shippingAddress: '',
  openingBalance: '', openingType: 'to_collect',
};

const PartyFormModal = ({ open, initial, onClose, onSaved }) => {
  const [form, setForm] = useState(emptyParty);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(initial ? {
      name: initial.name || '', phone: initial.phone || '', gstin: initial.gstin || '',
      email: initial.email || '', partyGroup: initial.partyGroup || '',
      gstType: initial.gstType || 'unregistered', state: initial.state || '',
      billingAddress: initial.billingAddress || '', shippingAddress: initial.shippingAddress || '',
      openingBalance: initial.openingBalance || '', openingType: initial.openingType || 'to_collect',
    } : emptyParty);
  }, [open, initial]);
  if (!open) return null;

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Party name is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, openingBalance: Number(form.openingBalance) || 0 };
      const { data } = initial ? await updatePartyAPI(initial._id, payload) : await createPartyAPI(payload);
      toast.success(initial ? 'Party updated' : 'Party added');
      onSaved(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save party');
    } finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const label = 'block text-xs font-medium text-gray-500 mb-1';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Party' : 'Add Party'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className={label}>Party Name *</label><input value={form.name} onChange={(e) => set('name', e.target.value)} className={input} /></div>
            <div><label className={label}>GSTIN</label><input value={form.gstin} onChange={(e) => set('gstin', e.target.value.toUpperCase())} className={input} /></div>
            <div><label className={label}>Phone Number</label><input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={input} /></div>
            <div><label className={label}>Party Group</label><input value={form.partyGroup} onChange={(e) => set('partyGroup', e.target.value)} placeholder="e.g. Hospital, Vendor" className={input} /></div>
            <div>
              <label className={label}>GST Type</label>
              <select value={form.gstType} onChange={(e) => set('gstType', e.target.value)} className={input}>
                {GST_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div><label className={label}>State</label><input value={form.state} onChange={(e) => set('state', e.target.value)} className={input} /></div>
            <div className="md:col-span-3"><label className={label}>Email ID</label><input value={form.email} onChange={(e) => set('email', e.target.value)} className={input} /></div>
            <div className="md:col-span-3"><label className={label}>Billing Address</label><textarea rows={2} value={form.billingAddress} onChange={(e) => set('billingAddress', e.target.value)} className={`${input} resize-y`} /></div>
            <div className="md:col-span-3"><label className={label}>Shipping Address</label><textarea rows={2} value={form.shippingAddress} onChange={(e) => set('shippingAddress', e.target.value)} className={`${input} resize-y`} /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-gray-100">
            <div><label className={label}>Opening Balance</label><input type="number" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0" className={input} /></div>
            <div>
              <label className={label}>Balance Type</label>
              <select value={form.openingType} onChange={(e) => set('openingType', e.target.value)} className={input}>
                <option value="to_collect">To Collect (they owe us)</option>
                <option value="to_pay">To Pay (we owe them)</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Merge the current (duplicate) party into another. All its transactions move
// to the chosen target, then it's deleted.
const MergeModal = ({ open, source, parties, onClose, onMerged }) => {
  const confirm = useConfirm();
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setTargetId(''); }, [open]);
  if (!open || !source) return null;

  const submit = async () => {
    if (!targetId) { toast.error('Pick a party to merge into'); return; }
    const target = parties.find((p) => p._id === targetId);
    if (!await confirm(`Move all of "${source.name}"'s transactions into "${target?.name}" and delete "${source.name}"? This cannot be undone.`, { title: 'Merge Party', confirmLabel: 'Merge' })) return;
    setBusy(true);
    try {
      const { data } = await mergePartyAPI(source._id, { into: targetId });
      toast.success('Parties merged');
      onMerged(data?._id || targetId);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to merge');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">Merge Party</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">Merge <span className="font-semibold">{source.name}</span> into:</p>
          <SearchableSelect
            value={targetId}
            onChange={setTargetId}
            placeholder="Select target party"
            searchPlaceholder="Search parties..."
            options={parties.filter((p) => p._id !== source._id).map((p) => ({ value: p._id, label: p.name }))}
          />
          <p className="text-xs text-gray-400">All invoices and expenses of "{source.name}" move to the target, then "{source.name}" is deleted.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="button" onClick={submit} disabled={busy || !targetId}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {busy ? 'Merging...' : 'Merge'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const balanceLabel = (bal) => (bal > 0 ? 'To collect' : bal < 0 ? 'To pay' : 'Settled');
const balanceCls = (bal) => (bal > 0 ? 'text-green-600' : bal < 0 ? 'text-red-600' : 'text-gray-500');

const PartiesPage = () => {
  const { can } = useAuth();
  const canCreate = can('parties', 'create');
  const canEdit = can('parties', 'edit');
  // Recording a payment writes a cash/bank entry, so it needs that permission.
  const canRecordPayment = can('cash_bank', 'create');

  const [parties, setParties] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [ledger, setLedger] = useState(null);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [ledgerNonce, setLedgerNonce] = useState(0);
  const [modal, setModal] = useState({ open: false, initial: null });
  const [mergeOpen, setMergeOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(false);
  // 'in' (allocate across open invoices) | 'out' (across open expenses) | null.
  const [allocDirection, setAllocDirection] = useState(null);
  // When opened from a specific row, that invoice/expense is pre-filled + linked.
  const [allocFocusRefId, setAllocFocusRefId] = useState(null);

  const selected = parties.find((p) => p._id === selectedId) || null;

  const loadParties = async (selectId) => {
    try {
      const { data } = await getPartiesAPI();
      setParties(data || []);
      setSelectedId((cur) => selectId || cur || (data?.[0]?._id ?? null));
    } catch {
      toast.error('Failed to load parties');
    }
  };

  useEffect(() => { loadParties(); }, []);

  // Bank accounts feed the reused payment modal (bank/UPI mode picker).
  useEffect(() => {
    if (!canRecordPayment) return;
    setLoadingBankAccounts(true);
    getBankAccountsAPI()
      .then(({ data }) => setBankAccounts(data || []))
      .catch(() => {})
      .finally(() => setLoadingBankAccounts(false));
  }, [canRecordPayment]);

  useEffect(() => {
    if (!selectedId) { setLedger(null); return; }
    let cancelled = false;
    setLoadingLedger(true);
    getPartyLedgerAPI(selectedId)
      .then(({ data }) => { if (!cancelled) setLedger(data); })
      .catch(() => { if (!cancelled) toast.error('Failed to load party ledger'); })
      .finally(() => { if (!cancelled) setLoadingLedger(false); });
    return () => { cancelled = true; };
  }, [selectedId, ledgerNonce]);

  const exportLedger = () => {
    if (!selected) return;
    const rows = (ledger?.transactions || []);
    if (!rows.length) { toast.info('No transactions to export'); return; }
    const dateOnly = (d) => (d ? formatDateTime(d).split(',')[0] : '');
    const data = rows.map((t) => ({
      Type: TYPE_LABELS[t.type] || t.type,
      Number: t.number || '',
      Date: dateOnly(t.date),
      Total: t.total,
      Balance: t.balance,
      'Due Date': dateOnly(t.dueDate),
      Status: STATUS[t.status]?.label || t.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
    const safe = (selected.name || 'party').replace(/[^a-z0-9]+/gi, '_').slice(0, 40);
    XLSX.writeFile(wb, `Party_${safe}_ledger.xlsx`);
  };

  const visible = useMemo(() => {
    if (!search.trim()) return parties;
    const q = search.trim().toLowerCase();
    return parties.filter((p) => (p.name || '').toLowerCase().includes(q) || String(p.balance ?? '').includes(q));
  }, [parties, search]);

  const onSaved = (saved) => {
    setModal({ open: false, initial: null });
    loadParties(saved?._id);
  };

  const txns = ledger?.transactions || [];
  const openInvoices = txns.filter((t) => t.type === 'invoice' && t.balance > 0);
  const openExpenses = txns.filter((t) => t.type === 'expense' && t.balance > 0);
  const afterPayment = () => { setLedgerNonce((n) => n + 1); loadParties(selectedId); };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Parties</h1>
        {canCreate && (
          <button onClick={() => setModal({ open: true, initial: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Party
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: party list */}
        <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)]">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by party / amount"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <div className="divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto">
            {visible.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">No parties</div>
            ) : visible.map((p) => (
              <button key={p._id} onClick={() => setSelectedId(p._id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
                  selectedId === p._id ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                }`}>
                <span className="text-sm font-medium text-gray-800 truncate">{p.name}</span>
                <span className={`text-sm font-semibold whitespace-nowrap ${balanceCls(p.balance || 0)}`}>{formatINR(Math.abs(p.balance || 0))}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Right: party detail + ledger */}
        <div className="col-span-12 md:col-span-8 lg:col-span-9 space-y-4">
          {!selected ? (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
              <HiOutlineUserGroup className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              Select a party to see its transactions.
            </div>
          ) : (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-800 truncate">{selected.name}</h2>
                      {canEdit && (
                        <button onClick={() => setModal({ open: true, initial: selected })} title="Edit party"
                          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      )}
                      {canEdit && parties.length > 1 && (
                        <button onClick={() => setMergeOpen(true)} title="Merge into another party"
                          className="p-1 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded">
                          <HiOutlineSwitchHorizontal className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-sm text-gray-500">
                      {selected.phone && <span>{selected.phone}</span>}
                      {selected.billingAddress && <span className="truncate max-w-md">{selected.billingAddress}</span>}
                      {selected.gstin && <span>GSTIN {selected.gstin}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <button onClick={exportLedger} disabled={!txns.length} title="Export ledger to Excel"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-primary-300 text-primary-700 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed">
                      <HiOutlineDownload className="w-4 h-4" /> Export
                    </button>
                    <div className="text-right">
                      <p className="text-xs uppercase tracking-wide text-gray-400">{balanceLabel(ledger?.balance ?? selected.balance ?? 0)}</p>
                      <p className={`text-lg font-semibold ${balanceCls(ledger?.balance ?? selected.balance ?? 0)}`}>
                        {formatINR(Math.abs(ledger?.balance ?? selected.balance ?? 0))}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-gray-700">Transactions</h3>
                  {canRecordPayment && (openInvoices.length > 0 || openExpenses.length > 0) && (
                    <div className="flex items-center gap-2">
                      {openInvoices.length > 0 && (
                        <button onClick={() => { setAllocFocusRefId(null); setAllocDirection('in'); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-green-300 text-green-700 hover:bg-green-50">
                          <HiOutlineCash className="w-4 h-4" /> Receive Payment
                        </button>
                      )}
                      {openExpenses.length > 0 && (
                        <button onClick={() => { setAllocFocusRefId(null); setAllocDirection('out'); }}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-300 text-red-700 hover:bg-red-50">
                          <HiOutlineCash className="w-4 h-4" /> Make Payment
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {loadingLedger ? (
                  <Loader label="Loading…" className="py-8" />
                ) : txns.length === 0 ? (
                  <div className="py-8 text-center text-gray-400">No transactions for this party</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Number</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Total</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Due Date</th>
                          <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                          {canRecordPayment && <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Action</th>}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {txns.map((t, i) => {
                          const st = STATUS[t.status] || { label: t.status, cls: 'bg-gray-100 text-gray-600' };
                          const isIn = t.type === 'invoice' || t.type === 'payment_in';
                          return (
                            <tr key={i} className="hover:bg-gray-50">
                              <td className="py-3 px-4">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded ${isIn ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                  {TYPE_LABELS[t.type] || t.type}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-gray-600">{t.number || <span className="text-gray-300">—</span>}</td>
                              <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDateTime(t.date)}</td>
                              <td className="py-3 px-4 text-right font-medium text-gray-800">{formatINR(t.total)}</td>
                              <td className={`py-3 px-4 text-right ${t.balance > 0 ? 'text-gray-800 font-medium' : 'text-gray-400'}`}>{formatINR(t.balance)}</td>
                              <td className="py-3 px-4 text-gray-500 whitespace-nowrap">{t.dueDate ? formatDateTime(t.dueDate).split(',')[0] : <span className="text-gray-300">—</span>}</td>
                              <td className="py-3 px-4 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                              </td>
                              {canRecordPayment && (
                                <td className="py-3 px-4 text-right whitespace-nowrap">
                                  {(t.type === 'invoice' || t.type === 'expense') && t.balance > 0 ? (
                                    <button
                                      onClick={() => { setAllocFocusRefId(t.refId); setAllocDirection(t.type === 'invoice' ? 'in' : 'out'); }}
                                      className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border ${isIn ? 'border-green-300 text-green-700 hover:bg-green-50' : 'border-red-300 text-red-700 hover:bg-red-50'}`}
                                    >
                                      <HiOutlineCash className="w-3.5 h-3.5" />
                                      {t.type === 'invoice' ? 'Receive' : 'Pay'}
                                    </button>
                                  ) : (
                                    <span className="text-gray-300">—</span>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <PartyFormModal
        open={modal.open}
        initial={modal.initial}
        onClose={() => setModal({ open: false, initial: null })}
        onSaved={onSaved}
      />

      <MergeModal
        open={mergeOpen}
        source={selected}
        parties={parties}
        onClose={() => setMergeOpen(false)}
        onMerged={(targetId) => { setMergeOpen(false); loadParties(targetId); }}
      />

      {/* Allocate one payment across multiple open invoices / expenses of the party. */}
      <PartyPaymentAllocateModal
        open={!!allocDirection}
        partyId={selectedId}
        partyName={selected?.name}
        direction={allocDirection || 'in'}
        rows={allocDirection === 'out' ? openExpenses : openInvoices}
        focusRefId={allocFocusRefId}
        bankAccounts={bankAccounts}
        loadingBankAccounts={loadingBankAccounts}
        onClose={() => { setAllocDirection(null); setAllocFocusRefId(null); }}
        onSaved={afterPayment}
      />
    </div>
  );
};

export default PartiesPage;
