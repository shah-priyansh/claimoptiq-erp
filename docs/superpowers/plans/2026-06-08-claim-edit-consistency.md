# Claim edit consistency — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the claim-edit UX so every stage of the claim lifecycle (admission, discharge, file&submit, settlement) is edited inline on tabs inside `ClaimDetail.js` — eliminating the separate `/claims/:id/edit` page for the admission stage.

**Architecture:** Add an editable **Admission** tab to `ClaimDetail.js` (2nd tab, between Overview and Discharge) following the same inline-edit pattern already used by the Discharge tab. Redirect existing entry points (list-row pencil, detail-header pencil, legacy `/claims/:id/edit` route) to land on the new tab via a `?tab=admission` query param. `ClaimForm.js` becomes the create-only form.

**Tech Stack:** React 19, react-router-dom v7 (already installed), Tailwind, react-toastify. No new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-06-08-claim-edit-consistency-design.md`

---

## File map

| File | Action | Responsibility after change |
|---|---|---|
| `frontend/src/pages/claims/ClaimDetail.js` | Modify | Adds Admission tab + state + save handler; reads/writes `?tab=` URL param; in-page tab switch from header pencil |
| `frontend/src/pages/claims/ClaimList.js` | Modify | Row pencil icon now navigates to `?tab=admission` instead of `/edit` |
| `frontend/src/App.js` | Modify | Redirect `/claims/:id/edit` → `/claims/:id?tab=admission` |

No new files.

---

## Task 1: Sync the active tab with a `?tab=` URL query param

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js`

This makes deep-linking work (`/claims/:id?tab=admission` opens the right tab) and lets the header pencil "navigate" by simply changing the tab and URL together.

- [ ] **Step 1: Read the existing tab state**

At `ClaimDetail.js:200` the component currently imports only `useParams, useNavigate`. We also need `useSearchParams`. The `activeTab` state lives at `ClaimDetail.js:210`.

- [ ] **Step 2: Update the react-router-dom import**

Find at `ClaimDetail.js:3`:

```js
import { useParams, useNavigate } from 'react-router-dom';
```

Replace with:

```js
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
```

- [ ] **Step 3: Read `?tab=` on mount and initialise `activeTab` from it**

Find at `ClaimDetail.js:210`:

```js
const [activeTab, setActiveTab] = useState('overview');
```

Replace with:

```js
const [searchParams, setSearchParams] = useSearchParams();
const VALID_TABS = ['overview', 'admission', 'discharge', 'file_submit', 'settlement', 'documents'];
const initialTab = VALID_TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'overview';
const [activeTab, setActiveTab] = useState(initialTab);
```

- [ ] **Step 4: Wrap `setActiveTab` so it also writes the URL**

Just below the `setActiveTab` line added in Step 3, add a helper:

```js
const changeTab = (key) => {
  setActiveTab(key);
  const next = new URLSearchParams(searchParams);
  next.set('tab', key);
  setSearchParams(next, { replace: true });
};
```

- [ ] **Step 5: Use `changeTab` in the tab button onClick**

Find at `ClaimDetail.js:815`:

```js
<button key={tab.key} onClick={() => setActiveTab(tab.key)}
```

Replace with:

```js
<button key={tab.key} onClick={() => changeTab(tab.key)}
```

- [ ] **Step 6: Manually verify in the browser**

Run dev server (`cd frontend && npm start`), open `/claims/<some-id>`, click each tab — confirm the URL updates with `?tab=...`. Then refresh the page on `?tab=discharge` and confirm Discharge tab is active. Then visit `/claims/<id>?tab=overview` directly and confirm Overview is active.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): sync active tab with ?tab= URL param"
```

---

## Task 2: Register the new "Admission" tab in the tabs array

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js:555-561`

This is a tiny step that surfaces the tab in the UI before we wire up its content. The tab will render nothing for now (no `activeTab === 'admission'` block yet) — Task 6 implements the content. Steps 1–4 are scoped to keep the diff small and reviewable.

- [ ] **Step 1: Add the tab definition**

Find at `ClaimDetail.js:555`:

```js
const tabs = [
  { key: 'overview',   label: 'Overview' },
  { key: 'discharge',  label: 'Discharge' },
  { key: 'file_submit',label: 'File & Submit' },
  { key: 'settlement', label: 'Settlement' },
  { key: 'documents',  label: `Documents (${claim.documents?.length || 0})` },
];
```

