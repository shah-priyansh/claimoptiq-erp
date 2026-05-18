# Doctor Name Selection — Hospital-wise (Claim Entry)

**Date:** 2026-05-18  
**Status:** Approved

## Summary

Replace the free-text Doctor Name input in `ClaimForm` with a hospital-filtered dropdown. When a hospital is selected, only that hospital's registered doctors appear as options. The field is hidden when no hospital is selected, and shows an "Add Doctor" link when the hospital has no registered doctors.

## Requirements

- Doctor Name field is hidden until a hospital is selected.
- Once a hospital is selected, show a `SearchableSelect` restricted to that hospital's registered doctors.
- If the selected hospital has no doctors registered, show an empty-state message with a link to `/hospitals/:id` so the user can add doctors.
- Changing the selected hospital resets `doctorName` to `''` to avoid stale carry-over.
- No free-text entry — selection is restricted to the registered list.

## Data Flow

No new API calls or backend changes needed.

`getHospitalsAPI({ active: 'true' })` already returns hospitals with their `doctors` array included (via `hospitalInclude` in `hospitalController.js`). The `ClaimForm` already stores this in the `hospitals` state.

Selected hospital is derived inline:
```js
const selectedHospital = hospitals.find(h => h._id === form.hospital);
const doctorOptions = (selectedHospital?.doctors ?? []).map(d => ({ value: d.name, label: d.name }));
```

`doctorName` continues to store a plain string on the `Claim` model — no schema change.

## UI States

| Condition | Doctor Name field |
|---|---|
| No hospital selected | Hidden |
| Hospital selected, doctors exist | `SearchableSelect` with doctor name options, required |
| Hospital selected, no doctors | Empty-state message + "Add Doctor" link → `/hospitals/:id` |

## Code Changes

All changes are confined to `frontend/src/pages/claims/ClaimForm.js`.

1. **Multi-field setter** — add a `setMany` helper (or inline spread) to reset `doctorName` when `hospital` changes:
   ```js
   onChange={val => setForm(f => ({ ...f, hospital: val, doctorName: '' }))}
   ```

2. **Derived values** (no new state):
   ```js
   const selectedHospital = hospitals.find(h => h._id === form.hospital);
   const doctorOptions = (selectedHospital?.doctors ?? []).map(d => ({ value: d.name, label: d.name }));
   ```

3. **Replace doctor text input** with conditional rendering:
   - Hidden if `!form.hospital`
   - `SearchableSelect` if `doctorOptions.length > 0`
   - Empty-state div with link if `form.hospital && doctorOptions.length === 0`

## Files Changed

| File | Change |
|---|---|
| `frontend/src/pages/claims/ClaimForm.js` | Replace doctor text input with conditional hospital-filtered `SearchableSelect` |

No backend changes. No new files. No new API endpoints.
