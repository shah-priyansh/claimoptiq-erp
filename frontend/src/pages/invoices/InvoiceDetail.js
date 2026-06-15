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
  getInvoiceAPI, updateInvoiceAPI, issueInvoiceAPI, voidInvoiceAPI, deleteInvoiceAPI, invoicePdfUrl,
  getTdsRatesAPI, getCashBankAPI, recordInvoicePaymentAPI, deleteCashBankAPI,
} from '../../services/api';

const STATUS_COLORS = {
  draft:          'bg-gray-100 text-gray-700',
  issued:         'bg-blue-50 text-blue-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid:           'bg-green-50 text-green-700',
  void:           'bg-red-50 text-red-700',
};

const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk Fees',
  service_fixed: 'Fixed Services',
  service_percentage: 'Variable Services',
  adjustment: 'Adjustments',
};

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatMonth = (d) => d ? new Date(d).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) : '-';
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

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
  const [tdsRateId, setTdsRateId] = useState('');
  const [tdsRates, setTdsRates] = useState([]);
  const [payments, setPayments] = useState([]);
  const [payForm, setPayForm] = useState({ date: new Date().toISOString().slice(0,10), mode: 'cash', amount: 0, utrNumber: '', chequeNumber: '', notes: '' });
  const [payingNow, setPayingNow] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const { data } = await getInvoiceAPI(id);
      setInvoice(data);
      setNotes(data.notes || '');
      setTdsRateId(data.tdsRateId || '');
      setAdjustments((data.lineItems || []).filter((l) => l.lineType === 'adjustment').map((l) => ({
        description: l.description, amount: l.amount,
      })));
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
    getTdsRatesAPI({ active: 'true' }).then(({ data }) => setTdsRates(data || [])).catch(() => setTdsRates([]));
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
      await updateInvoiceAPI(id, { notes, adjustments, tdsRateId: tdsRateId || null });
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
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
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
          {(isIssued || isVoid) && (
            <a href={invoicePdfUrl(id)} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-900 text-white text-sm font-medium rounded-lg">
              <HiOutlinePrinter className="w-4 h-4" /> Print PDF
            </a>
          )}
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
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Line items</h2>
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
      </div>

      {isDraft && canEdit && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800">Adjustments</h2>
            <button onClick={addAdjustment}
              className="flex items-center gap-1 px-3 py-1 text-sm text-primary-600 hover:bg-primary-50 rounded">
              <HiOutlinePlus className="w-4 h-4" /> Add row
            </button>
          </div>
          {adjustments.length === 0 ? (
            <p className="text-sm text-gray-400">No adjustments. Use negative amounts for discounts.</p>
          ) : (
            <div className="space-y-2">
              {adjustments.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={a.description} onChange={(e) => updateAdjustment(i, 'description', e.target.value)}
                    placeholder="Description"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  <input type="number" value={a.amount} onChange={(e) => updateAdjustment(i, 'amount', e.target.value)}
                    placeholder="Amount"
                    className="w-32 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  <button onClick={() => removeAdjustment(i)}
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">TDS Rate</label>
            <select value={tdsRateId} onChange={(e) => setTdsRateId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">— Use hospital default ({invoice.hospital?.tdsRate ?? 0}%) —</option>
              {tdsRates.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.taxName} — {r.rate}%{r.section ? ` (${r.section})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
        </div>
      )}

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