Replace with:

```js
const tabs = [
  { key: 'overview',   label: 'Overview' },
  { key: 'admission',  label: 'Admission' },
  { key: 'discharge',  label: 'Discharge' },
  { key: 'file_submit',label: 'File & Submit' },
  { key: 'settlement', label: 'Settlement' },
  { key: 'documents',  label: `Documents (${claim.documents?.length || 0})` },
];
```

- [ ] **Step 2: Verify in browser**

Open a claim detail page, confirm the "Admission" tab now appears as the 2nd tab. Clicking it shows an empty content area (no errors). URL updates to `?tab=admission`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): add Admission tab placeholder"
```

---

## Task 3: Load hospitals / insurances / TPAs and add admission form state

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js`

The Admission tab needs dropdowns for Hospital, Insurance Company, and TPA. We load those lists once on mount (same APIs `ClaimForm.js` already uses). We also add the `admissionForm` state and populate it inside the existing `fetchClaim` callback.

- [ ] **Step 1: Import the data-loader API helpers and validators**

Find at `ClaimDetail.js:4`:

```js
import { getClaimAPI, updateClaimAPI, uploadDocumentsAPI, deleteDocumentAPI, getClaimStatusesAPI, getClaimDocumentTypesAPI } from '../../services/api';
```

Replace with:

```js
import { getClaimAPI, updateClaimAPI, uploadDocumentsAPI, deleteDocumentAPI, getClaimStatusesAPI, getClaimDocumentTypesAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI } from '../../services/api';
```

Then find the validators import block. There is currently no validators import — add this new import just below the existing `SearchableSelect` import (around `ClaimDetail.js:20`):

```js
import { isValidPhone, onPhoneInput } from '../../utils/validators';
```

- [ ] **Step 2: Add state for hospitals/insurances/tpas**

Find at `ClaimDetail.js:224` (the line `const [dischargeForm, setDischargeForm] = useState({});`). Add these three lines immediately *above* it:

```js
const [hospitals, setHospitals] = useState([]);
const [insurances, setInsurances] = useState([]);
const [tpas, setTPAs] = useState([]);
```

- [ ] **Step 3: Add `admissionForm` state and `mobileError` state**

Immediately below `const [dischargeForm, setDischargeForm] = useState({});` at `ClaimDetail.js:224`, add:

```js
const [admissionForm, setAdmissionForm] = useState({});
const [mobileError, setMobileError] = useState('');
```

- [ ] **Step 4: Extend `pendingFiles` initial state with an `admission: []` array**

Find at `ClaimDetail.js:221`:

```js
const [pendingFiles, setPendingFiles] = useState({ discharge: [], pod: [], settlement_proof: [], other: [] });
```

Replace with:

```js
const [pendingFiles, setPendingFiles] = useState({ admission: [], discharge: [], pod: [], settlement_proof: [], other: [] });
```

- [ ] **Step 5: Load hospitals / insurances / tpas once on mount**

Find the existing one-time loader effect at `ClaimDetail.js:278`:

```js
useEffect(() => {
  getClaimStatusesAPI().then(({ data }) => setClaimStatuses(
    data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin))
  )).catch(() => {}).finally(() => setStatusesLoading(false));
  getClaimDocumentTypesAPI()
    .then(({ data }) => setDocTypes(Array.isArray(data) ? data.filter(d => d.isActive !== false) : []))
    .catch(() => toast.error('Failed to load document types'));
}, []);
```

Replace with:

```js
useEffect(() => {
  getClaimStatusesAPI().then(({ data }) => setClaimStatuses(
    data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin))
  )).catch(() => {}).finally(() => setStatusesLoading(false));
  getClaimDocumentTypesAPI()
    .then(({ data }) => setDocTypes(Array.isArray(data) ? data.filter(d => d.isActive !== false) : []))
    .catch(() => toast.error('Failed to load document types'));
  Promise.all([
    getHospitalsAPI({ active: 'true' }),
    getInsuranceAPI(),
    getTPAAPI(),
  ]).then(([h, i, t]) => {
    setHospitals(h.data);
    setInsurances(i.data);
    setTPAs(t.data);
  }).catch(() => toast.error('Failed to load hospitals/insurance/TPA list'));
}, []);
```

