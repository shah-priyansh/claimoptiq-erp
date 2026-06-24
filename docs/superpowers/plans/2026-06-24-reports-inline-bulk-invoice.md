# Reports → inline bulk invoice drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the redirect-heavy Bulk Invoice Wizard flow used after "Generate Invoices" on the Claim Reports page with an in-page slide-over drawer that defaults all hospital+month groups to approved.

**Architecture:** Extract reusable bits (`computeTotals`, `commitDraft`, the per-draft editor UI) out of `BulkInvoiceWizard.js` into shared modules. Build a new `BulkInvoiceDrawer` component that uses those shared bits to render all groups as collapsible cards at once. Rewire `Reports.js` to open the drawer instead of navigating away. The legacy `/invoices/bulk/new` route keeps working unchanged for power users.

**Tech Stack:** React 19, react-router-dom, Tailwind, react-toastify, react-icons (`hi` set), `useConfirm` context. No new dependencies. Frontend-only — backend APIs (`previewBulkInvoiceAPI`, `createInvoiceAPI`, `updateInvoiceAPI`, `previewInvoicePdfAPI`) reused as-is.

## Global Constraints

- No backend changes.
- No new npm dependencies.
- The legacy `/invoices/bulk/new` route must keep working after this change.
- The repo has no frontend test suite — verification is manual (dev server + browser).
- Match existing code style: functional React components, Tailwind classes inline, `react-icons/hi` outline icons, `toast` from `react-toastify`.

---

### Task 1: Extract shared utilities into `bulkInvoiceUtils.js`

Pull pure functions and constants out of `BulkInvoiceWizard.js` so both the legacy wizard and the new drawer can reuse them.

**Files:**
- Create: `frontend/src/pages/invoices/bulkInvoiceUtils.js`
- Modify: `frontend/src/pages/invoices/BulkInvoiceWizard.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (all named exports from `bulkInvoiceUtils.js`):
  - `formatINR(n: number) => string` — `'₹' + Math.round...`
  - `monthLabel(m: string | Date) => string` — `'June 2026'`
  - `baseServiceName(desc: string) => string` — group key for TPA Desk rows
  - `LINE_TYPE_LABEL: Record<string, string>` — line-type → display label map
  - `TYPE_PILL(lineType: string) => string` — Tailwind classes for pill
  - `computeTotals(editLines, settings, previewTotals, overrideTds) => totals | null` — same shape as the existing wizard's `computeTotals` (returns `{ tpa, services, adjust, gross, discount, taxable, gstAmount, tdsAmount, netTotal, roundOff, previousBalance, grandTotal, effectiveGst, tdsRate, tdsSection }`)
  - `commitDraft(draft) => Promise<Invoice>` — POSTs `/invoices`, reconciles edits via PATCH, returns the created invoice.

- [ ] **Step 1: Create `bulkInvoiceUtils.js` with all extracted pieces**

Create `frontend/src/pages/invoices/bulkInvoiceUtils.js`:

```js
import { createInvoiceAPI, updateInvoiceAPI } from '../../services/api';

export const formatINR = (n) =>
  '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export const monthLabel = (m) => {
  if (!m) return '-';
  const d = new Date(m);
  return d.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
};

// 'TPA Desk — RAJESH PATEL (CCN-0001)' → 'TPA Desk'
// Group rows by the prefix before ' — ' or ' - ' so 50 per-claim lines
// collapse into one expandable group per billing service.
export const baseServiceName = (desc) => {
  if (!desc) return 'Other';
  const m = String(desc).split(/\s+[—-]\s+/);
  return (m[0] || desc).trim();
};

export const LINE_TYPE_LABEL = {
  claim_tpa_desk: 'TPA Desk',
  service_fixed: 'Fixed',
  service_percentage: 'Variable',
  adjustment: 'Adjustment',
  manual: 'Manual',
};

export const TYPE_PILL = (t) =>
  t === 'claim_tpa_desk' ? 'bg-primary-50 text-primary-700' :
  t === 'service_fixed' ? 'bg-amber-50 text-amber-700' :
  t === 'adjustment' ? 'bg-purple-50 text-purple-700' :
  t === 'manual' ? 'bg-emerald-50 text-emerald-700' :
  'bg-gray-100 text-gray-600';

