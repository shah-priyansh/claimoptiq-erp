# Bill Export — Excel & PDF with Grouped Layout — Design Spec
**Date:** 2026-05-19

## Overview

Replace the Generate Bill dropdown's two CSV options ("Group by Hospital", "All Claims Report") with two format options that both produce a **grouped-by-hospital hierarchical layout**: Export Excel (.xlsx) and Export PDF.

The existing flat CSV button remains unchanged for all-claims export.

---

## Dropdown UI

**Before:**
- Group by Hospital (CSV)
- All Claims Report (CSV)

**After:**
- Export Excel (.xlsx)
- Export PDF

Both options produce the same grouped-by-hospital layout, just in different formats.

---

## Grouped Layout

Both exports follow this structure:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Apollo Hospital Surat          ← bold/highlighted header row, spans all columns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SR | Patient | Type | Bill | Approval | Settlement | TDS | Bank Amt | Status | File Price
1  | Rahul   | ...  | ...  | ...      | ...        | ... | ...      | ...    | ...
2  | Priya   | ...  | ...  | ...      | ...        | ... | ...      | ...    | ...
   [Subtotal row]          | ₹X   | ₹Y          | ₹Z         | ...  | ₹W

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  City Hospital Surat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
...
[Grand Total row]          | ₹X   | ₹Y          | ₹Z         | ...  | ₹W
```

**Column set (claim rows):**
SR | Patient Name | Claim Type | Insurance | TPA | Policy No | DOA | DOD | Hospital Bill | Approval Amount | Settlement Amount | TDS | Bank Transfer | Status | File Price

**Subtotal row:** shows sums of Hospital Bill, Approval Amount, Settlement Amount, TDS, Bank Transfer, File Price for that hospital's claims. SR/Patient/other text columns are empty.

**Grand Total row:** same sums across all claims. Appears after the last hospital group.

**Hospitals sorted:** alphabetically by hospital name.

**File Price column:** included in both Excel and PDF (these are super-admin-only exports, so File Price is always shown).

---

## Excel Export (SheetJS / `xlsx`)

- Library: `xlsx` (SheetJS community edition, `npm install xlsx`)
- File: `bill_grouped_YYYY-MM-DD.xlsx`
- Sheet name: `Bill Report`
- Hospital header rows: bold font, light blue background (`#DBEAFE`), merged across all columns
- Column headers: bold, gray background (`#F3F4F6`)
- Subtotal rows: bold, light yellow background (`#FEF9C3`)
- Grand Total row: bold, light green background (`#DCFCE7`)
- Numeric columns (bill amounts): stored as numbers so Excel can sort/sum them natively
- Column widths: auto-sized with reasonable minimums

## PDF Export (jsPDF + autoTable)

- Libraries: `jspdf` + `@types/jspdf` + `jspdf-autotable` (npm install jspdf jspdf-autotable)
- File: `bill_grouped_YYYY-MM-DD.pdf`
- Page: A4 landscape
- Title: "Bill Report — ClaimOptiq" + generated date, top of page
- Hospital header rows: full-width cell spanning all columns, bold, blue background (`#2563EB`), white text
- Column headers: bold, gray background
- Subtotal rows: bold, yellow background (`#FEF9C3`)
- Grand Total row: bold, green background (`#DCFCE7`)
- Numeric values: formatted as Indian currency (e.g. ₹1,23,456)
- Auto page breaks when content overflows

---

## Files to Change

| File | Change |
|------|--------|
| `frontend/package.json` | Add `xlsx`, `jspdf`, `jspdf-autotable` dependencies |
| `frontend/src/pages/reports/Reports.js` | Replace `exportBillGrouped` + `exportBillAll` with `exportBillExcel` + `exportBillPDF`; update dropdown |

---

## Out of Scope
- No backend changes
- No changes to the flat CSV export button
- No changes to the on-screen table
