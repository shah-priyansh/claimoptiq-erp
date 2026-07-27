# Split field selection for Reports table vs. Invoice details

**Date:** 2026-07-27
**Screen:** Claims Report page (`/reports/claims`, `frontend/src/pages/reports/Reports.js`)

## Problem

The gear icon (⚙️) on the Claims Report page opens the "Claims Summary Columns"
modal, which saves a single site setting, `invoice_summary_columns`. That one
setting is consumed in two unrelated places:

1. The columns rendered in the **on-screen Reports table** (`Reports.js:194-206`,
   mapped through `TABLE_COL_DEFS`).
2. The **Claims Summary table appended to page 2 of the invoice PDF**
   ("Invoice details") — `backend/utils/renderInvoicePdf.js` via
   `backend/utils/invoiceSummaryFields.js`.

Because both read the same setting, the operator cannot choose different fields
for the report table and the invoice PDF — changing one changes the other. The
user wants these to be independently configurable.

The key spaces already line up: the field keys in the picker modal
(`ClaimSummaryColumnsModal` `FIELD_DEFS` / backend `invoiceSummaryFields.FIELDS`)
are the same keys used by the report table's `TABLE_COL_DEFS`. So the same
~38-field checklist is valid for both destinations; only the persisted value
needs to be split.

## Goal

Two independent, persisted column configurations, selected from two separate
gear icons on the Claims Report page:

- **Report Columns** → controls only the on-screen Reports table.
- **Invoice Columns** → controls only the invoice PDF page-2 summary.

## Non-goals

- The green **Export** field picker (`BASE_FIELD_DEFS` / `selectedFields` in
  `Reports.js`) is already separate and per-session. It is **not** touched.
- No change to invoice PDF rendering logic or the invoice generation flow.
- No new fields added to the picker; the existing field list is reused.

## Design

### 1. Backend — new site setting

Add `report_table_columns` to `DEFAULTS` in
`backend/controllers/siteSettingController.js`. It is a comma-separated list of
column keys, same key space as `invoice_summary_columns`.

Default value mirrors the report table's existing frontend default
(`TABLE_DEFAULT_COLS` in `Reports.js`):

```
patientName,hospital,claimType,hospitalFinalBill,finalApprovalAmount,settlementAmount,tds,bankTransferAmount,status
```

Because it is added to `DEFAULTS`, it is automatically:
- returned by `getPublicSettings` (the public settings endpoint the frontend
  polls), and
- accepted by `updateSettings` (the allow-list is `Object.keys(DEFAULTS)`).

`invoice_summary_columns` is unchanged and continues to drive **only** the
invoice PDF from now on (`renderInvoicePdf.js` already reads it via
`getInvoiceTemplate()` — no change there).

### 2. Frontend — Reports table reads the new setting (with migration fallback)

In `Reports.js`, the effect that currently reads `invoice_summary_columns`
(lines 194-206) changes to read `report_table_columns`, with a fallback chain
so nothing resets on first load after deploy:

```
report_table_columns  →  (if empty) invoice_summary_columns  →  (if empty) TABLE_DEFAULT_COLS
```

This carries the operator's current table customization over on the first load,
after which the two configs diverge as they are edited independently. The effect
re-runs whenever **either** gear modal closes, so the table reflects a fresh
save immediately.

### 3. Frontend — two gear icons

In the Claims Report header (super-admin only, alongside "Generate Bill"), show
two gear buttons with distinguishing labels/tooltips:

- ⚙️ **Report Columns** — opens the picker bound to `report_table_columns`.
- ⚙️ **Invoice Columns** — opens the picker bound to `invoice_summary_columns`.

Two separate open-state flags drive the two modal instances.

### 4. Reuse one modal component

Generalize `frontend/src/pages/invoices/ClaimSummaryColumnsModal.js` to accept
props instead of hard-coding the setting key and copy:

- `settingKey` — which site setting to read/save (`'invoice_summary_columns'`
  or `'report_table_columns'`).
- `title` — modal heading (e.g. "Report Table Columns" / "Invoice Summary
  Columns").
- `subtitle` — helper text describing where the fields appear.
- `defaultKeys` — fallback selection when the setting is empty.

Internals (field list `FIELD_DEFS`, grouping, search, select/clear-all, save via
`updateSiteSettingsAPI`) are unchanged; only the read key, the save key, the
copy, and the default become parameters. The invoice gear passes the existing
values so its behavior is byte-for-byte identical to today; the report gear
passes the report setting key, report title/subtitle, and `TABLE_DEFAULT_COLS`
as defaults.

The frontend keeps a report default constant equal to the backend default so
both agree.

## Files touched

- `backend/controllers/siteSettingController.js` — add `report_table_columns`
  to `DEFAULTS`.
- `frontend/src/pages/invoices/ClaimSummaryColumnsModal.js` — parameterize
  setting key / title / subtitle / defaults.
- `frontend/src/pages/reports/Reports.js` — second gear button + open state;
  table effect reads `report_table_columns` with fallback; render the modal
  twice with the two configs.

## Verification

- Report Columns gear: change selection, save → on-screen table columns update;
  invoice PDF summary unchanged.
- Invoice Columns gear: change selection, save → invoice PDF page-2 summary
  updates; on-screen table unchanged.
- First load after deploy (no `report_table_columns` yet): table shows the same
  columns as before (inherited from `invoice_summary_columns`), not a reset to
  defaults.
