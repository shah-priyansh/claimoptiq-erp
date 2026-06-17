import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlineSearch, HiOutlinePlus, HiOutlineTrash,
  HiChevronRight, HiChevronDown,
} from 'react-icons/hi';
import {
  getHospitalsAPI, previewInvoiceAPI, createInvoiceAPI, updateInvoiceAPI, getTdsRatesAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk',
  service_fixed: 'Fixed',
  service_percentage: 'Variable',
  adjustment: 'Adjustment',
  manual: 'Manual',
};

const TYPE_PILL = (t) =>
  t === 'claim_tpa_desk' ? 'bg-primary-50 text-primary-700' :
  t === 'service_fixed' ? 'bg-amber-50 text-amber-700' :
  t === 'adjustment' ? 'bg-purple-50 text-purple-700' :
  t === 'manual' ? 'bg-emerald-50 text-emerald-700' :
  'bg-gray-100 text-gray-600';

const todayMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// 'TPA Desk — RAJESH PATEL (CCN-0001)' → 'TPA Desk'
// Group rows by the prefix before ' — ' or ' - ' so 50 per-claim lines
// collapse into one expandable group per billing service.
const baseServiceName = (desc) => {
  if (!desc) return 'Other';
  const m = String(desc).split(/\s+[—-]\s+/);
  return (m[0] || desc).trim();
};

