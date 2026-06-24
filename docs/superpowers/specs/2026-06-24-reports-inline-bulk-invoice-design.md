---
name: Reports → inline bulk invoice drawer
date: 2026-06-24
status: design
---

# Reports → inline bulk invoice drawer

## Problem

FCC staff create invoices mostly from the Claim Reports page (`/reports/claims`),
but the current flow is heavy:

- Click "Generate Bill" → "Generate Invoices" → **page redirect** to
  `/invoices/bulk/new`.
- The Bulk Invoice Wizard then forces a **per-draft sequential walk-through**
  (next / approve / next / approve…). A 5-hospital batch = 10+ clicks before
  the operator can even press Generate.
- After the last draft, the wizard auto-opens a **forced PDF preview modal**
  the operator must dismiss before continuing.
- After generation, the operator lands on a "Done" results screen inside the
  wizard, not back on the Reports page where they were working — requiring
  an extra "Back to Reports" click.

End-to-end: ~12–15 clicks + 1 page redirect (Reports → Wizard) + 1 forced
modal for a single batch.

## Goal

Cut the common path to **≤ 3 clicks, zero redirects, zero forced modals**,
while preserving the ability to edit a draft before it commits.

## Non-goals

- Removing or rewriting the standalone single-invoice flow at `/invoices/new`.
- Touching the InvoiceList / InvoiceDetail / payment flow.
- Backend changes. All endpoints (`/invoices/preview-bulk`, `/invoices`,
  `/invoices/:id` PATCH, `/invoices/preview-pdf`) stay as-is.
- Removing the existing `BulkInvoiceWizard.js` page. It stays reachable at
  `/invoices/bulk/new` (sidebar / direct URL) so power users keep the option.
  The Reports-page button just stops using it.

## Design

### Entry point

`Reports.js` already has bill-mode and a "Generate Invoices" button at
`handleGenerateInvoices`. Today it does `navigate('/invoices/bulk/new', { state })`.

Change `handleGenerateInvoices` to instead open a new `BulkInvoiceDrawer`
component as an in-page right-side slide-over, passing the same `claimIds`
array as a prop.

### Drawer component: `BulkInvoiceDrawer`

New file: `frontend/src/pages/invoices/BulkInvoiceDrawer.js`.

Props:
- `open: boolean`
- `claimIds: string[]`
- `onClose(): void` — called on dismiss or after successful generation.
- `onGenerated(results): void` — optional; lets Reports know to clear
  bill-mode selection on success.

### Drawer phases

The drawer manages its own state across three phases:

1. **`loading`** — show a spinner while `previewBulkInvoiceAPI({ claimIds })`
   resolves. On error, toast and close.
