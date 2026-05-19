# Reports Tab Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance the Reports page with date-range filtering, dynamic status loading, super-admin-only File Price visibility, and a Generate Bill export for super admins.

**Architecture:** All four changes are isolated — backend adds two new query params (`dateFrom`/`dateTo`) to the existing `getClaims` controller; frontend updates `Reports.js` in-place to consume the new params, load statuses from the API, gate File Price behind `roleSlug === 'super_admin'`, and add a Generate Bill dropdown.

**Tech Stack:** React 18, Tailwind CSS v3, Node.js + Express 5, Prisma (MongoDB)

---

### Task 1: Backend — add `dateFrom` / `dateTo` filter to `getClaims`

**Files:**
- Modify: `backend/controllers/claimController.js` (line 98)

- [ ] **Step 1: Add `dateFrom` and `dateTo` to the destructured query params**

In `getClaims`, find this line (line 98):
```js
const { hospital, status, claimType, month, search, page = 1, limit = 20 } = req.query;
```
Replace with:
```js
const { hospital, status, claimType, month, dateFrom, dateTo, search, page = 1, limit = 20 } = req.query;
```

- [ ] **Step 2: Add the date-range filter block after the existing `month` block**

After the `if (month) { ... }` block (which ends around line 116), add:
```js
if (dateFrom || dateTo) {
  where.month = where.month || {};
  if (dateFrom) {
    const d = new Date(dateFrom);
    d.setHours(0, 0, 0, 0);
    where.month.gte = d;
  }
  if (dateTo) {
    const d = new Date(dateTo);
    d.setHours(23, 59, 59, 999);
    where.month.lte = d;
  }
}
```

- [ ] **Step 3: Verify the server starts without errors**

```bash
cd /Users/priyanshshah/Documents/ClaimOptiq/backend && node -e "require('./controllers/claimController')" && echo OK
```
Expected output: `OK`

- [ ] **Step 4: Commit**

```bash
git add backend/controllers/claimController.js
git commit -m "feat: add dateFrom/dateTo query params to getClaims"
```

---

### Task 2: Frontend — load statuses from Claim Status Master

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

- [ ] **Step 1: Import `getClaimStatusesAPI` at the top of `Reports.js`**

Find the existing import line:
```js
import { getClaimsAPI, getHospitalsAPI } from '../../services/api';
```
Replace with:
```js
import { getClaimsAPI, getHospitalsAPI, getClaimStatusesAPI } from '../../services/api';
```

- [ ] **Step 2: Add `claimStatuses` state**

After the existing `const [loading, setLoading] = useState(false);` line, add:
```js
const [claimStatuses, setClaimStatuses] = useState([]);
```

- [ ] **Step 3: Fetch statuses on mount**

Replace the existing `useEffect` block:
```js
useEffect(() => {
  if (!isHospitalUser) {
    getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
  }
}, [isHospitalUser]);
```
With:
```js
useEffect(() => {
  if (!isHospitalUser) {
    getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
  }
  getClaimStatusesAPI()
    .then(({ data }) => setClaimStatuses(data.filter(s => s.isActive !== false)))
    .catch(() => {});
}, [isHospitalUser]);
```

- [ ] **Step 4: Replace hardcoded status `<select>` options with dynamic ones**

Find the status select element (the one with hardcoded options for admitted, discharged, etc.):
```jsx
<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
  <option value="">All Status</option>
  <option value="admitted">Admitted</option>
  <option value="discharged">Discharged</option>
  <option value="submitted">Submitted</option>
  <option value="settled">Settled</option>
  <option value="rejected">Rejected</option>
</select>
```
Replace with:
```jsx
<select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
  <option value="">All Status</option>
  {claimStatuses.map(s => (
    <option key={s.id} value={s.slug}>{s.label}</option>
  ))}
</select>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat: load statuses from claim status master in reports"
```

---

### Task 3: Frontend — replace month picker with date range filter

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

- [ ] **Step 1: Update the initial filter state**

Find:
```js
const [filters, setFilters] = useState({ hospital: '', month: '', status: '' });
```
Replace with:
```js
const [filters, setFilters] = useState({ hospital: '', dateFrom: '', dateTo: '', status: '' });
```

- [ ] **Step 2: Update `generateReport` to send `dateFrom`/`dateTo` instead of `month`**

Find inside `generateReport`:
```js
if (filters.month) params.month = filters.month;
```
Replace with:
```js
if (filters.dateFrom) params.dateFrom = filters.dateFrom;
if (filters.dateTo) params.dateTo = filters.dateTo;
```

- [ ] **Step 3: Replace the `DateInput` month picker with two date inputs**

Remove the `DateInput` import if it's only used for the month picker:
```js
import DateInput from '../../components/ui/DateInput';
```
(Remove this line only if `DateInput` is not used elsewhere in the file.)