- [ ] **Step 6: Populate `admissionForm` inside `fetchClaim`**

Find inside `fetchClaim` at `ClaimDetail.js:292`:

```js
setDischargeForm({
  dateOfAdmit: data.dateOfAdmit?.slice(0, 10) || '',
  ...
});
```

Immediately *above* that `setDischargeForm({` call, add this `setAdmissionForm` initialiser:

```js
setAdmissionForm({
  hospital: data.hospital?._id || data.hospital || '',
  isDirectPatient: !!data.isDirectPatient,
  patientName: data.patientName || '',
  patientMobile: data.patientMobile || '',
  doctorName: data.doctorName || '',
  claimType: data.claimType || 'cashless',
  insuranceCompany: data.insuranceCompany?._id || data.insuranceCompany || '',
  tpa: data.tpa?._id || data.tpa || '',
  policyNo: data.policyNo || '',
  clientId: data.clientId || '',
  ccnNo: data.ccnNo || '',
  monthClaimNo: data.monthClaimNo || '',
  dateOfAdmit: data.dateOfAdmit ? data.dateOfAdmit.slice(0, 10) : '',
});
setMobileError('');
```

- [ ] **Step 7: Verify**

Open a claim detail page in the browser. Confirm:
- No console errors.
- Network tab shows requests to `/hospitals?active=true`, `/insurance`, `/tpa` on first load.
- Switching tabs still works.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): load hospital/insurance/tpa lists and add admission form state"
```

---

## Task 4: Add `handleSaveAdmission` handler

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js`

Mirrors `handleSaveDischarge`: validate phone, call `updateClaimAPI`, upload pending admission files, refresh.

- [ ] **Step 1: Add the handler**

Find the existing `handleSaveDischarge` definition at `ClaimDetail.js:427`:

```js
const handleSaveDischarge = async () => {
  setSaving(true);
  try {
    await updateClaimAPI(id, { ...dischargeForm, status: 'discharged' });
    await uploadPendingFiles('discharge', pendingFiles.discharge);
    toast.success('Discharge details saved');
    await fetchClaim(true);
  } catch (error) {
    toast.error(error.response?.data?.message || 'Failed to save');
  } finally { setSaving(false); }
};
```

Immediately *above* it, add:

```js
const handleSaveAdmission = async () => {
  if (admissionForm.patientMobile && !isValidPhone(admissionForm.patientMobile)) {
    setMobileError('Enter a valid 10-digit Indian mobile number (starts with 6-9)');
    toast.error('Please fix the mobile number before saving');
    return;
  }
  if (!admissionForm.patientName?.trim()) {
    toast.error('Patient name is required');
    return;
  }
  if (!admissionForm.hospital) {
    toast.error('Hospital is required');
    return;
  }
  if (!admissionForm.insuranceCompany) {
    toast.error('Insurance company is required');
    return;
  }
  setSaving(true);
  try {
    const payload = { ...admissionForm };
    if (!payload.tpa) delete payload.tpa;
    await updateClaimAPI(id, payload);
    await uploadPendingFiles('admission', pendingFiles.admission);
    toast.success('Admission details saved');
    await fetchClaim(true);
  } catch (error) {
    toast.error(error.response?.data?.message || 'Failed to save');
  } finally { setSaving(false); }
};
```

- [ ] **Step 2: Verify the file still compiles**

In the dev-server terminal, confirm no compile errors. Open a claim detail page, switch through tabs — nothing should crash (the handler is defined but not yet wired to UI).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): add handleSaveAdmission handler"
```

---

## Task 5: Render the Admission tab content

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js`

Now the visible payoff. Insert the Admission tab block in between the Overview block and the Discharge block, modeled exactly on Discharge.

- [ ] **Step 1: Derive select options just above the `return` (next to existing `inputCls`/`labelCls`)**

Find at `ClaimDetail.js:578`:

```js
const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white transition-colors';
const labelCls = 'block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5';
```

Immediately below those two lines, add:

```js
const hospitalOptions  = hospitals.map(h => ({ value: h._id, label: h.name }));
const insuranceOptions = insurances.map(i => ({ value: i._id, label: i.name }));
const tpaOptions       = tpas.map(t => ({ value: t._id, label: t.name }));
const selectedAdmissionHospital = hospitals.find(h => h._id === admissionForm.hospital);
const admissionDoctorOptions = (selectedAdmissionHospital?.doctors ?? []).map(d => ({ value: d.name, label: d.name }));
const CLAIM_TYPES = ['cashless', 'reimbursement', 'grievance'];
```