// Recompute live totals from edited rows + draft settings. When the operator
// overrides TDS via the per-draft dropdown, `overrideTds` carries the picked
// master row so the live totals reflect the new rate without waiting for a
// server re-preview.
export const computeTotals = (editLines, settings, previewTotals, overrideTds) => {
  if (!previewTotals) return null;
  const sumBy = (types) => editLines.filter((r) => types.includes(r.lineType))
    .reduce((a, r) => a + (Number(r.amount) || 0), 0);
  const tpa = sumBy(['claim_tpa_desk', 'service_percentage']);
  const services = sumBy(['service_fixed', 'manual']);
  const adjust = sumBy(['adjustment']);
  const gross = Math.round(tpa + services + adjust);
  const discount = Math.min(Math.max(0, Math.round(Number(settings.discount) || 0)), gross);
  const taxable = gross - discount;
  const effectiveGst = settings.gstRate === '' ? (previewTotals.gstRate || 0) : (Number(settings.gstRate) || 0);
  const gstAmount = Math.round((taxable * effectiveGst) / 100);
  const effectiveTdsRate = overrideTds ? (overrideTds.rate || 0) : (previewTotals.tdsRate || 0);
  const effectiveTdsSection = overrideTds ? (overrideTds.section || '') : (previewTotals.tdsSection || '');
  // TDS base = Taxable + GST (matches backend `calculateInvoiceTotals`).
  const tdsAmount = Math.round(((taxable + gstAmount) * effectiveTdsRate) / 100);
  const netTotal = taxable + gstAmount - tdsAmount;
  const roundOff = Math.round(Number(settings.roundOff) || 0);
  const previousBalance = previewTotals.previousBalance || 0;
  const grandTotal = netTotal + previousBalance + roundOff;
  return {
    tpa: Math.round(tpa), services: Math.round(services), adjust: Math.round(adjust),
    gross, discount, taxable, gstAmount, tdsAmount, netTotal, roundOff, previousBalance, grandTotal,
    effectiveGst, tdsRate: effectiveTdsRate, tdsSection: effectiveTdsSection,
  };
};

// Create one invoice + reconcile edits.
// Single POST when possible: manual items go in the create call, and the
// create response already carries lineItems with IDs (no extra GET round-trip).
export const commitDraft = async (draft) => {
  const monthIso = new Date(draft.month).toISOString().slice(0, 10); // YYYY-MM-DD
  const monthArg = monthIso.slice(0, 7) + '-01';
  const manualItemsForCreate = draft.editLines
    .filter((row) => row._isManual)
    .map((row) => ({ description: row.description || '', amount: Number(row.amount) || 0 }))
    .filter((m) => (m.description || '').trim());

  const { data: created } = await createInvoiceAPI({
    hospitalId: draft.hospitalId,
    month: monthArg,
    notes: draft.settings.notes || '',
    ...(draft.settings.gstRate !== '' ? { gstRate: Number(draft.settings.gstRate) || 0 } : {}),
    ...(draft.settings.tdsRateId ? { tdsRateId: draft.settings.tdsRateId } : {}),
    claimIds: draft.claimIds,
    ...(manualItemsForCreate.length ? { manualItems: manualItemsForCreate } : {}),
  });

  const lineEdits = [];
  const removedLineIds = [];
  if ((draft.previewLines || []).length) {
    const origDescByOrder = draft.previewLines.map((l) => l.description);
    const builtServerLines = (created.lineItems || []).filter((l) => l.lineType !== 'manual');
    const idsByDesc = new Map();
    builtServerLines.forEach((s) => {
      const key = s.description;
      if (!idsByDesc.has(key)) idsByDesc.set(key, []);
      idsByDesc.get(key).push(s._id || s.id);
    });

    draft.editLines.forEach((row) => {
      if (row._isManual) return;
      const origDesc = origDescByOrder.shift();
      const queue = idsByDesc.get(origDesc);
      const id = queue?.shift();
      if (!id) return;
      const newDesc = row.description || '';
      const newAmt = Math.round(Number(row.amount) || 0);
      const origAmt = Math.round(Number((draft.previewLines.find((l) => l.description === origDesc) || {}).amount) || 0);
      if (newDesc !== origDesc || newAmt !== origAmt) {
        lineEdits.push({ id, description: newDesc, amount: newAmt });
      }
    });

    idsByDesc.forEach((queue) => queue.forEach((id) => removedLineIds.push(id)));
  }

  const patchPayload = {};
  if (lineEdits.length) patchPayload.lineEdits = lineEdits;
  if (removedLineIds.length) patchPayload.removedLineIds = removedLineIds;
  if (Number(draft.settings.roundOff) !== 0) patchPayload.roundOff = Math.round(Number(draft.settings.roundOff) || 0);
  if (Number(draft.settings.discount) > 0) patchPayload.discount = Math.max(0, Math.round(Number(draft.settings.discount) || 0));

  if (Object.keys(patchPayload).length) {
    await updateInvoiceAPI(created._id, patchPayload);
  }

  return created;
};
```

- [ ] **Step 2: Replace the local copies in `BulkInvoiceWizard.js` with imports**

In `BulkInvoiceWizard.js`:
- Add at top of imports: `import { formatINR, monthLabel, baseServiceName, LINE_TYPE_LABEL, TYPE_PILL, computeTotals, commitDraft } from './bulkInvoiceUtils';`
- Remove `createInvoiceAPI` and `updateInvoiceAPI` from the `../../services/api` import line (now used only via `commitDraft`). Keep `previewBulkInvoiceAPI`, `getTdsRatesAPI`, `previewInvoicePdfAPI`.
- Delete the in-file `formatINR`, `LINE_TYPE_LABEL`, `TYPE_PILL`, `baseServiceName`, `monthLabel`, `computeTotals` constants/functions (lines ~16–73).
- Delete the in-file `commitDraft` function (lines ~337–395).

- [ ] **Step 3: Verify the wizard still renders**

Run the dev server (see "Manual verification" task at the end for command). Navigate to `/reports/claims`, select claims, click "Generate Invoices" → should still land on `/invoices/bulk/new` and behave identically. Pre-existing behaviour, just refactored imports.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/invoices/bulkInvoiceUtils.js frontend/src/pages/invoices/BulkInvoiceWizard.js
git commit -m "refactor(invoices): extract bulk invoice utils into shared module"
```

