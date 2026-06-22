import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlinePlus, HiOutlineTrash,
  HiOutlinePrinter, HiOutlineBan, HiOutlineCheck, HiOutlineSave,
  HiOutlineCheckCircle, HiOutlineExclamationCircle,
  HiChevronRight, HiChevronDown,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getInvoiceAPI, updateInvoiceAPI, issueInvoiceAPI, voidInvoiceAPI, deleteInvoiceAPI, openInvoicePdf,
  getTdsRatesAPI, getCashBankAPI, recordInvoicePaymentAPI, deleteCashBankAPI, createCashBankAPI,
  getBankAccountsAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import CashBankFormModal from '../cashbank/CashBankFormModal';
import { formatDate as _formatDate } from '../../utils/format';

const STATUS_COLORS = {
  draft:          'bg-gray-100 text-gray-700',
  issued:         'bg-blue-50 text-blue-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid:           'bg-green-50 text-green-700',
  void:           'bg-red-50 text-red-700',
};

const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk',
  service_fixed: 'Fixed',
  service_percentage: 'Variable',
  adjustment: 'Adjustment',
  manual: 'Manual',
};

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatMonth = (d) => d ? new Date(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '-';
const formatDate = (d) => _formatDate(d);

// 'TPA Desk — RAJESH PATEL (CCN-0001)' → 'TPA Desk'. Used to collapse rows
// from the same billing service into a single expandable group header.
const baseServiceName = (desc) => {
  if (!desc) return 'Other';
  return (String(desc).split(/\s+[—-]\s+/)[0] || desc).trim();
};

const InvoiceDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { can } = useAuth();
  const canEdit = can('invoices', 'edit');
  const canDelete = can('invoices', 'delete');

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [adjustments, setAdjustments] = useState([]);
  const [editLines, setEditLines] = useState([]);
  const [originalLines, setOriginalLines] = useState([]);
  const [roundOff, setRoundOff] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [tdsRateId, setTdsRateId] = useState('');
  const [gstRate, setGstRate] = useState(0);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [payments, setPayments] = useState([]);
  const [payForm, setPayForm] = useState({ date: new Date().toISOString().slice(0,10), mode: 'cash', amount: 0, utrNumber: '', chequeNumber: '', notes: '' });
  const [payingNow, setPayingNow] = useState(false);
  // Controls the "Mark as Paid" Cash/Bank entry modal — opens pre-linked to
  // this invoice so the operator just confirms the mode/amount.
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);

  useEffect(() => {
    getBankAccountsAPI({ active: 'true' })
      .then(({ data }) => setBankAccounts(data || []))
      .catch(() => setBankAccounts([]))
      .finally(() => setLoadingBankAccounts(false));
  }, []);
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) => setExpandedGroups((s) => {
    const next = new Set(s);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const lineGroups = useMemo(() => {
    const order = [];
    const map = new Map();
    editLines.forEach((row, idx) => {
      const groupable = row.lineType === 'claim_tpa_desk' || row.lineType === 'service_percentage';
      const key = groupable ? `${row.lineType}::${baseServiceName(row.description)}` : `single::${idx}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: groupable ? baseServiceName(row.description) : row.description,
          lineType: row.lineType,
          groupable,
          items: [],
        });
        order.push(key);
      }
      map.get(key).items.push({ row, idx });
    });
    return order.map((k) => map.get(k));
  }, [editLines]);

  // Live totals for the draft editor — recomputed on every keystroke from
  // editLines + discount + GST/TDS + roundOff so the operator sees the
  // discount and other tweaks reflected before clicking Save Draft. Mirrors
  // the formulas in calculateInvoiceTotals: discount comes off the bare
  // SubTotal pre-GST, TDS applies on (taxable + GST).
  const liveTotals = useMemo(() => {
    const sumBy = (types) => editLines.filter((r) => types.includes(r.lineType)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const tpaSum = sumBy(['claim_tpa_desk', 'service_percentage']);
    const servicesSum = sumBy(['service_fixed', 'manual']);
    const adjustSum = sumBy(['adjustment']);
    const gross = Math.round(tpaSum + servicesSum + adjustSum);
    const discountAmt = Math.min(Math.max(0, Math.round(Number(discount) || 0)), gross);
    const taxable = gross - discountAmt;
    const effectiveGst = Number(gstRate) || 0;
    const gstAmount = Math.round((taxable * effectiveGst) / 100);
    const selectedTds = tdsRateId ? tdsRates.find((r) => r._id === tdsRateId) : null;
    const effectiveTdsRate = selectedTds ? Number(selectedTds.rate) || 0 : (invoice?.tdsRate || 0);
    const effectiveTdsSection = selectedTds ? (selectedTds.section || '') : (invoice?.tdsSection || '');
    const tdsAmount = Math.round(((taxable + gstAmount) * effectiveTdsRate) / 100);
    const netTotal = taxable + gstAmount - tdsAmount;
    const roundOffI = Math.round(Number(roundOff) || 0);
    const previousBalance = invoice?.previousBalance || 0;
    const amountPaid = invoice?.amountPaid || 0;
    const thisBalance = netTotal + roundOffI - amountPaid;
    const currentBalance = thisBalance + previousBalance;
    return {
      tpa: Math.round(tpaSum), services: Math.round(servicesSum), adjust: Math.round(adjustSum),
      gross, discount: discountAmt, taxable, gstAmount, tdsAmount, netTotal,
      effectiveGst, tdsRate: effectiveTdsRate, tdsSection: effectiveTdsSection,
      roundOff: roundOffI, previousBalance, amountPaid, thisBalance, currentBalance,
    };
  }, [editLines, discount, gstRate, tdsRateId, tdsRates, roundOff, invoice]);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await getInvoiceAPI(id);
      setInvoice(data);
      setNotes(data.notes || '');
      setTdsRateId(data.tdsRateId || '');
      setRoundOff(data.roundOff || 0);
      setDiscount(data.discount || 0);
      setGstRate(data.gstRate ?? 0);
      setAdjustments((data.lineItems || []).filter((l) => l.lineType === 'adjustment').map((l) => ({
        description: l.description, amount: l.amount,
      })));
      // Seed the per-row editor with everything currently on the invoice.
      // `_origId` is kept so we can diff vs the server later and send lineEdits + removedLineIds.
      const items = (data.lineItems || []).map((l) => ({
        _origId: l._id || l.id,
        description: l.description || '',
        amount: l.amount,
        lineType: l.lineType,
        claimId: l.claimId || null,
      }));
      setEditLines(items);
      setOriginalLines(items.map((x) => ({ ...x })));
      // Load payments for this invoice
      try {
        const pays = await getCashBankAPI({ invoiceId: id, limit: 200 });
        setPayments(pays.data.entries || []);
        setPayForm((f) => ({ ...f, amount: Math.max(0, (data.amountPending || 0)) }));
      } catch { /* non-fatal */ }
    } catch {
      toast.error('Invoice not found');
      navigate('/invoices');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [id]);

  useEffect(() => {
    getTdsRatesAPI({ active: 'true' }).then(({ data }) => setTdsRates(data || [])).catch(() => setTdsRates([])).finally(() => setLoadingTdsRates(false));
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (!invoice) return null;

  const isDraft = invoice.status === 'draft';
  const isIssued = invoice.status === 'issued';
  const isVoid = invoice.status === 'void';
  const groupedLines = (invoice.lineItems || []).reduce((acc, l) => { (acc[l.lineType] = acc[l.lineType] || []).push(l); return acc; }, {});
  const orderedTypes = ['claim_tpa_desk', 'service_fixed', 'service_percentage', 'adjustment'];

  const saveDraft = async () => {
    setSaving(true);
    try {
      // Diff editLines vs originalLines so the backend only patches what changed.
      const origById = new Map(originalLines.map((l) => [l._origId, l]));
      const seen = new Set();
      const lineEdits = [];
      const manualItems = [];
      editLines.forEach((row) => {
        if (row._origId) {
          seen.add(row._origId);
          const orig = origById.get(row._origId);
          if (!orig) return;
          const descChanged = (row.description || '') !== (orig.description || '');
          const amtChanged = Math.round(Number(row.amount) || 0) !== Math.round(Number(orig.amount) || 0);
          if (descChanged || amtChanged) {
            lineEdits.push({ id: row._origId, description: row.description, amount: Number(row.amount) || 0 });
          }
        } else if ((row.description || '').trim()) {
          manualItems.push({ description: row.description, amount: Number(row.amount) || 0 });
        }
      });
      const removedLineIds = originalLines.map((l) => l._origId).filter((id) => !seen.has(id));

      const payload = {
        notes,
        tdsRateId: tdsRateId || null,
        roundOff: Math.round(Number(roundOff) || 0),
        discount: Math.max(0, Math.round(Number(discount) || 0)),
        gstRate: Math.max(0, Number(gstRate) || 0),
      };
      if (lineEdits.length) payload.lineEdits = lineEdits;
      if (manualItems.length) payload.manualItems = manualItems;
      if (removedLineIds.length) payload.removedLineIds = removedLineIds;

      await updateInvoiceAPI(id, payload);
      toast.success(invoice.status === 'draft' ? 'Draft saved' : 'Invoice updated');
      reload();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleIssue = async () => {
    if (!(await confirm('Issue this invoice? Once issued, it cannot be edited or deleted (only voided pre-payment).', { title: 'Issue Invoice', confirmLabel: 'Issue' }))) return;
    setSaving(true);
    try {
      const { data } = await issueInvoiceAPI(id);
      const flow = data?.commissionAutoFlow;
      if (flow && !flow.skipped && flow.rowsCreated > 0) {
        toast.success(`Invoice issued. ${flow.rowsCreated} commission ${flow.rowsCreated === 1 ? 'entry' : 'entries'} (₹${(flow.totalAmount || 0).toLocaleString('en-IN')}) auto-created.`);
      } else {
        toast.success('Invoice issued');
      }
      reload();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Issue failed');
    } finally {
      setSaving(false);
    }
  };

  const handleVoid = async () => {
    const reason = window.prompt('Reason for voiding this invoice?');
    if (reason === null) return;
    if (!reason.trim()) {
      toast.error('Reason is required');
      return;
    }
    setSaving(true);
    try {
      const { data } = await voidInvoiceAPI(id, { reason });
      const removed = data?.commissionAutoFlow?.rowsRemoved || 0;
      toast.success(removed ? `Invoice voided. ${removed} auto commission ${removed === 1 ? 'entry' : 'entries'} reversed.` : 'Invoice voided');
      reload();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Void failed');
    } finally {
      setSaving(false);
    }
  };

  const recordPayment = async (e) => {
    e.preventDefault();
    if (!payForm.amount || Number(payForm.amount) <= 0) {
      toast.error('Amount must be greater than zero');
      return;
    }
    setPayingNow(true);
    try {
      await recordInvoicePaymentAPI(id, {
        date: payForm.date,
        mode: payForm.mode,
        amount: Number(payForm.amount),
        utrNumber: payForm.utrNumber,
        chequeNumber: payForm.chequeNumber,
        notes: payForm.notes,
      });
      toast.success('Payment recorded');
      setPayForm((f) => ({ ...f, amount: 0, utrNumber: '', chequeNumber: '', notes: '' }));
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setPayingNow(false);
    }
  };

  const markAsPaid = () => {
    const pending = Math.max(0, Math.round(invoice.amountPending || 0));
    if (pending <= 0) {
      toast.info('Invoice is already fully paid');
      return;
    }
    setMarkPaidOpen(true);
  };

  const handleMarkPaidSave = async (form) => {
    if (!invoice) return;
    setPayingNow(true);
    try {
      await createCashBankAPI({
        ...form,
        direction: 'in',
        invoiceId: invoice._id,
      });
      toast.success('Payment recorded');
      setMarkPaidOpen(false);
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setPayingNow(false);
    }
  };

  const removePayment = async (entry) => {
    if (!(await confirm(`Reverse this ${entry.mode.toUpperCase()} payment of ₹${entry.amount}?`, { title: 'Reverse Payment', confirmLabel: 'Reverse' }))) return;
    try {
      await deleteCashBankAPI(entry._id);
      toast.success('Payment reversed');
      reload();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to reverse');
    }
  };

  const handleDelete = async () => {
    if (!(await confirm('Delete this draft? This cannot be undone.', { title: 'Delete Draft', confirmLabel: 'Delete' }))) return;
    try {
      await deleteInvoiceAPI(id);
      toast.success('Draft deleted');
      navigate('/invoices');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Delete failed');
    }
  };

  const addAdjustment = () => setAdjustments((a) => [...a, { description: '', amount: 0 }]);
  const updateAdjustment = (i, key, val) => setAdjustments((a) => a.map((x, idx) => idx === i ? { ...x, [key]: val } : x));
  const removeAdjustment = (i) => setAdjustments((a) => a.filter((_, idx) => idx !== i));

  return (
    <div>
      {/* Top action row — back link on the left, all action buttons right-aligned
          using the same outlined-+-primary pattern as the rest of the project. */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <button onClick={() => navigate('/invoices')}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <HiOutlineArrowLeft className="w-4 h-4" /> Back to invoices
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button"
            disabled={loadingPdf}
            onClick={async () => {
              setLoadingPdf(true);
              try {
                await openInvoicePdf(id, invoice.invoiceNumber || `draft-${id.slice(0, 8)}`);
              } catch (err) {
                toast.error(err.response?.data?.message || 'Failed to load PDF');
              } finally {
                setLoadingPdf(false);
              }
            }}
            className="flex items-center gap-2 bg-white border border-primary-600 text-primary-700 hover:bg-primary-50 disabled:opacity-60 disabled:cursor-wait px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            {loadingPdf ? (
              <>
                <span className="inline-block w-4 h-4 rounded-full border-2 border-primary-200 border-t-primary-600 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <HiOutlinePrinter className="w-4 h-4" />
                {isDraft ? 'Preview PDF' : 'Print PDF'}
              </>
            )}
          </button>
          {!isVoid && canEdit && (
            <button onClick={saveDraft} disabled={saving}
              className="flex items-center gap-2 bg-white border border-primary-600 text-primary-700 hover:bg-primary-50 disabled:opacity-50 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineSave className="w-4 h-4" /> {saving ? 'Saving...' : (isDraft ? 'Save Draft' : 'Save Changes')}
            </button>
          )}
          {isDraft && canEdit && (
            <button onClick={handleIssue} disabled={saving}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineCheck className="w-4 h-4" /> Issue
            </button>
          )}
          {isDraft && canDelete && (
            <button onClick={handleDelete}
              className="flex items-center gap-2 bg-white border border-red-300 hover:bg-red-50 text-red-600 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineTrash className="w-4 h-4" /> Delete
            </button>
          )}
          {(isIssued || invoice.status === 'partially_paid') && canEdit && (invoice.amountPending || 0) > 0 && (
            <button onClick={markAsPaid} disabled={payingNow}
              className="flex items-center gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineCheckCircle className="w-4 h-4" /> {payingNow ? 'Saving...' : 'Mark as Paid'}
            </button>
          )}
          {isIssued && canEdit && (invoice.amountPaid || 0) === 0 && (
            <button onClick={handleVoid}
              className="flex items-center gap-2 bg-white border border-red-300 hover:bg-red-50 text-red-600 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineBan className="w-4 h-4" /> Void
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-800">
              {invoice.invoiceNumber || `Draft-${invoice._id.slice(0, 8)}`}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              {invoice.hospital?.name} • {formatMonth(invoice.month)}
            </p>
            {invoice.issuedAt && <p className="text-xs text-gray-400 mt-1">Issued {formatDate(invoice.issuedAt)} • Due {formatDate(invoice.dueDate)}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${STATUS_COLORS[invoice.status]}`}>
              {invoice.status.replace('_', ' ').toUpperCase()}
            </span>
            {(isIssued || invoice.status === 'partially_paid')
              && (invoice.amountPending || 0) > 0
              && invoice.dueDate && new Date(invoice.dueDate) < new Date() && (
              <span className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium bg-red-100 text-red-700">
                <HiOutlineExclamationCircle className="w-3.5 h-3.5" /> OVERDUE
              </span>
            )}
          </div>
        </div>

        {isVoid && invoice.voidReason && (
          <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            <strong>Voided:</strong> {invoice.voidReason}
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Line items</h2>
          {!isVoid && canEdit && (
            <button
              onClick={() => setEditLines((rows) => [...rows, { _origId: null, description: '', amount: 0, lineType: 'manual', claimId: null }])}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-200">
              <HiOutlinePlus className="w-4 h-4" /> Add Item
            </button>
          )}
        </div>

        {!isVoid && canEdit ? (
          <>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-12">#</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-28">Type</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-32">Amount</th>
                    <th className="py-3 px-4 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editLines.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">No line items yet. Use "Add Item" to start.</td></tr>
                  ) : lineGroups.flatMap((g) => {
                    const pillFor = (lt) =>
                      lt === 'claim_tpa_desk' ? 'bg-primary-50 text-primary-700' :
                      lt === 'service_fixed' ? 'bg-amber-50 text-amber-700' :
                      lt === 'adjustment' ? 'bg-purple-50 text-purple-700' :
                      lt === 'manual' ? 'bg-emerald-50 text-emerald-700' :
                      'bg-gray-100 text-gray-600';
                    if (g.items.length === 1 && !g.groupable) {
                      const { row, idx } = g.items[0];
                      return [(
                        <tr key={row._origId || `row-${idx}`} className="hover:bg-gray-50">
                          <td className="py-3 px-4 text-gray-400 text-sm">{idx + 1}</td>
                          <td className="py-3 px-4">
                            <input value={row.description}
                              onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                              placeholder="Description"
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                          </td>
                          <td className="py-3 px-4">
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pillFor(row.lineType)}`}>
                              {LINE_TYPE_LABEL[row.lineType] || row.lineType}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            <input type="number" value={row.amount}
                              onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button onClick={() => setEditLines((rows) => rows.filter((_, i) => i !== idx))}
                              title="Remove row"
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                              <HiOutlineTrash className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      )];
                    }
                    const groupTotal = g.items.reduce((a, { row }) => a + (Number(row.amount) || 0), 0);
                    const expanded = expandedGroups.has(g.key);
                    const out = [(
                      <tr key={`hdr-${g.key}`}
                        onClick={() => toggleGroup(g.key)}
                        className="bg-gray-50/60 hover:bg-gray-100 cursor-pointer">
                        <td className="py-3 px-4 text-gray-500">
                          {expanded ? <HiChevronDown className="w-4 h-4" /> : <HiChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-800">{g.label}</span>
                            <span className="text-xs text-gray-500">— {g.items.length} {g.items.length === 1 ? 'claim' : 'claims'}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${pillFor(g.lineType)}`}>
                            {LINE_TYPE_LABEL[g.lineType] || g.lineType}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800 tabular-nums">
                          {formatINR(groupTotal)}
                        </td>
                        <td className="py-3 px-4 text-right text-xs text-gray-400">
                          {expanded ? 'hide' : 'show'}
                        </td>
                      </tr>
                    )];
                    if (expanded) {
                      g.items.forEach(({ row, idx }) => {
                        out.push(
                          <tr key={row._origId || `row-${idx}`} className="bg-white">
                            <td className="py-2 px-4 text-gray-400 text-xs pl-10">{idx + 1}</td>
                            <td className="py-2 px-4">
                              <input value={row.description}
                                onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                                placeholder="Description"
                                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                            </td>
                            <td className="py-2 px-4" />
                            <td className="py-2 px-4">
                              <input type="number" value={row.amount}
                                onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                                className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                            </td>
                            <td className="py-2 px-4 text-right">
                              <button onClick={() => setEditLines((rows) => rows.filter((_, i) => i !== idx))}
                                title="Remove row"
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                                <HiOutlineTrash className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      });
                    }
                    return out;
                  })}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={3} className="py-3 px-4 text-right text-xs uppercase text-gray-500 font-semibold">Subtotal</td>
                    <td className="py-3 px-4 text-right font-semibold text-gray-800">
                      {formatINR(editLines.reduce((a, r) => a + (Number(r.amount) || 0), 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="text-xs text-gray-400 mt-2">
              Tip: use a negative amount for a discount, positive for an extra charge. Claim-linked rows update the claim's file price when the invoice is issued.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  GST Rate (%) <span className="text-xs text-gray-400 font-normal">(applied to Sub Total)</span>
                </label>
                <input
                  type="number" min="0" max="100" step="0.01"
                  value={gstRate}
                  onChange={(e) => setGstRate(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">TDS Rate</label>
                <SearchableSelect
                  isLoading={loadingTdsRates}
                  value={tdsRateId}
                  onChange={setTdsRateId}
                  placeholder={`Use hospital default (${invoice.hospital?.tdsRate ?? 0}%)`}
                  searchPlaceholder="Search TDS rates..."
                  noneLabel={`— Use hospital default (${invoice.hospital?.tdsRate ?? 0}%) —`}
                  allowClear
                  options={tdsRates.map((r) => ({
                    value: r._id,
                    label: `${r.taxName} — ${r.rate}%${r.section ? ` (${r.section})` : ''}`,
                  }))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Discount <span className="text-xs text-gray-400 font-normal">(max {formatINR(liveTotals.gross)})</span>
                </label>
                <input
                  type="number" min="0" max={liveTotals.gross}
                  value={discount}
                  onChange={(e) => {
                    const cap = liveTotals.gross;
                    const v = Math.max(0, Math.min(Number(e.target.value) || 0, cap));
                    setDiscount(v);
                  }}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Round Off <span className="text-xs text-gray-400 font-normal">(+/- on Grand Total)</span>
                </label>
                <input
                  type="number"
                  value={roundOff}
                  onChange={(e) => setRoundOff(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>

            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </>
        ) : (
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-10"></th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orderedTypes.flatMap((t) => {
                  const rows = groupedLines[t];
                  if (!rows || !rows.length) return [];
                  // For TPA Desk + Variable, fold rows that share a baseServiceName
                  // into one collapsible header to keep 50+ claim invoices readable.
                  const collapsible = t === 'claim_tpa_desk' || t === 'service_percentage';
                  const out = [(
                    <tr key={`${t}-h`} className="bg-gray-50/60">
                      <td colSpan={3} className="py-3 px-4 text-xs font-semibold uppercase text-gray-500">{LINE_TYPE_LABEL[t] || t}</td>
                    </tr>
                  )];
                  if (!collapsible) {
                    rows.forEach((l) => out.push(
                      <tr key={l._id || l.id} className="hover:bg-gray-50">
                        <td className="py-3 px-4" />
                        <td className="py-3 px-4 text-gray-700">{l.description}</td>
                        <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{formatINR(l.amount)}</td>
                      </tr>
                    ));
                    return out;
                  }
                  // Bucket rows of this type by baseServiceName, preserving order.
                  const order = [];
                  const map = new Map();
                  rows.forEach((l) => {
                    const k = baseServiceName(l.description);
                    if (!map.has(k)) { map.set(k, []); order.push(k); }
                    map.get(k).push(l);
                  });
                  order.forEach((label) => {
                    const items = map.get(label);
                    const key = `ro-${t}-${label}`;
                    const total = items.reduce((a, l) => a + (Number(l.amount) || 0), 0);
                    const expanded = expandedGroups.has(key);
                    if (items.length === 1) {
                      const l = items[0];
                      out.push(
                        <tr key={l._id || l.id} className="hover:bg-gray-50">
                          <td className="py-3 px-4" />
                          <td className="py-3 px-4 text-gray-700">{l.description}</td>
                          <td className="py-3 px-4 text-right text-gray-700 tabular-nums">{formatINR(l.amount)}</td>
                        </tr>
                      );
                      return;
                    }
                    out.push(
                      <tr key={key} onClick={() => toggleGroup(key)} className="bg-gray-50/40 hover:bg-gray-100 cursor-pointer">
                        <td className="py-3 px-4 text-gray-500">
                          {expanded ? <HiChevronDown className="w-4 h-4" /> : <HiChevronRight className="w-4 h-4" />}
                        </td>
                        <td className="py-3 px-4 text-gray-800">
                          <span className="font-medium">{label}</span>
                          <span className="text-xs text-gray-500 ml-2">— {items.length} claims</span>
                        </td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800 tabular-nums">{formatINR(total)}</td>
                      </tr>
                    );
                    if (expanded) {
                      items.forEach((l) => out.push(
                        <tr key={l._id || l.id} className="bg-white">
                          <td className="py-2 px-4 pl-10" />
                          <td className="py-2 px-4 text-gray-600 text-sm">{l.description}</td>
                          <td className="py-2 px-4 text-right text-gray-600 text-sm tabular-nums">{formatINR(l.amount)}</td>
                        </tr>
                      ));
                    }
                  });
                  return out;
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(isIssued || invoice.status === 'partially_paid' || invoice.status === 'paid') && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Payments</h2>
            <span className="text-sm text-gray-500">
              Pending: <strong className={(invoice.amountPending || 0) > 0 ? 'text-amber-600' : 'text-green-700'}>{formatINR(invoice.amountPending)}</strong>
            </span>
          </div>

          {payments.length === 0 ? (
            <p className="text-sm text-gray-400 mb-4">No payments recorded yet.</p>
          ) : (
            <div className="overflow-x-auto mb-4 border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Mode</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">UTR / Cheque</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <tr key={p._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600">{formatDate(p.date)}</td>
                      <td className="py-3 px-4 text-gray-700 text-xs uppercase font-medium">{p.mode}</td>
                      <td className="py-3 px-4 text-gray-500 text-xs font-mono">{p.utrNumber || p.chequeNumber || '—'}</td>
                      <td className="py-3 px-4 text-gray-600">{p.notes || '—'}</td>
                      <td className="py-3 px-4 text-right text-green-700 font-medium">+{formatINR(p.amount)}</td>
                      <td className="py-3 px-4 text-right">
                        {canEdit && (
                          <button onClick={() => removePayment(p)}
                            className="p-1 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && invoice.status !== 'paid' && invoice.status !== 'void' && (
            <form onSubmit={recordPayment} className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
                <input type="date" required value={payForm.date}
                  onChange={(e) => setPayForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Mode</label>
                <select value={payForm.mode}
                  onChange={(e) => setPayForm((f) => ({ ...f, mode: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm">
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Amount</label>
                <input type="number" min="1" required value={payForm.amount}
                  onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">UTR / Cheque</label>
                <input value={payForm.utrNumber || payForm.chequeNumber}
                  onChange={(e) => setPayForm((f) => ({ ...f, [payForm.mode === 'cash' ? 'chequeNumber' : 'utrNumber']: e.target.value }))}
                  className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm" />
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={payingNow || Number(payForm.amount) <= 0}
                  className="w-full px-3 py-1.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                  {payingNow ? 'Saving...' : 'Record Payment'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="text-lg font-semibold text-gray-800 mb-3">
          Totals
          {isDraft && <span className="ml-2 text-xs font-normal text-gray-400">(live — Save Draft to persist)</span>}
        </h2>
        {(() => {
          // In draft mode, show the live preview so the operator can see the
          // effect of discount/GST/TDS/roundOff edits before saving. Once
          // issued, the persisted totals are authoritative.
          const t = isDraft ? {
            subtotalTpaDesk: liveTotals.tpa,
            subtotalServices: liveTotals.services,
            subtotalAdjust: liveTotals.adjust,
            gross: liveTotals.gross,
            discount: liveTotals.discount,
            gstRate: liveTotals.effectiveGst,
            gstAmount: liveTotals.gstAmount,
            tdsRate: liveTotals.tdsRate,
            tdsSection: liveTotals.tdsSection,
            tdsAmount: liveTotals.tdsAmount,
            netTotal: liveTotals.netTotal,
            amountPaid: liveTotals.amountPaid,
            roundOff: liveTotals.roundOff,
            previousBalance: liveTotals.previousBalance,
            thisBalance: liveTotals.thisBalance,
            amountPending: liveTotals.currentBalance,
          } : {
            subtotalTpaDesk: invoice.subtotalTpaDesk,
            subtotalServices: invoice.subtotalServices,
            subtotalAdjust: invoice.subtotalAdjust,
            gross: invoice.gross,
            discount: invoice.discount || 0,
            gstRate: invoice.gstRate,
            gstAmount: invoice.gstAmount,
            tdsRate: invoice.tdsRate,
            tdsSection: invoice.tdsSection,
            tdsAmount: invoice.tdsAmount,
            netTotal: invoice.netTotal,
            amountPaid: invoice.amountPaid || 0,
            roundOff: invoice.roundOff || 0,
            previousBalance: invoice.previousBalance || 0,
            thisBalance: (invoice.netTotal || 0) + (invoice.roundOff || 0) - (invoice.amountPaid || 0),
            amountPending: invoice.amountPending || 0,
          };
          const taxable = (t.gross || 0) - (t.discount || 0);
          return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-1 text-gray-600">
                <div className="flex justify-between"><span>Subtotal — TPA Desk</span><span className="tabular-nums">{formatINR(t.subtotalTpaDesk)}</span></div>
                <div className="flex justify-between"><span>Subtotal — Services</span><span className="tabular-nums">{formatINR(t.subtotalServices)}</span></div>
                {t.subtotalAdjust !== 0 && (
                  <div className="flex justify-between"><span>Adjustments</span><span className="tabular-nums">{formatINR(t.subtotalAdjust)}</span></div>
                )}
                <div className="flex justify-between font-semibold text-gray-800 border-t border-gray-200 pt-1 mt-1">
                  <span>Gross</span><span className="tabular-nums">{formatINR(t.gross)}</span>
                </div>
              </div>
              <div className="space-y-1 text-gray-600">
                <div className="flex justify-between"><span>Sub Total</span><span className="tabular-nums">{formatINR(t.gross)}</span></div>
                {(t.discount || 0) > 0 && (
                  <>
                    <div className="flex justify-between text-green-700">
                      <span>Discount</span>
                      <span className="tabular-nums">- {formatINR(t.discount)}</span>
                    </div>
                    <div className="flex justify-between"><span>Taxable Value</span><span className="tabular-nums">{formatINR(taxable)}</span></div>
                  </>
                )}
                {t.gstAmount > 0 && (
                  <div className="flex justify-between"><span>GST ({t.gstRate}%)</span><span className="tabular-nums">{formatINR(t.gstAmount)}</span></div>
                )}
                {t.tdsAmount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>TDS@{t.tdsRate}%{t.tdsSection ? `(${t.tdsSection})` : ''}</span>
                    <span className="tabular-nums">{formatINR(t.tdsAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                  <span>Total</span><span className="tabular-nums">{formatINR(t.netTotal)}</span>
                </div>
                <div className="flex justify-between"><span>Received</span><span className="tabular-nums">{formatINR(t.amountPaid)}</span></div>
                <div className="flex justify-between">
                  <span>Balance</span>
                  <span className="tabular-nums">{formatINR(t.thisBalance)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                  <span>Previous Balance</span><span className="tabular-nums">{formatINR(t.previousBalance)}</span>
                </div>
                <div className={`flex justify-between font-bold ${(t.amountPending || 0) > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  <span>Current Balance</span><span className="tabular-nums">{formatINR(t.amountPending)}</span>
                </div>
                <div className="flex justify-between font-bold text-gray-900">
                  <span>Invoice Value Before TDS</span><span className="tabular-nums">{formatINR(taxable)}</span>
                </div>
                {t.roundOff !== 0 && (
                  <div className="flex justify-between"><span>Round Off</span><span className="tabular-nums">{formatINR(t.roundOff)}</span></div>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Mark-as-paid: same Cash/Bank entry modal as CashBankList, pre-linked
          to this invoice so the operator only has to confirm amount + mode. */}
      <CashBankFormModal
        open={markPaidOpen}
        initial={invoice ? {
          direction: 'in',
          mode: 'cash',
          amount: Math.max(0, Math.round(invoice.amountPending || 0)),
          date: new Date().toISOString().slice(0, 10),
          notes: '',
          invoice: { _id: invoice._id },
        } : null}
        invoices={invoice ? [invoice] : []}
        expenses={[]}
        bankAccounts={bankAccounts}
        loadingInvoices={false}
        loadingExpenses={false}
        loadingBankAccounts={loadingBankAccounts}
        onClose={() => setMarkPaidOpen(false)}
        onSave={handleMarkPaidSave}
      />
    </div>
  );
};

export default InvoiceDetail;
