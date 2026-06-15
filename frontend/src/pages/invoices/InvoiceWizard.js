import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { HiOutlineArrowLeft, HiOutlineSearch, HiOutlineEye } from 'react-icons/hi';
import { getHospitalsAPI, previewInvoiceAPI, createInvoiceAPI, getTdsRatesAPI } from '../../services/api';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk Fees',
  service_fixed: 'Fixed Services',
  service_percentage: 'Variable Services',
  adjustment: 'Adjustments',
};

const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const InvoiceWizard = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [tdsRates, setTdsRates] = useState([]);
  const [hospitalId, setHospitalId] = useState('');
  const [tdsRateId, setTdsRateId] = useState('');
  const [month, setMonth] = useState(todayMonth());
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    getHospitalsAPI().then(({ data }) => {
      const list = Array.isArray(data) ? data : data.hospitals;
      setHospitals((list || []).filter((h) => h.isActive !== false));
    }).catch(() => toast.error('Failed to load hospitals'));
    getTdsRatesAPI({ active: 'true' }).then(({ data }) => setTdsRates(data || [])).catch(() => setTdsRates([]));
  }, []);

  const runPreview = async () => {
    if (!hospitalId || !month) {
      toast.error('Pick a hospital and a month first');
      return;
    }
    setLoading(true);
    setPreview(null);
    try {
      const { data } = await previewInvoiceAPI({ hospitalId, month: month + '-01', tdsRateId: tdsRateId || undefined });
      setPreview(data);
      if (!data.hasContent) toast.info('No claims or fixed services found for this month');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!preview || !preview.hasContent) return;
    setCreating(true);
    try {
      const { data } = await createInvoiceAPI({ hospitalId, month: month + '-01', notes, tdsRateId: tdsRateId || undefined });
      toast.success('Draft invoice created');
      navigate(`/invoices/${data._id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const groupedLines = (preview?.lines || []).reduce((acc, l) => {
    (acc[l.lineType] = acc[l.lineType] || []).push(l);
    return acc;
  }, {});

  const orderedTypes = ['claim_tpa_desk', 'service_fixed', 'service_percentage', 'adjustment'];

  return (
    <div>
      <button onClick={() => navigate('/invoices')}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <HiOutlineArrowLeft className="w-4 h-4" /> Back to invoices
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
            <select value={hospitalId} onChange={(e) => { setHospitalId(e.target.value); setPreview(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">— Select hospital —</option>
              {hospitals.map((h) => <option key={h._id} value={h._id}>{h.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
            <input type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="flex items-end">
            <button onClick={runPreview} disabled={loading || !hospitalId || !month}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              <HiOutlineSearch className="w-4 h-4" />
              {loading ? 'Loading...' : 'Preview'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TDS Rate (optional)</label>
            <select value={tdsRateId} onChange={(e) => { setTdsRateId(e.target.value); setPreview(null); }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
              <option value="">— Use hospital default —</option>
              {tdsRates.map((r) => (
                <option key={r._id} value={r._id}>
                  {r.taxName} — {r.rate}%{r.section ? ` (${r.section})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note for this invoice"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
        </div>
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <HiOutlineEye className="w-5 h-5" /> Preview
            </h2>
            {preview.hasContent && (
              <button onClick={create} disabled={creating}
                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
                {creating ? 'Saving...' : 'Save Draft'}
              </button>
            )}
          </div>

          {!preview.hasContent ? (
            <div className="p-6 text-center text-sm text-gray-500 bg-gray-50 rounded-lg">
              No claims or fixed services found for this hospital + month.
            </div>
          ) : (
            <>
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
                        <tr key={`${t}-header`} className="bg-gray-50/60">
                          <td colSpan={2} className="py-2 px-3 text-xs font-semibold uppercase text-gray-500">
                            {LINE_TYPE_LABEL[t] || t}
                          </td>
                        </tr>,
                        ...rows.map((l, i) => (
                          <tr key={`${t}-${i}`} className="hover:bg-gray-50">
                            <td className="py-2 px-3 text-gray-700">{l.description}</td>
                            <td className="py-2 px-3 text-right text-gray-700">{formatINR(l.amount)}</td>
                          </tr>
                        )),
                      ];
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                <div className="space-y-1 text-gray-600">
                  <div className="flex justify-between"><span>Subtotal — TPA Desk</span><span>{formatINR(preview.totals.subtotalTpaDesk)}</span></div>
                  <div className="flex justify-between"><span>Subtotal — Services</span><span>{formatINR(preview.totals.subtotalServices)}</span></div>
                  {preview.totals.subtotalAdjust !== 0 && (
                    <div className="flex justify-between"><span>Adjustments</span><span>{formatINR(preview.totals.subtotalAdjust)}</span></div>
                  )}
                  <div className="flex justify-between font-semibold text-gray-800"><span>Gross</span><span>{formatINR(preview.totals.gross)}</span></div>
                </div>
                <div className="space-y-1 text-gray-600">
                  <div className="flex justify-between"><span>GST ({preview.totals.gstRate}%)</span><span>{formatINR(preview.totals.gstAmount)}</span></div>
                  <div className="flex justify-between"><span>TDS ({preview.totals.tdsRate}%)</span><span>− {formatINR(preview.totals.tdsAmount)}</span></div>
                  <div className="flex justify-between font-semibold text-gray-800"><span>Net Total</span><span>{formatINR(preview.totals.netTotal)}</span></div>
                  {preview.totals.previousBalance > 0 && (
                    <div className="flex justify-between"><span>Previous Balance</span><span>{formatINR(preview.totals.previousBalance)}</span></div>
                  )}
                  <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-200 pt-1">
                    <span>Grand Total</span><span>{formatINR(preview.totals.grandTotal)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default InvoiceWizard;