- [ ] **Step 2: Insert the Admission tab content block**

Find the Discharge block start at `ClaimDetail.js:896`:

```jsx
{/* ── Discharge ── */}
{activeTab === 'discharge' && (
```

Immediately *above* that comment, insert:

```jsx
{/* ── Admission ── */}
{activeTab === 'admission' && (
  <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
    <SectionHeader icon={HiOutlineUser} title="Admission Details" />

    {isEditable ? (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="md:col-span-2 lg:col-span-3">
          <label className={labelCls}>Claim Type</label>
          <div className="flex gap-3 mt-1">
            {CLAIM_TYPES.map(t => (
              <button key={t} type="button"
                onClick={() => setAdmissionForm(f => ({ ...f, claimType: t }))}
                className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all capitalize ${
                  admissionForm.claimType === t
                    ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}>{t}</button>
            ))}
          </div>
        </div>

        <div>
          <label className={labelCls}>Hospital *</label>
          <SearchableSelect
            value={admissionForm.hospital}
            onChange={v => setAdmissionForm(f => ({ ...f, hospital: v, doctorName: '' }))}
            options={hospitalOptions}
            placeholder="Select hospital" />
        </div>

        <div>
          <label className={labelCls}>Patient Name *</label>
          <input type="text" value={admissionForm.patientName || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, patientName: e.target.value }))}
            className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Patient Mobile</label>
          <input type="text" value={admissionForm.patientMobile || ''}
            onChange={e => {
              const val = onPhoneInput(e.target.value);
              setAdmissionForm(f => ({ ...f, patientMobile: val }));
              setMobileError(val && !isValidPhone(val) ? 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' : '');
            }}
            className={`${inputCls} ${mobileError ? 'border-red-400 focus:ring-red-200 focus:border-red-400' : ''}`} />
          {mobileError && <p className="mt-1 text-xs text-red-500">{mobileError}</p>}
        </div>

        <div>
          <label className={labelCls}>Doctor</label>
          <SearchableSelect
            value={admissionForm.doctorName}
            onChange={v => setAdmissionForm(f => ({ ...f, doctorName: v }))}
            options={admissionDoctorOptions}
            placeholder={selectedAdmissionHospital ? 'Select doctor' : 'Select hospital first'} />
        </div>

        <div>
          <label className={labelCls}>Date of Admit</label>
          <DateInput type="date" value={admissionForm.dateOfAdmit || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, dateOfAdmit: e.target.value }))}
            className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Insurance Company *</label>
          <SearchableSelect
            value={admissionForm.insuranceCompany}
            onChange={v => setAdmissionForm(f => ({ ...f, insuranceCompany: v }))}
            options={insuranceOptions}
            placeholder="Select insurance" />
        </div>

        <div>
          <label className={labelCls}>TPA</label>
          <SearchableSelect
            value={admissionForm.tpa}
            onChange={v => setAdmissionForm(f => ({ ...f, tpa: v }))}
            options={tpaOptions}
            placeholder="Select TPA (optional)" />
        </div>

        <div>
          <label className={labelCls}>Policy No</label>
          <input type="text" value={admissionForm.policyNo || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, policyNo: e.target.value }))}
            className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Client ID</label>
          <input type="text" value={admissionForm.clientId || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, clientId: e.target.value }))}
            className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>CCN No</label>
          <input type="text" value={admissionForm.ccnNo || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, ccnNo: e.target.value }))}
            className={inputCls} />
        </div>

        <div>
          <label className={labelCls}>Month Claim #</label>
          <input type="text" value={admissionForm.monthClaimNo || ''}
            onChange={e => setAdmissionForm(f => ({ ...f, monthClaimNo: e.target.value }))}
            className={inputCls} />
        </div>
      </div>
    ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          ['Claim Type',         claim.claimType],
          ['Hospital',           claim.hospital?.name || '—'],
          ['Patient Name',       claim.patientName],
          ['Patient Mobile',     claim.patientMobile || '—'],
          ['Doctor',             claim.doctorName || '—'],
          ['Date of Admit',      formatDate(claim.dateOfAdmit)],
          ['Insurance',          claim.insuranceCompany?.name || '—'],
          ['TPA',                claim.tpa?.name || '—'],
          ['Policy No',          claim.policyNo || '—'],
          ['Client ID',          claim.clientId || '—'],
          ['CCN No',             claim.ccnNo || '—'],
          ['Month Claim #',      claim.monthClaimNo || '—'],
        ].map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
      </div>
    )}

    <DocsSubsection category="admission" pendingKey="admission" uploadLabel="Add Files" />
    <SaveFooter onSave={handleSaveAdmission} label="Save Admission" />
  </div>
)}
```