Find the `DateInput` JSX:
```jsx
<DateInput type="month" value={filters.month}
  onChange={(e) => setFilters({ ...filters, month: e.target.value })} />
```
Replace with two native date inputs:
```jsx
<input
  type="date"
  value={filters.dateFrom}
  onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
  placeholder="From Date"
  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
/>
<input
  type="date"
  value={filters.dateTo}
  onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
  placeholder="To Date"
  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
/>
```

- [ ] **Step 4: Fix the filter grid column count**

The grid now has one extra column (two date inputs instead of one month input). Update the grid class. Find:
```jsx
<div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
```
Replace with:
```jsx
<div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${isHospitalUser ? 'lg:grid-cols-4' : 'lg:grid-cols-5'}`}>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat: replace month picker with date range filter in reports"
```

---

### Task 4: Frontend — hide File Price from non-super-admin users

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

- [ ] **Step 1: Expose `roleSlug` from `useAuth`**

Find:
```js
const { user } = useAuth();
```
Replace with:
```js
const { user, roleSlug } = useAuth();
```

- [ ] **Step 2: Derive `isSuperAdmin` boolean**

After the `const isHospitalUser = !!user?.hospital;` line, add:
```js
const isSuperAdmin = roleSlug === 'super_admin';
```

- [ ] **Step 3: Hide the "Total Revenue (File Price)" summary card**

Find the summary card for file price:
```jsx
<div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
  <p className="text-2xl font-bold text-green-600">{formatAmount(totalFilePrice)}</p>
  <p className="text-xs text-gray-500">Total Revenue (File Price)</p>
