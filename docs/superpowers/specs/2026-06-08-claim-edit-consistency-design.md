# Claim edit consistency — unify admission/discharge edit UX

**Date:** 2026-06-08
**Status:** Draft for review
**Area:** `frontend/src/pages/claims/` (ClaimList.js, ClaimDetail.js, ClaimForm.js)

## Problem

Editing different stages of a claim uses inconsistent UX:

- **Edit Admission** → clicking the pencil icon (from list row or detail header) navigates to a separate full-page form (`ClaimForm.js` at `/claims/:id/edit`).
- **Edit Discharge / File & Submit / Settlement** → edited inline on tabs inside the detail page (`ClaimDetail.js`).

Users land on two different mental models depending on which stage they want to edit, which is confusing.

## Goal

A single consistent editing model: **open the claim's detail page → pick the stage tab → edit inline**. Every stage of the claim lifecycle is edited the same way.

`ClaimForm.js` keeps its role for *creating* a new claim only.

## Scope

In scope:
- Add an editable **Admission** tab to `ClaimDetail.js`.
- Redirect entry points (list-row pencil, detail-header pencil) to land on the Admission tab.
- Support deep-link via `?tab=...` query param.
- Redirect the legacy `/claims/:id/edit` route to `/claims/:id?tab=admission`.

Out of scope:
- Changes to Discharge / File & Submit / Settlement / Documents tabs.
- Backend API changes (the existing `updateClaimAPI` already supports admission fields).
- Visual redesign of tabs or forms (reuse existing components and styles).

## Design

### Tab structure

`ClaimDetail.js` currently exposes these tabs:

```
Overview · Discharge · File & Submit · Settlement · Documents
```

After the change:

```
Overview · Admission · Discharge · File & Submit · Settlement · Documents
```

- **Overview** stays as the read-only summary across all stages (no behavior change).
- **Admission** is the new editable tab and is the 2nd tab.

### Admission tab content

The Admission tab mirrors the inline-edit pattern already used by the Discharge tab. It includes:

**Patient details**
- Patient Name (text, required)
- Patient Mobile (phone format, validated)
- Doctor (select, sourced from selected hospital's doctors)
- Claim Type (radio: existing claim types)
- Date of Admit (date)

**Hospital / Insurance**
- Hospital (select from `hospitals`)
- Insurance Company (select from `insurances`)
- TPA (select from `tpas`)
- Policy No (text)
- Client ID (text)
- CCN No (text)
- Month Claim # (text)

**Admission Documents**
- Reuses the shared `DocsSubsection` component with `category="admission"`, `pendingKey="admission"`, `uploadLabel="Add Files"`.
- Same upload / preview / delete behavior as Discharge tab.

**Save**
- Reuses `SaveFooter` with `label="Save Admission"` and `onSave={handleSaveAdmission}`.
- `handleSaveAdmission` calls `updateClaimAPI(id, { ...admissionForm })` then uploads any pending admission files via `uploadPendingFiles('admission', pendingFiles.admission)`.
- Show toast "Admission details saved" on success.

### State additions in ClaimDetail.js

- New state: `admissionForm` (object), initialised from the claim record in the existing data-load effect.
- Extend `pendingFiles` initial state to include an `admission: []` array.
- Add `handleSaveAdmission` alongside the existing `handleSaveDischarge`.

### Validation parity with ClaimForm

Reuse the same field-level validation already in `ClaimForm.js`:
- Mobile number format via `onPhoneInput` and the existing `mobileError` pattern.
- Required-field checks for Patient Name, Hospital, Insurance.

If a validation check fails on save, show an inline error using the same style as Discharge tab.

### URL / routing

- `ClaimDetail.js` reads `?tab=<key>` on mount and sets `activeTab` accordingly (default: `overview`).
- When the user clicks a tab, push the query param into the URL (`navigate(\`?tab=${key}\`, { replace: true })`) so refresh / share works.
- React Router config: redirect `/claims/:id/edit` → `/claims/:id?tab=admission`.

### Entry points

| Entry point | Before | After |
|---|---|---|
| List-row pencil icon (`ClaimList.js`) | `navigate('/claims/:id/edit')` | `navigate('/claims/:id?tab=admission')` |
| Detail-header pencil icon (`ClaimDetail.js`) | `navigate('/claims/:id/edit')` | `setActiveTab('admission')` and update `?tab=admission` |
| Row click on list | Opens detail page | Unchanged |
| "+ New Claim" button | Opens `ClaimForm.js` create mode | Unchanged |

### `ClaimForm.js` simplification

- The `isEdit` branch (and related fetch-existing-claim logic) is no longer reachable from the UI.
- For safety in this change, leave the edit code path in place but unreachable — do not delete in the same PR.
- Future cleanup: remove the `isEdit` branch from `ClaimForm.js` once we're confident no external links rely on `/claims/:id/edit`.

## Components reused

- `DocsSubsection`, `PendingDocGrid`, `DocMiniGrid`, `UploadLabel`, `SaveFooter`, `SectionHeader`, `AmountInput`, `DateInput`, `Spinner` — all already defined in `ClaimDetail.js`.
- API helpers: `updateClaimAPI`, `uploadPendingFiles` (or whichever upload helper Discharge uses today).
- Data sources: `hospitals`, `insurances`, `tpas` — already loaded in `ClaimForm.js`; the same loaders are added to `ClaimDetail.js` for the Admission tab.

## Error handling

- Save failures show a toast error (same `toast.error` pattern used by Discharge).
- Upload failures for pending admission files: keep claim save success; show separate toast for upload failure.
- Validation errors prevent save and show inline field errors.

## Permissions

- Admission tab is editable only when `can('claims', 'edit')` (existing `isEditable` flag in `ClaimDetail.js`).
- When `isEditable` is false, the Admission tab renders read-only (same field labels and values, no inputs), mirroring the read-only fallback already used in the Discharge tab.

## Testing checklist

- [ ] Click pencil icon on list row → lands on detail page, Admission tab active, fields populated.
- [ ] Click pencil icon in detail header → switches to Admission tab without navigation; URL updates to `?tab=admission`.
- [ ] Edit admission field, click Save → toast "Admission details saved", values persist after reload.
- [ ] Upload admission file, click Save → file appears in admission documents list and in the Documents tab count.
- [ ] Delete an admission document → confirmation prompt, document removed, count updates.
- [ ] Visit legacy `/claims/:id/edit` → redirects to `/claims/:id?tab=admission`.
- [ ] User without `claims.edit` permission sees read-only Admission tab.
- [ ] Switching between Overview / Admission / Discharge tabs updates the URL `?tab=` param.
- [ ] Refreshing on `/claims/:id?tab=admission` lands back on the Admission tab.
- [ ] Mobile-number validation on the Admission tab matches `ClaimForm.js` behavior.
- [ ] Creating a new claim via `/claims/new` still works (unchanged).

## Rollout

Single PR. No feature flag — the behavior change is purely UX consolidation and the underlying API contract is unchanged.

## Open considerations

- The list row currently has *both* a pencil icon and a row click that opens the detail page. After this change the pencil is essentially a "deep link to Admission tab" shortcut. We keep it for users who specifically want to jump straight into editing admission, but could revisit removing it after observing usage.