- [ ] **Step 3: Verify in the browser**

Open a claim detail page → Admission tab. Confirm:
- All fields render with the current claim values populated.
- Editing a field updates the local state (no errors).
- The Hospital dropdown is searchable. Selecting a new hospital empties the Doctor.
- Uploading a file via "Add Files" shows it in the pending grid.
- Clicking "Save Admission" persists changes; toast appears; page refreshes with new values.
- Entering an invalid mobile number ("1234") shows the inline error and blocks save.
- Clearing Patient Name and saving shows the required toast.
- For a non-editable user (a role without `claims.edit`), the tab renders read-only StatCards.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): implement Admission tab with inline edit + read-only views"
```

---

## Task 6: Update the detail-header pencil to switch tabs in-place

**Files:**
- Modify: `frontend/src/pages/claims/ClaimDetail.js:668-673`

The header pencil currently navigates to `/claims/:id/edit`. After this change it stays on the same page and jumps to the Admission tab.

- [ ] **Step 1: Replace the navigate call**

Find at `ClaimDetail.js:668`:

```jsx
{isEditable && (
  <button onClick={() => navigate(`/claims/${id}/edit`)}
    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors">
    <HiOutlinePencil className="w-4 h-4" />
  </button>
)}
```

Replace with:

```jsx
{isEditable && (
  <button onClick={() => changeTab('admission')}
    title="Edit admission details"
    className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors">
    <HiOutlinePencil className="w-4 h-4" />
  </button>
)}
```

- [ ] **Step 2: Verify**

On any tab (Overview, Discharge…) click the pencil in the header. Confirm:
- The tab switches to Admission without a page navigation (no spinner / no URL path change beyond `?tab=admission`).
- Hovering the pencil shows the "Edit admission details" tooltip.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/claims/ClaimDetail.js
git commit -m "feat(claims): detail-header pencil switches to Admission tab in-place"
```

---

## Task 7: Update both ClaimList pencil icons to deep-link to Admission tab

**Files:**
- Modify: `frontend/src/pages/claims/ClaimList.js:975`
- Modify: `frontend/src/pages/claims/ClaimList.js:1045`

There are two pencil buttons in `ClaimList.js` (one in the mobile card view, one in the desktop table view). Both currently navigate to `/claims/:id/edit`. We point both at `/claims/:id?tab=admission`.

- [ ] **Step 1: Update the mobile-list pencil button**

Find at `ClaimList.js:975`:

```jsx
<button onClick={(e) => { e.stopPropagation(); navigate(`/claims/${c._id}/edit`); }}
  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
  <HiOutlinePencil className="w-4 h-4" />
</button>
```

Replace with:

```jsx
<button onClick={(e) => { e.stopPropagation(); navigate(`/claims/${c._id}?tab=admission`); }}
  title="Edit admission details"
  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
  <HiOutlinePencil className="w-4 h-4" />
</button>
```

- [ ] **Step 2: Update the desktop-table pencil button**

Find at `ClaimList.js:1045`:

```jsx
<button onClick={() => navigate(`/claims/${c._id}/edit`)}
  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
  <HiOutlinePencil className="w-4 h-4" />
</button>
```

Replace with:

```jsx
<button onClick={() => navigate(`/claims/${c._id}?tab=admission`)}
  title="Edit admission details"
  className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
  <HiOutlinePencil className="w-4 h-4" />
</button>
```

- [ ] **Step 3: Verify on both layouts**