</div>
```
Wrap it:
```jsx
{isSuperAdmin && (
  <div className="bg-white rounded-xl border border-gray-200 p-4 text-center">
    <p className="text-2xl font-bold text-green-600">{formatAmount(totalFilePrice)}</p>
    <p className="text-xs text-gray-500">Total Revenue (File Price)</p>
  </div>
)}
```

- [ ] **Step 4: Hide the "File Price" table header column**

Find the table headers array:
```jsx
{['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', 'File Price'].map(h => (
```
Replace with:
```jsx
{['SR', 'Patient', ...(!isHospitalUser ? ['Hospital'] : []), 'Type', 'Hospital Bill', 'Approval', 'Settlement', 'TDS', 'Bank Amt', 'Status', ...(isSuperAdmin ? ['File Price'] : [])].map(h => (
```

- [ ] **Step 5: Hide the "File Price" table data cell**

Find the File Price `<td>` in the row:
```jsx
<td className="py-2 px-3">{formatAmount(c.filePrice)}</td>
```
Wrap it:
```jsx
{isSuperAdmin && <td className="py-2 px-3">{formatAmount(c.filePrice)}</td>}
```

- [ ] **Step 6: Fix `colSpan` on the empty-state row**

Find:
```jsx
<tr><td colSpan={isHospitalUser ? 10 : 11} className="py-8 text-center text-gray-400">
```
Replace with:
```jsx
<tr><td colSpan={isHospitalUser ? (isSuperAdmin ? 10 : 9) : (isSuperAdmin ? 11 : 10)} className="py-8 text-center text-gray-400">
```

- [ ] **Step 7: Strip File Price from CSV export for non-super-admins**

Find the `exportCSV` function headers array:
```js
const headers = ['SR', 'Month', 'Patient Name', 'Hospital', 'Claim Type', 'Insurance', 'TPA',
  'Policy No', 'DOA', 'DOD', 'Hospital Bill', 'Deduction', 'Final Approval',
  'Settlement Amount', 'TDS', 'Bank Transfer', 'Status', 'File Price'];
```
Replace with:
```js
const headers = ['SR', 'Month', 'Patient Name', 'Hospital', 'Claim Type', 'Insurance', 'TPA',
  'Policy No', 'DOA', 'DOD', 'Hospital Bill', 'Deduction', 'Final Approval',
  'Settlement Amount', 'TDS', 'Bank Transfer', 'Status',
  ...(isSuperAdmin ? ['File Price'] : [])];
```

Find the rows mapping:
```js
const rows = claims.map(c => [
  c.srNo, c.month ? new Date(c.month).toLocaleDateString('en-IN') : '',
  c.patientName, c.hospital?.name || '', c.claimType,
  c.insuranceCompany?.name || '', c.tpa?.name || '',
  c.policyNo, c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
  c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
  c.hospitalFinalBill, c.deduction, c.finalApprovalAmount,
  c.settlementAmount, c.tds, c.bankTransferAmount, c.status, c.filePrice
]);
```
Replace with:
```js
const rows = claims.map(c => [
  c.srNo, c.month ? new Date(c.month).toLocaleDateString('en-IN') : '',
  c.patientName, c.hospital?.name || '', c.claimType,
  c.insuranceCompany?.name || '', c.tpa?.name || '',
  c.policyNo, c.dateOfAdmit ? new Date(c.dateOfAdmit).toLocaleDateString('en-IN') : '',
  c.dateOfDischarge ? new Date(c.dateOfDischarge).toLocaleDateString('en-IN') : '',
  c.hospitalFinalBill, c.deduction, c.finalApprovalAmount,
  c.settlementAmount, c.tds, c.bankTransferAmount, c.status,
  ...(isSuperAdmin ? [c.filePrice] : [])
]);
```

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat: hide file price from non-super-admin users in reports"
```

---

### Task 5: Frontend — Generate Bill button for super admin

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

- [ ] **Step 1: Add `billDropdownOpen` state**

After `const [loading, setLoading] = useState(false);`, add:
```js
const [billDropdownOpen, setBillDropdownOpen] = useState(false);
```

- [ ] **Step 2: Add the `exportBillGrouped` function (Group by Hospital)**

After the existing `exportCSV` function, add:
```js
const exportBillGrouped = () => {
  if (!claims.length) return;
  setBillDropdownOpen(false);
  const grouped = {};
  claims.forEach(c => {
    const name = c.hospital?.name || 'Unknown';
    if (!grouped[name]) {
      grouped[name] = { count: 0, totalBill: 0, totalApproval: 0, totalSettlement: 0, totalBank: 0, totalFilePrice: 0 };
    }
    grouped[name].count += 1;
    grouped[name].totalBill += c.hospitalFinalBill || 0;
    grouped[name].totalApproval += c.finalApprovalAmount || 0;
    grouped[name].totalSettlement += c.settlementAmount || 0;
    grouped[name].totalBank += c.bankTransferAmount || 0;
    grouped[name].totalFilePrice += c.filePrice || 0;
  });

  const headers = ['Hospital', 'No. of Claims', 'Total Hospital Bill', 'Total Approval Amount', 'Total Settlement', 'Total Bank Transfer', 'Total File Price'];
  const rows = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, g]) => [name, g.count, g.totalBill, g.totalApproval, g.totalSettlement, g.totalBank, g.totalFilePrice]);

  const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bill_grouped_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

- [ ] **Step 3: Add the `exportBillAll` function (All Claims)**

After `exportBillGrouped`, add:
```js
const exportBillAll = () => {
  setBillDropdownOpen(false);
  exportCSV();
};
```

- [ ] **Step 4: Add the Generate Bill button with dropdown to the filter bar**

Find the actions div in the filter bar:
```jsx
<div className="flex gap-2">
  <button onClick={generateReport} disabled={loading}
    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
    {loading ? 'Loading...' : 'Generate'}
  </button>
  <button onClick={exportCSV} disabled={!claims.length}
    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
    <HiOutlineDownload className="w-4 h-4" /> CSV
  </button>
</div>
```
Replace with:
```jsx
<div className="flex gap-2">
  <button onClick={generateReport} disabled={loading}
    className="flex-1 bg-primary-600 hover:bg-primary-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
    {loading ? 'Loading...' : 'Generate'}
  </button>
  <button onClick={exportCSV} disabled={!claims.length}
    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
    <HiOutlineDownload className="w-4 h-4" /> CSV
  </button>
  {isSuperAdmin && (
    <div className="relative">
      <button
        onClick={() => setBillDropdownOpen(o => !o)}
        disabled={!claims.length}
        className="flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 whitespace-nowrap"
      >
        <HiOutlineDownload className="w-4 h-4" /> Generate Bill
      </button>
      {billDropdownOpen && (
        <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-lg shadow-lg z-10">
          <button
            onClick={exportBillGrouped}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
          >
            Group by Hospital
          </button>
          <button
            onClick={exportBillAll}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 rounded-b-lg border-t border-gray-100"
          >
            All Claims Report
          </button>
        </div>
      )}
    </div>
  )}
</div>
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat: add Generate Bill button with group-by-hospital and all-claims export for super admin"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - File Price hidden for non-super-admin → Task 4
  - Date range filter (frontend + backend) → Task 1 + Task 3
  - Statuses from claim status master → Task 2
  - Generate Bill with two export options → Task 5
- [x] **No placeholders** — all steps contain actual code
- [x] **Type consistency** — `isSuperAdmin`, `billDropdownOpen`, `claimStatuses` defined before use
- [x] **`colSpan` fix** accounts for both `isHospitalUser` and `isSuperAdmin` combinations
- [x] **CSV export** strips File Price correctly in both the regular export and `exportBillAll` (which calls `exportCSV` directly, inheriting the guard)
