import React, { useMemo, useState } from 'react';
import {
  HiOutlinePlus, HiOutlineTrash, HiChevronRight, HiChevronDown,
} from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';
import {
  formatINR, baseServiceName, LINE_TYPE_LABEL, TYPE_PILL, computeTotals,
} from './bulkInvoiceUtils';

// Renders the per-draft editor: settings grid + line items table + totals
// panel. Caller owns the surrounding card / page chrome (hospital name,
// status badges, preview button, footer nav). All edits flow back via
// `onChange({ editLines?, settings? })`.
const BulkInvoiceDraftEditor = ({ draft, tdsRates, loadingTdsRates, onChange }) => {
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const toggleGroup = (key) =>
    setExpandedGroups((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const updateSettings = (patch) =>
    onChange({ settings: { ...draft.settings, ...patch } });
  const updateLines = (mut) =>
    onChange({ editLines: typeof mut === 'function' ? mut(draft.editLines) : mut });
  const addManualRow = () =>
    updateLines((rows) => [...rows, { description: '', amount: 0, lineType: 'manual', _isManual: true }]);

  const overrideTds = draft.settings.tdsRateId
    ? tdsRates.find((r) => r._id === draft.settings.tdsRateId) || null
    : null;
  const liveTotals = useMemo(
    () => computeTotals(draft.editLines, draft.settings, draft.previewTotals, overrideTds),
    [draft.editLines, draft.settings, draft.previewTotals, overrideTds],
  );

  const lineGroups = useMemo(() => {
    const order = [];
    const map = new Map();
    draft.editLines.forEach((row, idx) => {
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
  }, [draft.editLines]);

  return (
    <>
      {/* Settings row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">GST Rate (%)</label>
          <input
            type="number" min="0" max="100" step="0.01"
            value={draft.settings.gstRate}
            onChange={(e) => updateSettings({ gstRate: e.target.value })}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">TDS Rate (optional)</label>
          <SearchableSelect
            isLoading={loadingTdsRates}
            value={draft.settings.tdsRateId}
            onChange={(v) => updateSettings({ tdsRateId: v })}
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Discount <span className="text-xs text-gray-400 font-normal">(max {formatINR(liveTotals?.gross || 0)})</span>
          </label>
          <input
            type="number" min="0" max={liveTotals?.gross || 0}
            value={draft.settings.discount}
            onChange={(e) => {
              const cap = liveTotals?.gross || 0;
              const v = Math.max(0, Math.min(Number(e.target.value) || 0, cap));
              updateSettings({ discount: v });
            }}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Round Off (+/-)</label>
          <input
            type="number"
            value={draft.settings.roundOff}
            onChange={(e) => updateSettings({ roundOff: e.target.value })}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <input
            value={draft.settings.notes}
            onChange={(e) => updateSettings({ notes: e.target.value })}
            placeholder="Internal note for this invoice"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>
      </div>

      {/* Lines header */}
      <div className="flex items-center justify-between mt-5 mb-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">Line items</h3>
          <p className="text-xs text-gray-400 mt-0.5">Edit rows or add manual items.</p>
        </div>
        <button onClick={addManualRow} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-primary-700 bg-white border border-primary-600 hover:bg-primary-50 rounded-lg">
          <HiOutlinePlus className="w-4 h-4" /> Add Item
        </button>
      </div>

      {/* Lines table */}
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-10">#</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-28">Type</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-32">Amount</th>
              <th className="py-3 px-4 w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {draft.editLines.length === 0 ? (
              <tr><td colSpan={5} className="py-6 text-center text-sm text-gray-400">No items. Click "Add Item" to add a manual row.</td></tr>
            ) : lineGroups.flatMap((g) => {
              if (g.items.length === 1 && !g.groupable) {
                const { row, idx } = g.items[0];
                return [(
                  <tr key={`row-${idx}`} className="hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-400 text-xs">{idx + 1}</td>
                    <td className="py-3 px-4">
                      <input value={row.description}
                        onChange={(e) => updateLines((rows) => rows.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
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
                        onChange={(e) => updateLines((rows) => rows.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => updateLines((rows) => rows.filter((_, i) => i !== idx))}
                        title="Remove row" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )];
              }
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
                  <td className="py-3 px-4 text-right font-semibold text-gray-800 tabular-nums">{formatINR(groupTotal)}</td>
                  <td className="py-3 px-4 text-right text-xs text-gray-400">{expanded ? 'hide' : 'show'}</td>
                </tr>
              )];
              if (expanded) {
                g.items.forEach(({ row, idx }) => {
                  rows.push(
                    <tr key={`row-${idx}`} className="bg-white">
                      <td className="py-2 px-4 text-gray-400 text-xs pl-10">{idx + 1}</td>
                      <td className="py-2 px-4">
                        <input value={row.description}
                          onChange={(e) => updateLines((arr) => arr.map((r, i) => i === idx ? { ...r, description: e.target.value } : r))}
                          placeholder="Description"
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-2 px-4" />
                      <td className="py-2 px-4">
                        <input type="number" value={row.amount}
                          onChange={(e) => updateLines((arr) => arr.map((r, i) => i === idx ? { ...r, amount: e.target.value } : r))}
                          className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right tabular-nums focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </td>
                      <td className="py-2 px-4 text-right">
                        <button onClick={() => updateLines((arr) => arr.filter((_, i) => i !== idx))}
                          title="Remove row" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
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
                {formatINR(draft.editLines.reduce((a, r) => a + (Number(r.amount) || 0), 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Totals */}
      {liveTotals && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-5">
          <div />
          <div className="space-y-1 text-sm text-gray-600">
            <div className="flex justify-between"><span>Sub Total</span><span className="tabular-nums">{formatINR(liveTotals.gross)}</span></div>
            {liveTotals.discount > 0 && (
              <>
                <div className="flex justify-between text-green-700">
                  <span>Discount</span>
                  <span className="tabular-nums">- {formatINR(liveTotals.discount)}</span>
                </div>
                <div className="flex justify-between"><span>Taxable Value</span><span className="tabular-nums">{formatINR(liveTotals.taxable)}</span></div>
              </>
            )}
            {liveTotals.effectiveGst > 0 && (
              <div className="flex justify-between"><span>GST ({liveTotals.effectiveGst}%)</span><span className="tabular-nums">{formatINR(liveTotals.gstAmount)}</span></div>
            )}
            {liveTotals.tdsAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>TDS@{liveTotals.tdsRate}%{liveTotals.tdsSection ? `(${liveTotals.tdsSection})` : ''}</span>
                <span className="tabular-nums">{formatINR(liveTotals.tdsAmount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-gray-900 border-t border-gray-200 pt-1 mt-1">
              <span>Net Total</span><span className="tabular-nums">{formatINR(liveTotals.netTotal)}</span>
            </div>
            {liveTotals.previousBalance > 0 && (
              <div className="flex justify-between"><span>Previous Balance</span><span className="tabular-nums">{formatINR(liveTotals.previousBalance)}</span></div>
            )}
            {liveTotals.roundOff !== 0 && (
              <div className="flex justify-between"><span>Round Off</span><span className="tabular-nums">{formatINR(liveTotals.roundOff)}</span></div>
            )}
            <div className="flex justify-between font-bold text-primary-700 border-t border-gray-200 pt-1 mt-1">
              <span>Grand Total</span><span className="tabular-nums">{formatINR(liveTotals.grandTotal)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkInvoiceDraftEditor;