2. **`reviewing`** — list of draft cards, the main UX (below).
3. **`generating`** — overlay showing a progress bar `n / N created`. The
   per-card commit is sequential (mirrors today's behaviour) so a partial
   failure stops cleanly.

After phase `generating` finishes:
- All-success: toast `N invoices created` and call `onClose()` +
  `onGenerated(results)`. Reports clears bill-mode and stays put.
- Partial failure: keep the drawer open, replace each failed card with an
  inline error + "Retry" button. The operator can fix and click Generate
  again; successful cards are removed so they don't double-commit.

### Card list (reviewing phase)

Each preview group from `previewBulkInvoiceAPI` becomes one card. Cards are
default-approved (checkbox ☑). Collapsed view shows everything the operator
typically needs:

```
┌──────────────────────────────────────────────────┐
│ ☑  Apollo Hospital — Jun 2026         ▾ Edit   │
│    12 claims · ₹1,24,500 (incl. GST {gst}%, TDS {tds}%)│
└──────────────────────────────────────────────────┘
```

- Top-right card actions: ▾ (expand to edit) and **Preview PDF** (opens the
  same `previewInvoicePdfAPI` modal the wizard uses — reused, not
  re-implemented). Optional, never forced.
- Existing-invoice warning: if `preview.existingInvoice` is set, the card
  shows an amber "Already invoiced — click to view existing" banner and
  defaults the checkbox to **off**.

Expanding a card (▾) reveals the same edit table currently in
`BulkInvoiceWizard`: grouped collapsible line items, GST / TDS picker /
discount / round-off / notes inputs, and live totals. We extract this into
a shared `<BulkInvoiceDraftEditor>` component used by both the new drawer
and the existing wizard so we don't fork the calculation logic.

Card status indicator:
- Approved (☑) — included in batch.
- Unchecked — excluded.
- Edited (any inline change) — small "edited" pill so the operator can tell
  at a glance which cards diverge from defaults.

### Footer

Sticky footer at the bottom of the drawer:

```
Total: ₹3,81,000 across 4 invoices    [Cancel]  [Generate 4 Invoices]
```

- Total auto-updates from the per-card live totals (sum of approved grand
  totals).
- Button label uses the live approved count.
- Disabled when zero approved.

### Discard guard

If any card has been edited (lines, GST, TDS, discount, round-off, notes
diverge from defaults), closing the drawer prompts `useConfirm`:

> Discard {n} unsaved edit{s}? Approvals and line changes will be lost.

Otherwise close silently. Same guard fires on `Escape` and outside-click.

### What we remove

- The redirect to `/invoices/bulk/new` from `Reports.js` button.
- The per-draft sequential walk-through pattern.
- The forced PDF preview modal at the "final review" step.
- The dedicated "results / done" page.

### What we reuse (no duplication)

- `previewBulkInvoiceAPI`, `createInvoiceAPI`, `updateInvoiceAPI`,
  `previewInvoicePdfAPI` — same calls, same payloads.
- `computeTotals` from `BulkInvoiceWizard.js` — extracted to a shared
  module `frontend/src/pages/invoices/bulkInvoiceUtils.js`.
- `commitDraft` logic — extracted to the same shared module so both the
  drawer and the legacy wizard call one function.
- `<BulkInvoiceDraftEditor>` — extracted from the wizard's existing
  reviewing-phase markup. Both pages render it.

### File layout

```
frontend/src/pages/invoices/
  bulkInvoiceUtils.js       (new) — computeTotals, commitDraft, baseServiceName
  BulkInvoiceDraftEditor.js (new) — extracted edit table + totals panel
  BulkInvoiceDrawer.js      (new) — the slide-over for the Reports page
  BulkInvoiceWizard.js      (edit) — refactor only: replace its inline
                                     computeTotals / commitDraft / reviewing-
                                     phase markup with imports from the new
                                     shared files. Behaviour, routes, and UX
                                     of the legacy wizard are unchanged.
  InvoiceWizard.js          (no change)
  InvoiceList.js            (no change)
frontend/src/pages/reports/
  Reports.js                (edit) — handleGenerateInvoices opens drawer
                                     instead of navigating
```

### Drawer styling

Right-side slide-over, `max-w-3xl`, full height, sticky header + footer,
scrollable card list in the middle. Matches the existing `CashBankFormModal`
and `BulkReceivePaymentModal` styling for visual consistency. Backdrop click
respects the discard guard.

## Click-count comparison

5-hospital batch, no per-draft edits:

| Step | Today | Proposed |
|---|---|---|
| Reports → Generate Bill | 1 | 1 |
| Select claims | n | n |
| Generate Invoices | 1 | 1 |
| Approve each draft | 5 | 0 |
| Next between drafts | 4 | 0 |
| Review All | 1 | 0 |
| Close PDF preview modal | 1 | 0 |
| Generate | 1 | 1 |
| Back to Reports | 1 | 0 |
| **Total extra clicks** | **14** | **2** |
| Page redirects | 1 | 0 |

## Edge cases

- **Zero previews returned** (all skipped): drawer shows the skipped banner
  with reasons and a single "Close" button. No "Generate" button shown.
- **Mixed skipped + previewable**: skipped banner shown above the card list,
  cards work normally.
- **previewBulkInvoiceAPI fails entirely**: toast error, close drawer,
  user lands back on Reports unchanged.
- **Mid-generation network failure**: stop the loop, mark remaining cards
  as not-yet-attempted, keep drawer open so the operator can retry.
- **Operator closes the tab during `generating`**: the in-flight POST may
  still create an invoice. Accepted — same behaviour as today's wizard.
- **One draft has `existingInvoice` set**: card is unchecked by default,
  amber banner with a "View existing" link that opens
  `/invoices/{existingInvoice._id}` in a new tab. Whether the backend
  allows re-creating an invoice for the same hospital+month is dictated by
  the existing `POST /invoices` semantics — the drawer does not bypass it.
  If the backend rejects a duplicate, the card surfaces the error during
  generation and the retry button stays available.

## Testing

Manual:

- Single hospital, single month batch → 1 card, 2 clicks to create.
- 5-hospital batch → 5 cards visible at once, 1 click (Generate) creates all.
- Expand 1 card, edit a TPA-desk line amount → live totals update, edited
  pill appears. Generate → only that card's invoice carries the edit.
- Uncheck 2 cards → footer says "Generate 3 Invoices", only 3 created.
- Per-card "Preview PDF" → modal opens, close → drawer state intact.
- Edit a card, click Cancel → confirm modal blocks; click Discard →
  drawer closes, edits gone.
- One draft maps to an existing invoice → card unchecked by default + banner
  with link to existing.
- Simulate a 500 from `/invoices` on the 3rd of 5 → first 2 succeed,
  remaining cards show retry button.
- Reports bill-mode unchanged before/after drawer (selection clears on
  successful all-generate).

No new automated test coverage planned — frontend has no test suite in this
repo and adding one is out of scope.

## Rollout

Single PR. No feature flag — the Reports page's button rewires to the
drawer atomically. The legacy `/invoices/bulk/new` route remains live so
anyone with the URL bookmarked still works.

## Open questions

None outstanding — all locked at brainstorming time:
- Option A (drawer), no forced preview, stay on Reports after generation.
