import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlinePlus, HiOutlineTrash,
  HiOutlinePrinter, HiOutlineBan, HiOutlineCheck, HiOutlineSave,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getInvoiceAPI, updateInvoiceAPI, issueInvoiceAPI, voidInvoiceAPI, deleteInvoiceAPI, openInvoicePdf,
  getTdsRatesAPI, getCashBankAPI, recordInvoicePaymentAPI, deleteCashBankAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
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
  const [tdsRateId, setTdsRateId] = useState('');
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [payments, setPayments] = useState([]);
  const [payForm, setPayForm] = useState({ date: new Date().toISOString().slice(0,10), mode: 'cash', amount: 0, utrNumber: '', chequeNumber: '', notes: '' });
  const [payingNow, setPayingNow] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await getInvoiceAPI(id);
      setInvoice(data);
      setNotes(data.notes || '');
      setTdsRateId(data.tdsRateId || '');
      setRoundOff(data.roundOff || 0);
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
      };
      if (lineEdits.length) payload.lineEdits = lineEdits;
      if (manualItems.length) payload.manualItems = manualItems;
      if (removedLineIds.length) payload.removedLineIds = removedLineIds;

      await updateInvoiceAPI(id, payload);
      toast.success('Draft saved');
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
      <button onClick={() => navigate('/invoices')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to invoices
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800">
              {invoice.invoiceNumber || `Draft-${invoice._id.slice(0, 8)}`}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {invoice.hospital?.name} • {formatMonth(invoice.month)}
            </p>
            {invoice.issuedAt && <p className="text-xs text-gray-400 mt-1">Issued {formatDate(invoice.issuedAt)} • Due {formatDate(invoice.dueDate)}</p>}
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-1 rounded font-medium ${STATUS_COLORS[invoice.status]}`}>
              {invoice.status.replace('_', ' ').toUpperCase()}
            </span>
          </div>
        </div>

        {isVoid && invoice.voidReason && (
          <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
            <strong>Voided:</strong> {invoice.voidReason}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {/* PDF is downloadable at every status. For drafts it's a preview;
              for issued / partially_paid / paid / void it's the final document. */}
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
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-60 disabled:cursor-wait text-white text-sm font-medium rounded-lg">
            {loadingPdf ? (
              <>
                <span className="inline-block w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <HiOutlinePrinter className="w-4 h-4" />
                {isDraft ? 'Preview PDF' : 'Print PDF'}
              </>
            )}
          </button>
          {isDraft && canEdit && (
            <>
              <button onClick={saveDraft} disabled={saving}
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-800 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                <HiOutlineSave className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Draft'}
              </button>
              <button onClick={handleIssue} disabled={saving}
                className="flex items-center gap-2 px-3 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                <HiOutlineCheck className="w-4 h-4" /> Issue
              </button>
            </>
          )}
          {isDraft && canDelete && (
            <button onClick={handleDelete}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-red-300 hover:bg-red-50 text-red-600 text-sm font-medium rounded-lg">
              <HiOutlineTrash className="w-4 h-4" /> Delete
            </button>
          )}
          {isIssued && canEdit && (invoice.amountPaid || 0) === 0 && (
            <button onClick={handleVoid}
              className="flex items-center gap-2 px-3 py-2 bg-white border border-red-300 hover:bg-red-50 text-red-600 text-sm font-medium rounded-lg">
              <HiOutlineBan className="w-4 h-4" /> Void
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-800">Line items</h2>
          {isDraft && canEdit && (
            <button
              onClick={() => setEditLines((rows) => [...rows, { _origId: null, description: '', amount: 0, lineType: 'manual', claimId: null }])}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-primary-600 hover:bg-primary-50 rounded-lg border border-primary-200">
              <HiOutlinePlus className="w-4 h-4" /> Add Item
            </button>
          )}
        </div>

        {isDraft && canEdit ? (
          <>
            <div className="overflow-x-auto border border-gray-100 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="text-left py-2 px-3 w-10">#</th>
                    <th className="text-left py-2 px-3">Description</th>
                    <th className="text-left py-2 px-3 w-28">Type</th>
                    <th className="text-right py-2 px-3 w-32">Amount</th>
                    <th className="py-2 px-3 w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {editLines.length === 0 ? (
                    <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">No line items yet. Use "Add Item" to start.</td></tr>
                  ) : editLines.map((row, idx) => (
                    <tr key={row._origId || `new-${idx}`} className="hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="py-2 px-3">
                        <input
                          value={row.description}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                          placeholder="Description"
                          className="w-full px-2 py-1 border border-gray-200 rounded text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                          row.lineType === 'claim_tpa_desk' ? 'bg-primary-50 text-primary-700' :
                          row.lineType === 'service_fixed' ? 'bg-amber-50 text-amber-700' :
                          row.lineType === 'adjustment' ? 'bg-purple-50 text-purple-700' :
                          row.lineType === 'manual' ? 'bg-emerald-50 text-emerald-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {LINE_TYPE_LABEL[row.lineType] || row.lineType}
                        </span>
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="number"
                          value={row.amount}
                          onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                          className="w-full px-2 py-1 border border-gray-200 rounded text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button
                          onClick={() => setEditLines((rows) => rows.filter((_, i) => i !== idx))}
                          title="Remove row"
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                          <HiOutlineTrash className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={3} className="py-2 px-3 text-right text-xs uppercase text-gray-500 font-semibold">Subtotal</td>
                    <td className="py-2 px-3 text-right font-semibold text-gray-800">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
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
                  Round Off <span className="text-xs text-gray-400 font-normal">(+/- applied to Grand Total)</span>
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
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left py-2 px-3">Description</th>
                  <th className="text-right py-2 px-3">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orderedTypes.flatMap((t) => {
                  const rows = groupedLines[t];
                  if (!rows || !rows.length) return [];
                  return [
                    <tr key={`${t}-h`} className="bg-gray-50/60">
                      <td colSpan={2} className="py-2 px-3 text-xs font-semibold uppercase text-gray-500">{LINE_TYPE_LABEL[t] || t}</td>
                    </tr>,
                    ...rows.map((l) => (
                      <tr key={l._id || l.id} className="hover:bg-gray-50">
                        <td className="py-2 px-3 text-gray-700">{l.description}</td>
                        <td className="py-2 px-3 text-right text-gray-700">{formatINR(l.amount)}</td>
                      </tr>
                    )),
                  ];
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
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Mode</th>
                    <th className="text-left py-2 px-3">UTR / Cheque</th>
                    <th className="text-left py-2 px-3">Notes</th>
                    <th className="text-right py-2 px-3">Amount</th>
                    <th className="text-right py-2 px-3">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {payments.map((p) => (
                    <tr key={p._id} className="hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-600">{formatDate(p.date)}</td>
                      <td className="py-2 px-3 text-gray-700 text-xs uppercase font-medium">{p.mode}</td>
                      <td className="py-2 px-3 text-gray-500 text-xs font-mono">{p.utrNumber || p.chequeNumber || '—'}</td>
                      <td className="py-2 px-3 text-gray-600">{p.notes || '—'}</td>
                      <td className="py-2 px-3 text-right text-green-700 font-medium">+{formatINR(p.amount)}</td>
                      <td className="py-2 px-3 text-right">
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
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Totals</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <div className="space-y-1 text-gray-600">
            <div className="flex justify-between"><span>Subtotal — TPA Desk</span><span>{formatINR(invoice.subtotalTpaDesk)}</span></div>
            <div className="flex justify-between"><span>Subtotal — Services</span><span>{formatINR(invoice.subtotalServices)}</span></div>
            {invoice.subtotalAdjust !== 0 && (
              <div className="flex justify-between"><span>Adjustments</span><span>{formatINR(invoice.subtotalAdjust)}</span></div>
            )}
            <div className="flex justify-between font-semibold text-gray-800"><span>Gross</span><span>{formatINR(invoice.gross)}</span></div>
          </div>
          <div className="space-y-1 text-gray-600">
            <div className="flex justify-between"><span>GST ({invoice.gstRate}%)</span><span>{formatINR(invoice.gstAmount)}</span></div>
            <div className="flex justify-between"><span>TDS ({invoice.tdsRate}%)</span><span>− {formatINR(invoice.tdsAmount)}</span></div>
            <div className="flex justify-between font-semibold text-gray-800"><span>Net Total</span><span>{formatINR(invoice.netTotal)}</span></div>
            {invoice.previousBalance > 0 && (
              <div className="flex justify-between"><span>Previous Balance</span><span>{formatINR(invoice.previousBalance)}</span></div>
            )}
            {invoice.roundOff !== 0 && (
              <div className="flex justify-between"><span>Round Off</span><span>{formatINR(invoice.roundOff)}</span></div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-1">
              <span>Grand Total</span><span>{formatINR(invoice.grandTotal)}</span>
            </div>
            {invoice.amountPaid > 0 && (
              <>
                <div className="flex justify-between"><span>Amount Paid</span><span>{formatINR(invoice.amountPaid)}</span></div>
                <div className="flex justify-between font-semibold text-amber-700"><span>Pending</span><span>{formatINR(invoice.amountPending)}</span></div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceDetail;