---

### Task 2: Extract `BulkInvoiceDraftEditor` component

Pull the per-draft edit UI (settings grid + line items table + totals panel) out of `BulkInvoiceWizard.js` so the new drawer can render the same editor inside each expanded card.

**Files:**
- Create: `frontend/src/pages/invoices/BulkInvoiceDraftEditor.js`
- Modify: `frontend/src/pages/invoices/BulkInvoiceWizard.js`

**Interfaces:**
- Consumes: `bulkInvoiceUtils.js` exports from Task 1.
- Produces (default export):
  - `<BulkInvoiceDraftEditor draft tdsRates loadingTdsRates onChange />`
    - `draft`: same shape as the wizard's draft objects (`{ previewTotals, previewLines, editLines, settings, ... }`).
    - `tdsRates: Array`, `loadingTdsRates: boolean`.
    - `onChange(patch)` is called with `{ editLines?, settings? }` partial updates.
  - Does NOT render the hospital name / month / approve-status badge / preview button / footer nav — those belong to the wrapping page (wizard) or card (drawer).

- [ ] **Step 1: Create `BulkInvoiceDraftEditor.js`**

Create `frontend/src/pages/invoices/BulkInvoiceDraftEditor.js`:

```js
import React, { useMemo, useState } from 'react';
import {
  HiOutlinePlus, HiOutlineTrash, HiChevronRight, HiChevronDown,
} from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';
import {
  formatINR, baseServiceName, LINE_TYPE_LABEL, TYPE_PILL, computeTotals,
} from './bulkInvoiceUtils';

// Renders the per-draft editor: settings grid + line items table + totals panel.
// Caller owns the surrounding card / page chrome (hospital name, status badges,
// preview button, footer nav). All edits flow back via `onChange({ editLines?,
// settings? })`.
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
```

- [ ] **Step 2: Use the new editor inside `BulkInvoiceWizard.js`**

In `BulkInvoiceWizard.js`:
- Add `import BulkInvoiceDraftEditor from './BulkInvoiceDraftEditor';`
- Inside the `reviewing` phase render, REPLACE everything from `{/* Settings row */}` down to (and including) the closing `{/* Totals */}` block — i.e. the settings grid, lines section, and totals panel — with:

```jsx
<div className="mt-4">
  <BulkInvoiceDraftEditor
    draft={current}
    tdsRates={tdsRates}
    loadingTdsRates={loadingTdsRates}
    onChange={(patch) => updateDraft(currentIdx, patch)}
  />
</div>
```

- Delete the now-unused: `lineGroups` memo, `expandedGroups` state + `toggleGroup` / `isExpanded` helpers, `addManualRow`, `updateCurrentLines`, `updateCurrentSettings`, `liveTotals` memo (the editor computes its own).
- Keep `updateDraft` — it's still used for `status` changes (approve/reject) and for the editor's `onChange`.
- Remove unused imports from the icon set after deletion: `HiOutlinePlus`, `HiOutlineTrash`, `HiChevronRight`, `HiChevronDown` (still used elsewhere? grep first — they ARE used in the editor file, but in the wizard they were only inside the deleted block).

- [ ] **Step 3: Verify the wizard still renders correctly**

Same manual check as Task 1: navigate `/reports/claims` → select claims → "Generate Invoices" → wizard reviewing phase should look identical (settings, line items collapse groups, totals).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/invoices/BulkInvoiceDraftEditor.js frontend/src/pages/invoices/BulkInvoiceWizard.js
git commit -m "refactor(invoices): extract BulkInvoiceDraftEditor component"
```

---

### Task 3: Build `BulkInvoiceDrawer`

The new in-page slide-over. All hospital+month groups default-approved as collapsible cards.

**Files:**
- Create: `frontend/src/pages/invoices/BulkInvoiceDrawer.js`

**Interfaces:**
- Consumes: `bulkInvoiceUtils.js`, `BulkInvoiceDraftEditor`, `previewBulkInvoiceAPI`, `getTdsRatesAPI`, `previewInvoicePdfAPI` from `../../services/api`, `useConfirm` from `../../context/ConfirmContext`.
- Produces (default export):
  - `<BulkInvoiceDrawer open claimIds onClose onGenerated />`
    - `open: boolean`
    - `claimIds: string[]`
    - `onClose(): void`
    - `onGenerated(results: Array<{ ok, invoice?, error? }>): void` — fired after a successful all-OK generation right before the drawer closes itself.

- [ ] **Step 1: Create the file**

Create `frontend/src/pages/invoices/BulkInvoiceDrawer.js`:

```js
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineX, HiOutlineEye, HiOutlinePrinter, HiOutlineDownload,
  HiOutlineArrowLeft, HiOutlineArrowRight, HiChevronDown, HiChevronRight,
} from 'react-icons/hi';
import {
  previewBulkInvoiceAPI, getTdsRatesAPI, previewInvoicePdfAPI,
} from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import {
  formatINR, monthLabel, computeTotals, commitDraft,
} from './bulkInvoiceUtils';
import BulkInvoiceDraftEditor from './BulkInvoiceDraftEditor';

// Build initial draft state from a single preview group. Mirrors the shape
// the editor + commitDraft expect.
const draftFromPreview = (p) => ({
  hospitalId: p.hospitalId,
  hospital: p.hospital,
  month: p.month,
  claimIds: p.claimIds,
  existingInvoice: p.existingInvoice,
  previewTotals: p.totals,
  previewLines: p.lines || [],
  editLines: (p.lines || []).map((l) => ({
    description: l.description || '',
    amount: l.amount,
    lineType: l.lineType,
    _isManual: false,
  })),
  settings: {
    gstRate: String(p.totals?.gstRate ?? 0),
    tdsRateId: '',
    notes: '',
    roundOff: 0,
    discount: 0,
  },
  // Selection + tracking state (drawer-specific):
  approved: !p.existingInvoice, // existing-invoice rows start unchecked
  edited: false,                // flips true on any user edit
  status: 'pending',            // pending | success | failed
  error: '',                    // populated on a failed commit
  invoice: null,                // populated on a successful commit
});

const BulkInvoiceDrawer = ({ open, claimIds, onClose, onGenerated }) => {
  const confirm = useConfirm();

  const [phase, setPhase] = useState('loading'); // loading | reviewing | generating | empty
  const [drafts, setDrafts] = useState([]);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [skipped, setSkipped] = useState([]);
  const [skippedDismissed, setSkippedDismissed] = useState(false);
  const [expanded, setExpanded] = useState({}); // { [draftIdx]: bool }
  const [progress, setProgress] = useState(0);

  // PDF preview modal state — same pattern as the wizard.
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Reset drawer state every time it opens.
  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setDrafts([]);
    setSkipped([]);
    setSkippedDismissed(false);
    setExpanded({});
    setProgress(0);
    setPreviewIdx(null);
    if (pdfBlobUrl) { URL.revokeObjectURL(pdfBlobUrl); }
    setPdfBlobUrl(null);
    setPdfError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load TDS rates once.
  useEffect(() => {
    getTdsRatesAPI({ active: 'true' })
      .then(({ data }) => setTdsRates(data || []))
      .catch(() => setTdsRates([]))
      .finally(() => setLoadingTdsRates(false));
  }, []);

  // Fetch previews when the drawer opens with a non-empty claim list.
  useEffect(() => {
    if (!open || !claimIds?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await previewBulkInvoiceAPI({ claimIds });
        if (cancelled) return;
        const previews = data.previews || [];
        setSkipped(data.skipped || []);
        if (!previews.length) {
          setPhase('empty');
          return;
        }
        setDrafts(previews.map(draftFromPreview));
        setPhase('reviewing');
      } catch (e) {
        if (cancelled) return;
        const baseMsg = e.response?.data?.message || 'Failed to load previews';
        toast.error(baseMsg);
        onClose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimIds]);

  const approvedDrafts = useMemo(
    () => drafts.filter((d) => d.approved && d.status !== 'success'),
    [drafts],
  );
  const approvedTotal = useMemo(() => approvedDrafts.reduce((s, d) => {
    const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
    const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
    return s + (t?.grandTotal || 0);
  }, 0), [approvedDrafts, tdsRates]);

  const hasEdits = drafts.some((d) => d.edited);

  const updateDraft = (idx, patch) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  // Patch handler for the editor — also flips `edited: true` so the discard
  // guard knows the user has touched something.
  const handleEditorChange = (idx) => (patch) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...patch, edited: true } : d));
  };

  const toggleExpanded = (idx) =>
    setExpanded((s) => ({ ...s, [idx]: !s[idx] }));

  const toggleApproved = (idx) =>
    updateDraft(idx, { approved: !drafts[idx].approved });

  const handleClose = async () => {
    if (phase === 'generating') return; // cannot close mid-generate
    if (hasEdits && phase === 'reviewing') {
      const ok = await confirm(
        `Discard unsaved edits on ${drafts.filter((d) => d.edited).length} draft(s)? Approvals and line changes will be lost.`,
        { title: 'Discard Drafts', confirmLabel: 'Discard', variant: 'danger' },
      );
      if (!ok) return;
    }
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    onClose();
  };

  const handleGenerate = async () => {
    const targets = drafts
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.approved && d.status !== 'success');
    if (!targets.length) {
      toast.error('No invoices to generate. Tick at least one card.');
      return;
    }
    setPhase('generating');
    setProgress(0);
    let allOk = true;
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const { d, idx } = targets[i];
      try {
        const inv = await commitDraft(d);
        updateDraft(idx, { status: 'success', invoice: inv, error: '' });
        results.push({ ok: true, invoice: inv });
      } catch (e) {
        const msg = e.response?.data?.message || e.message || 'Failed';
        updateDraft(idx, { status: 'failed', error: msg });
        results.push({ ok: false, error: msg });
        allOk = false;
      }
      setProgress(i + 1);
    }
    if (allOk) {
      toast.success(`${results.length} invoice${results.length === 1 ? '' : 's'} created`);
      if (onGenerated) onGenerated(results);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      onClose();
      return;
    }
    // Partial failure — stay open so the operator can retry the failed cards.
    setPhase('reviewing');
    const okCount = results.filter((r) => r.ok).length;
    toast.warn(`${okCount} of ${results.length} invoices created — fix the failed ones and retry.`);
  };

  // ── PDF preview ────────────────────────────────────────────────────────────
  const openPreviewAt = async (idx) => {
    if (idx == null || idx < 0 || idx >= drafts.length) return;
    setPreviewIdx(idx);
    setPdfError('');
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPdfLoading(true);
    const draft = drafts[idx];
    try {
      const monthIso = new Date(draft.month).toISOString().slice(0, 10);
      const monthArg = monthIso.slice(0, 7) + '-01';
      const { data } = await previewInvoicePdfAPI({
        hospitalId: draft.hospitalId,
        month: monthArg,
        lines: draft.editLines.map((l) => ({
          description: l.description,
          amount: Number(l.amount) || 0,
          lineType: l.lineType,
        })),
        ...(draft.settings.gstRate !== '' ? { gstRate: Number(draft.settings.gstRate) || 0 } : {}),
        ...(draft.settings.tdsRateId ? { tdsRateId: draft.settings.tdsRateId } : {}),
        roundOff: Number(draft.settings.roundOff) || 0,
        discount: Math.max(0, Math.round(Number(draft.settings.discount) || 0)),
        notes: draft.settings.notes || '',
      });
      const url = URL.createObjectURL(data);
      setPdfBlobUrl(url);
    } catch (e) {
      setPdfError(e.response?.data?.message || 'Failed to render preview PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const closePreview = () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPreviewIdx(null);
    setPdfError('');
  };

  const printPreview = () => {
    const iframe = document.getElementById('drawer-preview-pdf-iframe');
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch {
      if (pdfBlobUrl) window.open(pdfBlobUrl, '_blank');
    }
  };

  const downloadPreview = () => {
    const draft = previewIdx != null ? drafts[previewIdx] : null;
    if (!pdfBlobUrl || !draft) return;
    const safe = (draft.hospital?.name || 'invoice').replace(/[^a-zA-Z0-9]+/g, '_');
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `Preview-${safe}-${monthLabel(draft.month).replace(/\s+/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!open) return null;

  const previewDraft = previewIdx != null ? drafts[previewIdx] : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={handleClose}
      />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">
              {phase === 'reviewing'
                ? `Generate ${approvedDrafts.length} Invoice${approvedDrafts.length === 1 ? '' : 's'}`
                : phase === 'generating'
                  ? 'Generating Invoices…'
                  : phase === 'empty'
                    ? 'Nothing to bill'
                    : 'Loading previews…'}
            </h2>
            {phase === 'reviewing' && drafts.length > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                {drafts.length} hospital{drafts.length === 1 ? '' : 's'} • tick to include, expand to edit
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={phase === 'generating'}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Close"
          >
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'loading' && (
            <div className="py-16 text-center text-gray-500 text-sm">Loading previews…</div>
          )}

          {phase === 'empty' && (
            <div className="py-12 text-center">
              <p className="text-gray-700 font-medium">No billable invoices.</p>
              <p className="text-sm text-gray-500 mt-1">
                All {skipped.length} selected claim{skipped.length === 1 ? ' was' : 's were'} skipped
                (rejected, cancelled, already billed, or missing a discharge date).
              </p>
            </div>
          )}

          {(phase === 'reviewing' || phase === 'generating') && (
            <>
              {/* Skipped banner */}
              {skipped.length > 0 && !skippedDismissed && (
                <div className="flex items-start gap-3 p-3 mb-3 border border-amber-200 bg-amber-50 rounded-lg">
                  <div className="flex-1 text-sm text-amber-900">
                    <p className="font-medium">
                      {skipped.length} claim{skipped.length === 1 ? '' : 's'} skipped
                    </p>
                    <p className="text-xs text-amber-800 mt-1">
                      {skipped.slice(0, 6).map((s) => `#${s.srNo || ''} ${s.patientName || '-'} (${s.reason})`).join(', ')}
                      {skipped.length > 6 ? `, and ${skipped.length - 6} more` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setSkippedDismissed(true)}
                    className="p-1 text-amber-700 hover:bg-amber-100 rounded"
                    title="Dismiss"
                  >
                    <HiOutlineX className="w-4 h-4" />
                  </button>
                </div>
              )}

              {/* Generating progress bar */}
              {phase === 'generating' && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{progress} of {approvedDrafts.length}</span>
                    <span>
                      {approvedDrafts.length ? Math.round((progress / approvedDrafts.length) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-600 transition-all"
                      style={{ width: `${approvedDrafts.length ? (progress / approvedDrafts.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cards */}
              <div className="space-y-3">
                {drafts.map((d, idx) => {
                  const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
                  const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
                  const isExpanded = !!expanded[idx];
                  const claimCount = d.claimIds.length;
                  const disabled = phase === 'generating' || d.status === 'success';
                  return (
                    <div
                      key={`${d.hospitalId}-${d.month}-${idx}`}
                      className={`rounded-xl border ${
                        d.status === 'success' ? 'border-green-200 bg-green-50/30' :
                        d.status === 'failed' ? 'border-red-200 bg-red-50/30' :
                        d.approved ? 'border-primary-200 bg-white' :
                        'border-gray-200 bg-gray-50/40'
                      }`}
                    >
                      {/* Card header */}
                      <div className="flex items-start gap-3 p-4">
                        <input
                          type="checkbox"
                          checked={d.approved}
                          onChange={() => toggleApproved(idx)}
                          disabled={disabled}
                          className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 truncate">{d.hospital?.name || '-'}</h3>
                            <span className="text-sm text-gray-500">— {monthLabel(d.month)}</span>
                            {d.edited && d.status === 'pending' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">edited</span>
                            )}
                            {d.status === 'success' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                created {d.invoice?.invoiceNumber || ''}
                              </span>
                            )}
                            {d.status === 'failed' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">failed</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1 tabular-nums">
                            {claimCount} claim{claimCount === 1 ? '' : 's'} · {formatINR(t?.grandTotal || 0)}
                            {t?.effectiveGst > 0 && <> · GST {t.effectiveGst}%</>}
                            {t?.tdsRate > 0 && <> · TDS {t.tdsRate}%</>}
                          </p>
                          {d.existingInvoice && (
                            <p className="text-xs text-amber-800 mt-2 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded">
                              Existing {d.existingInvoice.status} invoice {d.existingInvoice.invoiceNumber || ''} —{' '}
                              <Link
                                to={`/invoices/${d.existingInvoice._id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-amber-900"
                              >
                                view existing
                              </Link>
                            </p>
                          )}
                          {d.status === 'failed' && (
                            <p className="text-xs text-red-700 mt-2">{d.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openPreviewAt(idx)}
                            disabled={disabled}
                            className="p-1.5 text-gray-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg disabled:opacity-40"
                            title="Preview PDF"
                          >
                            <HiOutlineEye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleExpanded(idx)}
                            disabled={disabled}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-40"
                            title={isExpanded ? 'Collapse' : 'Edit'}
                          >
                            {isExpanded
                              ? <HiChevronDown className="w-4 h-4" />
                              : <HiChevronRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {/* Expanded editor */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 pt-4 pb-4">
                          <BulkInvoiceDraftEditor
                            draft={d}
                            tdsRates={tdsRates}
                            loadingTdsRates={loadingTdsRates}
                            onChange={handleEditorChange(idx)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'loading' && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200 shrink-0 bg-white">
            {phase === 'empty' ? (
              <button
                onClick={handleClose}
                className="ml-auto px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
              >
                Close
              </button>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900 tabular-nums">{formatINR(approvedTotal)}</span>
                  {' '}across {approvedDrafts.length} invoice{approvedDrafts.length === 1 ? '' : 's'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClose}
                    disabled={phase === 'generating'}
                    className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={phase === 'generating' || approvedDrafts.length === 0}
                    className="px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium"
                  >
                    {phase === 'generating'
                      ? `Generating ${progress}/${approvedDrafts.length}…`
                      : `Generate ${approvedDrafts.length} Invoice${approvedDrafts.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* PDF preview modal (z-index above the drawer) */}
      {previewDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => openPreviewAt(previewIdx - 1)}
                  disabled={previewIdx <= 0 || pdfLoading}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous"
                >
                  <HiOutlineArrowLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openPreviewAt(previewIdx + 1)}
                  disabled={previewIdx >= drafts.length - 1 || pdfLoading}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next"
                >
                  <HiOutlineArrowRight className="w-4 h-4" />
                </button>
                <div className="min-w-0 ml-1">
                  <h3 className="text-base font-semibold text-gray-900 truncate">
                    Invoice Preview — {previewDraft.hospital?.name}
                  </h3>
                  <p className="text-xs text-gray-500 truncate">
                    Draft {previewIdx + 1} of {drafts.length} • {monthLabel(previewDraft.month)} • {previewDraft.claimIds.length} claim{previewDraft.claimIds.length === 1 ? '' : 's'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={printPreview}
                  disabled={!pdfBlobUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg"
                >
                  <HiOutlinePrinter className="w-4 h-4" /> Print
                </button>
                <button
                  onClick={downloadPreview}
                  disabled={!pdfBlobUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg"
                >
                  <HiOutlineDownload className="w-4 h-4" /> Download
                </button>
                <button
                  onClick={closePreview}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                  title="Close"
                >
                  <HiOutlineX className="w-5 h-5" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-gray-100 overflow-hidden">
              {pdfLoading && (
                <div className="h-full flex items-center justify-center text-gray-500 text-sm">Rendering PDF…</div>
              )}
              {pdfError && (
                <div className="h-full flex items-center justify-center p-6 text-center">
                  <div>
                    <p className="text-red-600 font-medium">{pdfError}</p>
                    <button
                      onClick={() => openPreviewAt(previewIdx)}
                      className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              )}
              {pdfBlobUrl && !pdfLoading && !pdfError && (
                <iframe
                  id="drawer-preview-pdf-iframe"
                  src={pdfBlobUrl}
                  title="Invoice preview"
                  className="w-full h-full border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkInvoiceDrawer;
```

- [ ] **Step 2: Commit (without wiring yet)**

```bash
git add frontend/src/pages/invoices/BulkInvoiceDrawer.js
git commit -m "feat(invoices): add BulkInvoiceDrawer component"
```

---

### Task 4: Wire `Reports.js` to open the drawer

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

**Interfaces:**
- Consumes: `BulkInvoiceDrawer` from `../invoices/BulkInvoiceDrawer`.
- Produces: nothing.

- [ ] **Step 1: Add the import and drawer state**

In `Reports.js`, add the import (alphabetical, near the other invoice-related import on line 11):

```js
import BulkInvoiceDrawer from '../invoices/BulkInvoiceDrawer';
```

Add a state hook near the other `useState` declarations (next to `selectedClaimIds` / `billMode`):

```js
const [drawerOpen, setDrawerOpen] = useState(false);
const [drawerClaimIds, setDrawerClaimIds] = useState([]);
```

- [ ] **Step 2: Rewire `handleGenerateInvoices`**

Replace the body of `handleGenerateInvoices` (currently lines ~326-329) with:

```js
const handleGenerateInvoices = () => {
  if (!selectedClaimIds.length) return;
  // Open the in-page drawer instead of navigating away. Snapshot the
  // selection so toggling rows on the report doesn't drift the drawer's
  // working set mid-batch.
  setDrawerClaimIds([...selectedClaimIds]);
  setDrawerOpen(true);
};
```

You can now also remove the `useNavigate` usage for this specific call (keep the hook itself — it's still used elsewhere in Reports.js, e.g. `navigate(...)` for other actions if any; grep `navigate(` in this file first and don't remove the import if it's still used).

- [ ] **Step 3: Mount the drawer at the bottom of the JSX**

In the JSX return of `Reports`, add immediately before the final closing `</div>` of the page wrapper:

```jsx
<BulkInvoiceDrawer
  open={drawerOpen}
  claimIds={drawerClaimIds}
  onClose={() => setDrawerOpen(false)}
  onGenerated={() => {
    // Clear bill-mode selection + exit bill mode on full success so the
    // operator is back to a clean reports view.
    setSelectedClaimIds([]);
    setBillMode(false);
  }}
/>
```

- [ ] **Step 4: Manual verify the full flow**

Start the dev server:

```bash
cd frontend && npm start
```

In another shell start the backend (if not already running):

```bash
cd backend && npm run dev
```

Log in as `admin@claimoptiq.com` / `Test@123`. Navigate to **Reports → Claim Report**. Click **Generate Bill**, select 2+ claims spanning at least 2 hospitals if possible, click **Generate Invoices**.

Verify:
- The page does NOT redirect — the URL stays at `/reports/claims`.
- A right-side drawer slides in showing one card per hospital+month group.
- All cards have their checkbox ticked by default (☑) unless they map to an existing invoice (☐ + amber banner).
- The footer shows the live total and a `Generate N Invoices` button.
- Untick one card → footer count and total update.
- Expand a card via the chevron → editor inline; change an amount → totals on card header update; "edited" amber pill appears.
- Click the eye icon on a card → PDF preview modal opens; close it → drawer state intact.
- Click `Generate` → progress bar advances; on success a toast fires and the drawer closes; you land back on Reports with bill-mode cleared.
- Click the `X` after editing a card → confirm dialog appears, click Cancel → drawer stays; click Discard → drawer closes.
- Re-open `/invoices/bulk/new` directly via URL → legacy wizard still works.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat(reports): open BulkInvoiceDrawer instead of redirecting to wizard"
```

---

### Task 5: Final sweep

- [ ] **Step 1: Lint / build sanity**

```bash
cd frontend && npm run build
```

Expected: build succeeds with no new warnings about unused imports. (Existing warnings are fine.)

- [ ] **Step 2: Confirm legacy wizard unchanged behaviourally**

In the browser, visit `/invoices/bulk/new` (direct URL — there's no UI entry left for it but the route still works). Without any router state it'll redirect to `/reports/claims` (existing behaviour from line 124-128 of `BulkInvoiceWizard.js`). That's fine — the route exists for power users who navigate via router state.

- [ ] **Step 3: Push for review**

No additional commit needed if build was clean.
