# Reports Tab Enhancements — Design Spec
**Date:** 2026-05-19

## Overview
Four targeted enhancements to the Reports page (`frontend/src/pages/reports/Reports.js`) and the backend claims query endpoint.

---

## 1. File Price — Super Admin Only

**Scope:** Frontend only.

- The **File Price** table column is hidden for non-super-admin users.
- The **Total Revenue (File Price)** summary card is hidden for non-super-admin users.
- The CSV export strips the `File Price` column for non-super-admin users.
- Detection: `roleSlug === 'super_admin'` from `useAuth()`.

---

## 2. Date Range Filter

**Scope:** Frontend + Backend.

### Frontend
- Replace the single `DateInput type="month"` with two `<input type="date">` fields: **Date From** and **Date To**.
- Filter state changes from `{ month: '' }` to `{ dateFrom: '', dateTo: '' }`.
- Both dates are optional; either can be omitted.

### Backend (`backend/controllers/claimController.js` — `getClaims`)
- Accept `dateFrom` and `dateTo` as query params alongside the existing `month` param.
- When `dateFrom` is provided: add `month: { gte: startOfDay(dateFrom) }` to the where clause.
- When `dateTo` is provided: add `month: { lte: endOfDay(dateTo) }` to the where clause.
- The existing `month` single-month filter continues to work unchanged (used by the claims list page).

---

## 3. Statuses from Claim Status Master

**Scope:** Frontend only.

- On mount, call `getClaimStatusesAPI()` to fetch all statuses.
- Filter to `isActive === true` on the frontend before rendering options.
- Render `<option value={s.slug}>{s.label}</option>` for each active status.
- Show a loading state ("Loading...") in the select while fetching, or fall back to an empty dropdown if the fetch fails.
- Remove the 5 hardcoded status options (`admitted`, `discharged`, `submitted`, `settled`, `rejected`).

---

## 4. Generate Bill (Super Admin Only)

**Scope:** Frontend only.

### Visibility
- The **Generate Bill** button is only rendered when `roleSlug === 'super_admin'`.
- The existing **CSV** export button remains for all users.

### UI
- "Generate Bill" button sits alongside the CSV button in the filter bar action area.
- Clicking it toggles a small dropdown with two options:
  - **Group by Hospital** — hospital-level summary CSV
  - **All Claims** — full detailed CSV (identical to the existing CSV export, always includes File Price since this is super-admin only)

### Group by Hospital CSV
Columns: `Hospital`, `No. of Claims`, `Total Hospital Bill`, `Total Approval Amount`, `Total Settlement`, `Total Bank Transfer`, `Total File Price`

One row per distinct hospital in the current `claims` result set. Rows are sorted by hospital name alphabetically.

### All Claims CSV
Same as the current `exportCSV` function, always including File Price (super admin always sees it).

### State
- A `billDropdownOpen` boolean state controls the dropdown visibility.
- Clicking outside the dropdown closes it (use a `useRef` + document click listener, or a simple blur/onMouseLeave approach).

---

## Files to Change

| File | Change |
|------|--------|
| `frontend/src/pages/reports/Reports.js` | All 4 features |
| `backend/controllers/claimController.js` | Add `dateFrom`/`dateTo` filter to `getClaims` |

---

## Out of Scope
- No changes to the backend for bill generation (done client-side from already-fetched claims data).
- No pagination changes.
- No new routes.