const InvoiceWizard = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [hospitalId, setHospitalId] = useState('');
  const [tdsRateId, setTdsRateId] = useState('');
  const [month, setMonth] = useState(todayMonth());
  const [notes, setNotes] = useState('');
  const [roundOff, setRoundOff] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [gstRate, setGstRate] = useState('');
  const [preview, setPreview] = useState(null);
  // Editable working copy of the preview lines. Each row carries:
  //   description, amount, lineType, _isManual (true for rows the operator added)
  const [editLines, setEditLines] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  // Groups (lineType+baseServiceName) expanded for inline editing. Collapsed by
  // default so 50+ TPA Desk rows roll up into one summary row.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) =>
    setExpandedGroups((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // [ { key, label, lineType, items: [{ row, idx }] } ] preserving insertion order.
  const lineGroups = useMemo(() => {
    const order = [];
    const map = new Map();
    editLines.forEach((row, idx) => {
      const groupable = row.lineType === 'claim_tpa_desk' || row.lineType === 'service_percentage';
      const key = groupable ? `${row.lineType}::${baseServiceName(row.description)}` : `single::${idx}`;
      if (!map.has(key)) {
        const label = groupable ? baseServiceName(row.description) : row.description;
        map.set(key, { key, label, lineType: row.lineType, items: [], groupable });
        order.push(key);
      }
      map.get(key).items.push({ row, idx });
    });
    return order.map((k) => map.get(k));
  }, [editLines]);

  useEffect(() => {
    getHospitalsAPI({ all: 'true' }).then(({ data }) => {
      const list = Array.isArray(data) ? data : data.hospitals;
      setHospitals((list || []).filter((h) => h.isActive !== false));
    }).catch(() => toast.error('Failed to load hospitals')).finally(() => setLoadingHospitals(false));
    getTdsRatesAPI({ active: 'true' })
      .then(({ data }) => setTdsRates(data || []))
      .catch(() => setTdsRates([]))
      .finally(() => setLoadingTdsRates(false));
  }, []);

  const runPreview = async () => {
    if (!hospitalId || !month) {
      toast.error('Pick a hospital and a month first');
      return;
    }
    setLoading(true);
    setPreview(null);
    setEditLines([]);
    try {
      const { data } = await previewInvoiceAPI({
        hospitalId,
        month: month + '-01',
        tdsRateId: tdsRateId || undefined,
        ...(gstRate !== '' ? { gstRate: Number(gstRate) || 0 } : {}),
      });
      setPreview(data);
      if (gstRate === '') setGstRate(String(data.totals.gstRate ?? 0));
      setEditLines((data.lines || []).map((l) => ({
        description: l.description || '',
        amount: l.amount,
        lineType: l.lineType,
        _isManual: false,
      })));
      if (!data.hasContent) toast.info('No claims or fixed services found — add manual items below.');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  // Live totals computed from the edited rows, applying the preview's GST/TDS rates + discount + roundOff.
  const liveTotals = useMemo(() => {
    if (!preview) return null;
    const sumBy = (types) => editLines.filter((r) => types.includes(r.lineType)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const tpa = sumBy(['claim_tpa_desk', 'service_percentage']);
    const services = sumBy(['service_fixed', 'manual']);
    const adjust = sumBy(['adjustment']);
    const gross = Math.round(tpa + services + adjust);
    // Pre-tax discount: clamped to [0, gross] so a typo can't flip the invoice negative.
    const discountAmt = Math.min(Math.max(0, Math.round(Number(discount) || 0)), gross);
    const taxable = gross - discountAmt;
    const effectiveGst = gstRate === '' ? (preview.totals.gstRate || 0) : (Number(gstRate) || 0);
    const gstAmount = Math.round((taxable * effectiveGst) / 100);
    // TDS base = Taxable + GST (matches backend `calculateInvoiceTotals`).
    const tdsAmount = Math.round(((taxable + gstAmount) * (preview.totals.tdsRate || 0)) / 100);
    const netTotal = taxable + gstAmount - tdsAmount;
    const grandTotal = netTotal + (preview.totals.previousBalance || 0) + (Math.round(Number(roundOff) || 0));
    return {
      tpa: Math.round(tpa),
      services: Math.round(services),
      adjust: Math.round(adjust),
      gross, discount: discountAmt, taxable, gstAmount, tdsAmount, netTotal,
      previousBalance: preview.totals.previousBalance || 0,
      roundOff: Math.round(Number(roundOff) || 0),
      grandTotal,
    };
  }, [editLines, preview, roundOff, discount, gstRate]);

  const create = async () => {
    if (!preview) return;
    if (editLines.length === 0) {
      toast.error('Add at least one line item before saving.');
      return;
    }
    setCreating(true);
    try {
      // Collect manual rows up-front so the create call persists them atomically.
      // Lets the operator bill a month with no claims/services using only manual items.
      const manualItemsForCreate = editLines
        .filter((row) => row._isManual)
        .map((row) => ({ description: row.description || '', amount: Number(row.amount) || 0 }))
        .filter((m) => (m.description || '').trim());

      // 1. Create the draft. The backend builds claim/service lines, then appends manualItems.
      const { data: draft } = await createInvoiceAPI({
        hospitalId,
        month: month + '-01',
        notes,
        tdsRateId: tdsRateId || undefined,
        ...(gstRate !== '' ? { gstRate: Number(gstRate) || 0 } : {}),
        ...(manualItemsForCreate.length ? { manualItems: manualItemsForCreate } : {}),
      });

      // 2. Reconcile any operator edits on built lines + round-off + discount via PATCH.
      //    The create response already includes lineItems with IDs, so no extra GET.
      const lineEdits = [];
      const removedLineIds = [];
      if ((preview.lines || []).length) {
        const origDescByOrder = preview.lines.map((l) => l.description);
        // Built lines only (manual items were appended after; we don't diff them).
        const builtServerLines = (draft.lineItems || []).filter((l) => l.lineType !== 'manual');
        const idsByDesc = new Map();
        builtServerLines.forEach((s) => {
          const key = s.description;
          if (!idsByDesc.has(key)) idsByDesc.set(key, []);
          idsByDesc.get(key).push(s._id || s.id);
        });

        editLines.forEach((row) => {
          if (row._isManual) return; // already persisted on create
          const origDesc = origDescByOrder.shift();
          const queue = idsByDesc.get(origDesc);
          const id = queue?.shift();
          if (!id) return;
          const newDesc = row.description || '';
          const newAmt = Math.round(Number(row.amount) || 0);
          const origAmt = Math.round(Number((preview.lines.find((l) => l.description === origDesc) || {}).amount) || 0);
          if (newDesc !== origDesc || newAmt !== origAmt) {
            lineEdits.push({ id, description: newDesc, amount: newAmt });
          }
        });

        // Any server line whose id was NOT pulled during the edit loop is removed.
        idsByDesc.forEach((queue) => queue.forEach((id) => removedLineIds.push(id)));
      }

      const patchPayload = {};
      if (lineEdits.length) patchPayload.lineEdits = lineEdits;
      if (removedLineIds.length) patchPayload.removedLineIds = removedLineIds;
      if (Number(roundOff) !== 0) patchPayload.roundOff = Math.round(Number(roundOff) || 0);
      if (Number(discount) > 0) patchPayload.discount = Math.round(Number(discount) || 0);

      if (Object.keys(patchPayload).length) {
        await updateInvoiceAPI(draft._id, patchPayload);
      }

      toast.success('Draft invoice created');
      navigate(`/invoices/${draft._id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Create failed');
    } finally {
      setCreating(false);
    }
  };

  const addManualRow = () => {
    setEditLines((rows) => [...rows, { description: '', amount: 0, lineType: 'manual', _isManual: true }]);
  };

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
            <SearchableSelect
              required
              isLoading={loadingHospitals}
              value={hospitalId}
              onChange={(v) => { setHospitalId(v); setPreview(null); setEditLines([]); }}
              placeholder="Select hospital"
              searchPlaceholder="Search hospitals..."
              options={hospitals.map((h) => ({ value: h._id, label: h.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
            <input type="month" value={month}
              onChange={(e) => { setMonth(e.target.value); setPreview(null); setEditLines([]); }}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 text-gray-700" />
          </div>
          <div className="flex items-end">
            <button onClick={runPreview} disabled={loading || !hospitalId || !month}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-primary-600 text-primary-700 hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium rounded-lg transition-colors">
              <HiOutlineSearch className="w-4 h-4" />
              {loading ? 'Loading...' : 'Load Lines'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              GST Rate (%) <span className="text-xs text-gray-400 font-normal">(default from settings)</span>
            </label>
            <input
              type="number" min="0" max="100" step="0.01"
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              placeholder="0"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">TDS Rate (optional)</label>
            <SearchableSelect
              isLoading={loadingTdsRates}
              value={tdsRateId}
              onChange={(v) => { setTdsRateId(v); setPreview(null); setEditLines([]); }}
              placeholder="Use hospital default"
              searchPlaceholder="Search TDS rates..."
              noneLabel="— Use hospital default —"
              allowClear
              options={tdsRates.map((r) => ({
                value: r._id,
                label: `${r.taxName} — ${r.rate}%${r.section ? ` (${r.section})` : ''}`,
              }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note for this invoice"
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
        </div>
      </div>

      {preview && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Line items</h2>
              <p className="text-xs text-gray-400 mt-0.5">Edit any row, add a manual item, then Save Draft.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={addManualRow}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-primary-700 bg-white border border-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                <HiOutlinePlus className="w-4 h-4" /> Add Item
              </button>
              <button onClick={create} disabled={creating || editLines.length === 0}
                className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
                {creating ? 'Saving...' : 'Save Draft'}
              </button>
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-10">#</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-28">Type</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-32">Amount</th>
                  <th className="py-3 px-4 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {editLines.length === 0 ? (
                  <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">No items. Click "Add Item" to add a manual row.</td></tr>
                ) : lineGroups.flatMap((g) => {
                  // Single-row 'group' (e.g. one Fixed service or a manual row) — render flat, no header.
                  if (g.items.length === 1 && !g.groupable) {
                    const { row, idx } = g.items[0];
                    return [(
                      <tr key={`row-${idx}`} className="hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-400 text-xs">{idx + 1}</td>
                        <td className="py-3 px-4">
                          <input value={row.description}
                            onChange={(e) => setEditLines((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                            placeholder="Description"
                            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                        </td>
                        <td className="py-3 px-4">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_PILL(row.lineType)}`}>
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
                  // Multi-row group — collapse into a summary header with expand chevron.
                  const groupTotal = g.items.reduce((a, { row }) => a + (Number(row.amount) || 0), 0);
                  const expanded = expandedGroups.has(g.key);
                  const rows = [(
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
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_PILL(g.lineType)}`}>
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
                      rows.push(
                        <tr key={`row-${idx}`} className="bg-white">
                          <td className="py-2 px-4 text-gray-400 text-xs pl-10">{idx + 1}</td>
                          <td className="py-2 px-4">
                            <input value={row.description}
                              onChange={(e) => setEditLines((arr) => arr.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                              placeholder="Description"
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                          </td>
                          <td className="py-2 px-4" />
                          <td className="py-2 px-4">
                            <input type="number" value={row.amount}
                              onChange={(e) => setEditLines((arr) => arr.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                              className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                          </td>
                          <td className="py-2 px-4 text-right">
                            <button onClick={() => setEditLines((arr) => arr.filter((_, i) => i !== idx))}
                              title="Remove row"
                              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                              <HiOutlineTrash className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    });
                  }
                  return rows;
                })}
              </tbody>
              <tfoot className="bg-gray-50 border-t border-gray-200">
                <tr>
                  <td colSpan={3} className="py-3 px-4 text-right text-xs uppercase text-gray-500 font-semibold">Subtotal</td>
                  <td className="py-3 px-4 text-right font-semibold text-gray-800 tabular-nums">
                    {formatINR(editLines.reduce((a, r) => a + (Number(r.amount) || 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Discount <span className="text-xs text-gray-400 font-normal">(max {formatINR(liveTotals?.gross || 0)})</span>
                </label>
                <input type="number" min="0" max={liveTotals?.gross || 0} value={discount}
                  onChange={(e) => {
                    const cap = liveTotals?.gross || 0;
                    const v = Math.max(0, Math.min(Number(e.target.value) || 0, cap));
                    setDiscount(v);
                  }}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Round Off <span className="text-xs text-gray-400 font-normal">(+/- on Grand Total)</span>
                </label>
                <input type="number" value={roundOff}
                  onChange={(e) => setRoundOff(e.target.value)}
                  placeholder="0"
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>
            {(() => {
              const effGst = gstRate === '' ? (preview.totals.gstRate || 0) : (Number(gstRate) || 0);
              const effTds = preview.totals.tdsRate || 0;
              const tdsSec = preview.totals.tdsSection || '';
              const thisBalance = (liveTotals?.netTotal || 0) + (liveTotals?.roundOff || 0);
              const currentBalance = thisBalance + (liveTotals?.previousBalance || 0);
              return (
                <div className="space-y-1 text-sm text-gray-600">
                  <div className="flex justify-between"><span>Sub Total</span><span className="tabular-nums">{formatINR(liveTotals?.gross || 0)}</span></div>
                  {(liveTotals?.discount || 0) > 0 && (
                    <>
                      <div className="flex justify-between text-green-700">
                        <span>Discount</span>
                        <span className="tabular-nums">- {formatINR(liveTotals?.discount || 0)}</span>
                      </div>
                      <div className="flex justify-between"><span>Taxable Value</span><span className="tabular-nums">{formatINR(liveTotals?.taxable || 0)}</span></div>
                    </>
                  )}
                  {effGst > 0 && (
                    <div className="flex justify-between"><span>GST ({effGst}%)</span><span className="tabular-nums">{formatINR(liveTotals?.gstAmount || 0)}</span></div>
                  )}
                  {(liveTotals?.tdsAmount || 0) > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>TDS@{effTds}%{tdsSec ? `(${tdsSec})` : ''}</span>
                      <span className="tabular-nums">{formatINR(liveTotals?.tdsAmount || 0)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
                    <span>Total</span><span className="tabular-nums">{formatINR(liveTotals?.netTotal || 0)}</span>
                  </div>
                  <div className="flex justify-between"><span>Received</span><span className="tabular-nums">{formatINR(0)}</span></div>
                  <div className="flex justify-between"><span>Balance</span><span className="tabular-nums">{formatINR(thisBalance)}</span></div>
                  <div className="flex justify-between border-t border-gray-200 pt-1 mt-1">
                    <span>Previous Balance</span><span className="tabular-nums">{formatINR(liveTotals?.previousBalance || 0)}</span>
                  </div>
                  <div className={`flex justify-between font-bold ${currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    <span>Current Balance</span><span className="tabular-nums">{formatINR(currentBalance)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-gray-900">
                    <span>Invoice Value Before TDS</span><span className="tabular-nums">{formatINR(liveTotals?.taxable || liveTotals?.gross || 0)}</span>
                  </div>
                  {(liveTotals?.roundOff || 0) !== 0 && (
                    <div className="flex justify-between"><span>Round Off</span><span className="tabular-nums">{formatINR(liveTotals?.roundOff || 0)}</span></div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
};

export default InvoiceWizard;