- Desktop: open `/claims`, click pencil in the table row → lands on detail page with Admission tab active.
- Mobile (resize browser to <768px): open `/claims`, tap the pencil on a card → lands on detail page with Admission tab active.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/claims/ClaimList.js
git commit -m "feat(claims): list-row pencil now deep-links to Admission tab"
```

---

## Task 8: Redirect legacy `/claims/:id/edit` route to `?tab=admission`

**Files:**
- Modify: `frontend/src/App.js:50`

Old bookmarks and any direct links continue to work; they just land on the new tab.

- [ ] **Step 1: Extend the react-router-dom import with `useParams`**

Find at `App.js:2`:

```js
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
```

Replace with:

```js
import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
```

- [ ] **Step 2: Define a `ClaimEditRedirect` component**

Add this component definition just above the existing `function App()` (or `const App = ...`) declaration in `App.js`:

```js
const ClaimEditRedirect = () => {
  const { id } = useParams();
  return <Navigate to={`/claims/${id}?tab=admission`} replace />;
};
```

- [ ] **Step 3: Replace the `/claims/:id/edit` route element**

Find at `App.js:50`:

```jsx
<Route path="/claims/:id/edit" element={<ProtectedRoute module="claims"><ClaimForm /></ProtectedRoute>} />
```

Replace with:

```jsx
<Route path="/claims/:id/edit" element={<ProtectedRoute module="claims"><ClaimEditRedirect /></ProtectedRoute>} />
```

- [ ] **Step 4: Verify**

In the browser, visit `/claims/<some-id>/edit` directly. Confirm the URL is replaced with `/claims/<some-id>?tab=admission` and the Admission tab is active.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.js
git commit -m "feat(claims): redirect /claims/:id/edit to ?tab=admission"
```

---

## Task 9: End-to-end manual verification pass

**Files:** none — verification only.

A focused walk-through to confirm the spec's testing checklist holds.

- [ ] **Step 1: Walk the spec testing checklist in the browser**

Run dev server (`cd frontend && npm start`). Walk through each item:

- Click pencil icon on list row (desktop and mobile) → lands on detail page, Admission tab active, fields populated.
- Click pencil icon in detail header → switches to Admission tab without navigation; URL updates to `?tab=admission`.
- Edit an admission field, click Save Admission → toast "Admission details saved", values persist after browser reload.
- Upload an admission file via "Add Files", click Save → file appears in admission documents list and in the Documents tab count.
- Delete an admission document → confirmation prompt, document removed, Documents tab count updates.
- Visit `/claims/<id>/edit` → URL replaced with `/claims/<id>?tab=admission`, Admission tab active.
- Log in as a user without `claims.edit` permission → Admission tab is visible but read-only (StatCards, no inputs, no Save).
- Click each tab in turn (Overview, Admission, Discharge, File & Submit, Settlement, Documents) — URL `?tab=` updates correctly for each.
- Reload on `/claims/<id>?tab=settlement` → Settlement tab is active.
- Mobile validation: enter "1234" in patient mobile → inline red error appears; Save button blocked.
- Create-new-claim flow: visit `/claims/new` → ClaimForm renders normally (unchanged).

- [ ] **Step 2: If any check fails**

Stop. Diagnose with `superpowers:systematic-debugging`. Fix in a new commit. Re-run the failing checklist item.

- [ ] **Step 3: When the full checklist passes, finalize**

```bash
git log --oneline -10
```

Confirm all task commits are present.

---

## Decisions deferred to a follow-up PR

These are explicitly **out of scope** for this plan but noted so the next change knows:

- Removing the `isEdit` branch from `ClaimForm.js` (we left it unreachable for safety).
- Removing the `monthClaimNo` field from the Admission tab if the field turns out to be deprecated — confirm with the user first.
- Replacing the row-level pencil icon entirely with a single "Open claim" affordance (only after observing usage).

---

## Self-review notes

Spec coverage:
- Tab structure ✔ (Task 2)
- Patient + Insurance editable fields ✔ (Task 5)
- Admission documents via `DocsSubsection` ✔ (Task 5)
- `handleSaveAdmission` ✔ (Task 4)
- State additions (`admissionForm`, pendingFiles.admission) ✔ (Task 3)
- Validation parity with ClaimForm (mobile, required fields) ✔ (Task 4 handler + Task 5 inline error UI)
- URL `?tab=` deep linking ✔ (Task 1)
- List-row pencil entry-point ✔ (Task 7)
- Detail-header pencil entry-point ✔ (Task 6)
- Legacy `/claims/:id/edit` redirect ✔ (Task 8)
- Permissions (read-only when no edit perm) ✔ (Task 5)
- Testing checklist walk-through ✔ (Task 9)
