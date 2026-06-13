# Phase 2.0 — Reference Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `Hospital.referenceBy` from a free string into a first-class `Reference` master with name/mobile/address/commission %/applicable-services multi-select, behind RBAC, surfaced in the Hospital form and Reports filter.

**Architecture:** New Prisma model `Reference` + many-to-many `ReferenceApplicableService` linking to existing `BillingServiceName`. Hospital gets a nullable `referenceId` FK alongside the kept-for-backcompat `referenceBy` string (auto-synced on save). Express CRUD controller + routes following the TPA pattern. React master page following `TPAList.js`. Hospital form replaces text input with a searchable dropdown that gracefully falls back to text.

**Tech Stack:** Prisma 7 + PostgreSQL, Express 5, React 19 + Tailwind v3 (CRA), react-icons/hi, react-toastify.

**Testing convention deviation:** The backend has **no automated test framework configured** (no jest/mocha/test script in `backend/package.json`, no existing tests). Adding jest+supertest just for this module is scope creep relative to the team's convention. Verification in this plan uses **bash + curl smoke scripts** that exit non-zero on failure. Frontend verification is manual via the running dev server. If/when the team adopts jest, the smoke scripts can be ported.

**Tip:** Most tasks end with a commit step. Use a feature branch (e.g. `phase-2-0-reference-master`) so the seven commits stay together.

---

## File map

**Create:**
- `backend/prisma/migrations/20260613000000_add_reference_master/migration.sql` (Prisma will generate)
- `backend/controllers/referenceController.js`
- `backend/routes/referenceRoutes.js`
- `backend/scripts/smoke-reference.sh`
- `frontend/src/pages/references/ReferenceList.js`
- `frontend/src/pages/references/ReferenceFormModal.js`

**Modify:**
- `backend/prisma/schema.prisma` (add `Reference`, `ReferenceApplicableService`, `Hospital.referenceId` + relation)
- `backend/seed.js` (add `references` module to `allModules` and to super_admin/fcc_staff permission maps)
- `backend/server.js` (mount `/api/references`)
- `backend/controllers/hospitalController.js` (accept `referenceId`, snapshot `referenceBy`, include reference in responses)
- `frontend/src/services/api.js` (add reference API client)
- `frontend/src/App.js` (add `/references` route)
- `frontend/src/components/layout/Sidebar.js` (add Reference entry in adminItems)
- `frontend/src/pages/hospitals/HospitalForm.js` (replace plain `referenceBy` input with searchable dropdown + text fallback)
- `frontend/src/pages/reports/Reports.js` (extend reference distinct values to union references + legacy strings)

---

## Task 1: Add Reference Prisma models + Hospital.referenceId

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/20260613000000_add_reference_master/migration.sql` (auto-generated)

- [ ] **Step 1: Add `Reference` and `ReferenceApplicableService` models, add `referenceId` FK to `Hospital`, add back-relation to `BillingServiceName`**

Edit `backend/prisma/schema.prisma`. Insert these models **after** the `BillingServiceName` model (so the schema stays grouped):

```prisma
model Reference {
  id              String   @id @default(uuid())
  name            String
  mobile          String   @default("")
  address         String   @default("")
  commissionRate  Float    @default(0) @map("commission_rate")
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  applicableServices ReferenceApplicableService[]
  hospitals          Hospital[]

  @@index([name])
  @@map("references")
}

model ReferenceApplicableService {
  id                   String @id @default(uuid())
  referenceId          String @map("reference_id")
  billingServiceNameId String @map("billing_service_name_id")

  reference            Reference          @relation(fields: [referenceId], references: [id], onDelete: Cascade)
  billingServiceName   BillingServiceName @relation(fields: [billingServiceNameId], references: [id], onDelete: Cascade)

  @@unique([referenceId, billingServiceNameId])
  @@map("reference_applicable_services")
}
```

In the existing `BillingServiceName` model, add this relation line just above the closing brace:

```prisma
  referenceApplicableTo ReferenceApplicableService[]
```

In the existing `Hospital` model, find the existing `referenceBy String @default("") @map("reference_by")` line. Add **immediately after it**:

```prisma
  referenceId       String?    @map("reference_id")
  reference         Reference? @relation(fields: [referenceId], references: [id])
```

Do NOT remove or rename `referenceBy`. It stays.

- [ ] **Step 2: Generate the migration**

Run from `backend/`:

```bash
npx prisma migrate dev --name add_reference_master
```

Expected output ends with:
```
Your database is now in sync with your schema.
✔ Generated Prisma Client
```

This creates `backend/prisma/migrations/<timestamp>_add_reference_master/migration.sql`. Verify the file contains a `CREATE TABLE "references"`, `CREATE TABLE "reference_applicable_services"`, and `ALTER TABLE "hospitals" ADD COLUMN "reference_id"`.

- [ ] **Step 3: Verify the Prisma client compiled**

```bash
node -e "const p = require('./config/prisma'); console.log(typeof p.reference.findMany);"
```

Expected output: `function`

- [ ] **Step 4: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations
git commit -m "feat(phase-2-0): add Reference master + Hospital.referenceId schema"
```

---

## Task 2: Seed RBAC permissions for `references` module

**Files:**
- Modify: `backend/seed.js`

- [ ] **Step 1: Add `'references'` to the `allModules` array**

In `backend/seed.js`, find:

```js
const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions', 'staff',
];
```

Replace with:

```js
const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions', 'staff',
  'references',
];
```

- [ ] **Step 2: Grant super_admin full perms on `references`**

In the `super_admin` role's `buildPermissions({...})` object, find the `tpa: {...},` line and insert **after it**:

```js
      references:           { view: true, create: true, edit: true, delete: true },
```

- [ ] **Step 3: Grant fcc_staff view perm on `references`**

In the `fcc_staff` role's `buildPermissions({...})` object, find the `tpa: { view: true },` line and insert **after it**:

```js
      references:           { view: true },
```

(Hospital_admin and hospital_staff intentionally get no perms — references are FCC internal.)

- [ ] **Step 4: Re-seed**

```bash
cd backend && npm run seed
```

Expected output includes `✓ 4 roles` and no errors.

- [ ] **Step 5: Verify the permission landed**

```bash
node -e "const p = require('./config/prisma'); p.roleModulePermission.findFirst({where: {module: 'references', role: {slug: 'super_admin'}}}).then(r => console.log(r)).finally(() => p.\$disconnect());"
```

Expected: a row printed showing `view: true, create: true, edit: true, delete: true`.

- [ ] **Step 6: Commit**

```bash
git add backend/seed.js
git commit -m "feat(phase-2-0): seed references module RBAC"
```

---

## Task 3: Reference controller (CRUD)

**Files:**
- Create: `backend/controllers/referenceController.js`

- [ ] **Step 1: Write the controller**

Create `backend/controllers/referenceController.js` with this content:

```js
const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.mobile !== undefined) data.mobile = String(body.mobile || '').trim();
  if (body.address !== undefined) data.address = String(body.address || '').trim();
  if (body.commissionRate !== undefined) {
    const n = Number(body.commissionRate);
    data.commissionRate = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

const referenceInclude = {
  applicableServices: {
    include: { billingServiceName: { select: { id: true, name: true } } },
  },
};

const buildApplicableServicesCreate = (ids) =>
  Array.isArray(ids)
    ? [...new Set(ids.filter(Boolean))].map((billingServiceNameId) => ({ billingServiceNameId }))
    : [];

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'Name is required' });
    const item = await prisma.reference.create({
      data: {
        ...data,
        applicableServices: { create: buildApplicableServicesCreate(req.body.applicableServiceIds) },
      },
      include: referenceInclude,
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { search, active } = req.query;
    const where = {};
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const items = await prisma.reference.findMany({
      where,
      include: referenceInclude,
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.reference.findUnique({
      where: { id: req.params.id },
      include: referenceInclude,
    });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await prisma.reference.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = pickFields(req.body);

    // Replace applicable services as a whole if the client sent the array.
    const willReplaceServices = Array.isArray(req.body.applicableServiceIds);

    const item = await prisma.$transaction(async (tx) => {
      if (willReplaceServices) {
        await tx.referenceApplicableService.deleteMany({ where: { referenceId: id } });
      }
      return tx.reference.update({
        where: { id },
        data: {
          ...data,
          ...(willReplaceServices
            ? { applicableServices: { create: buildApplicableServicesCreate(req.body.applicableServiceIds) } }
            : {}),
        },
        include: referenceInclude,
      });
    });

    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    const linked = await prisma.hospital.count({ where: { referenceId: id } });
    if (linked > 0) {
      // Soft-delete: keep history, just hide from active list.
      await prisma.reference.update({ where: { id }, data: { isActive: false } });
      return res.json({ message: `Deactivated (still linked to ${linked} hospital${linked === 1 ? '' : 's'})` });
    }
    await prisma.reference.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const hospitals = await prisma.hospital.findMany({
      where: { referenceId: req.params.id },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(hospitals));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
```

- [ ] **Step 2: Sanity-check it loads without syntax errors**

```bash
node -e "require('./backend/controllers/referenceController.js'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/controllers/referenceController.js
git commit -m "feat(phase-2-0): reference master CRUD controller"
```

---

## Task 4: Reference routes + mount in server

**Files:**
- Create: `backend/routes/referenceRoutes.js`
- Modify: `backend/server.js`

- [ ] **Step 1: Write the routes file**

Create `backend/routes/referenceRoutes.js`:

```js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/referenceController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('references', 'view'), ctrl.getAll)
  .post(checkPermission('references', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('references', 'view'), ctrl.getOne)
  .put(checkPermission('references', 'edit'), ctrl.update)
  .delete(checkPermission('references', 'delete'), ctrl.remove);

router.get('/:id/hospitals', checkPermission('references', 'view'), ctrl.getHospitals);

module.exports = router;
```

- [ ] **Step 2: Mount in server.js**

In `backend/server.js`, find:

```js
app.use('/api/billing-service-names', require('./routes/billingServiceNameRoutes'));
```

Insert **on the next line**:

```js
app.use('/api/references', require('./routes/referenceRoutes'));
```

- [ ] **Step 3: Start the dev server in the background**

```bash
cd backend && node server.js > /tmp/server.log 2>&1 &
echo $! > /tmp/server.pid
sleep 2
curl -s http://localhost:5001/api/health
```

Expected: `{"status":"OK","message":"ClaimOptiq API is running"}`

If the server crashed, check `/tmp/server.log`.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/referenceRoutes.js backend/server.js
git commit -m "feat(phase-2-0): mount /api/references"
```

---

## Task 5: Backend smoke test

**Files:**
- Create: `backend/scripts/smoke-reference.sh`

- [ ] **Step 1: Write the smoke script**

Create `backend/scripts/smoke-reference.sh`:

```bash
#!/usr/bin/env bash
# Reference master smoke test. Exits non-zero on any failure.
# Run with: bash backend/scripts/smoke-reference.sh
set -euo pipefail

API="${API:-http://localhost:5001/api}"
EMAIL="${EMAIL:-admin@claimoptiq.com}"
PASSWORD="${PASSWORD:-Admin@123}"

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }
pass() { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

say "Login as super_admin"
TOKEN=$(curl -fsS -X POST "$API/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | node -e 'process.stdin.on("data",d=>{const j=JSON.parse(d);process.stdout.write(j.token||"")})')
[[ -n "$TOKEN" ]] || fail "login failed"
H=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')
pass "logged in"

say "Pick two billing-service-name ids"
BSN=$(curl -fsS "${H[@]}" "$API/billing-service-names")
ID1=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write((a[0]&&a[0]._id)||'')" "$BSN")
ID2=$(node -e "const a=JSON.parse(process.argv[1]); process.stdout.write((a[1]&&a[1]._id)||'')" "$BSN")
[[ -n "$ID1" && -n "$ID2" ]] || fail "need at least 2 billing service names seeded; add them in Settings → Billing Service Names first"
pass "applicable services: $ID1, $ID2"

say "Create Reference"
CREATED=$(curl -fsS -X POST "${H[@]}" "$API/references" -d "{
  \"name\":\"Smoke Test Ref\",
  \"mobile\":\"9876543210\",
  \"address\":\"Surat\",
  \"commissionRate\":5,
  \"applicableServiceIds\":[\"$ID1\",\"$ID2\"]
}")
REF_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1])._id||'')" "$CREATED")
[[ -n "$REF_ID" ]] || fail "create returned no id; got: $CREATED"
SVC_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).applicableServices.length))" "$CREATED")
[[ "$SVC_COUNT" == "2" ]] || fail "expected 2 applicable services, got $SVC_COUNT"
pass "created $REF_ID with 2 services"

say "List references"
LIST=$(curl -fsS "${H[@]}" "$API/references")
node -e "const a=JSON.parse(process.argv[1]); if(!a.some(r=>r._id===process.argv[2])) process.exit(1)" "$LIST" "$REF_ID" || fail "list does not contain new reference"
pass "list contains it"

say "Replace applicable services to one"
UPDATED=$(curl -fsS -X PUT "${H[@]}" "$API/references/$REF_ID" -d "{
  \"commissionRate\":7,
  \"applicableServiceIds\":[\"$ID1\"]
}")
NEW_COUNT=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).applicableServices.length))" "$UPDATED")
[[ "$NEW_COUNT" == "1" ]] || fail "expected 1 service after replace, got $NEW_COUNT"
NEW_RATE=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).commissionRate))" "$UPDATED")
[[ "$NEW_RATE" == "7" ]] || fail "expected rate 7, got $NEW_RATE"
pass "updated rate and services"

say "Attach to a hospital, verify soft-delete branch"
HOSP_LIST=$(curl -fsS "${H[@]}" "$API/hospitals")
HOSP_ID=$(node -e "const a=JSON.parse(process.argv[1]); const x=Array.isArray(a)?a:a.hospitals; process.stdout.write((x[0]&&x[0]._id)||'')" "$HOSP_LIST")
[[ -n "$HOSP_ID" ]] || fail "no hospitals exist"
curl -fsS -X PUT "${H[@]}" "$API/hospitals/$HOSP_ID" -d "{\"referenceId\":\"$REF_ID\"}" > /dev/null
DEL=$(curl -fsS -X DELETE "${H[@]}" "$API/references/$REF_ID")
node -e "const j=JSON.parse(process.argv[1]); if(!/Deactivated/.test(j.message)) process.exit(1)" "$DEL" || fail "expected soft-delete message, got: $DEL"
pass "soft-delete branch triggered while linked"

say "Detach + hard-delete branch"
curl -fsS -X PUT "${H[@]}" "$API/hospitals/$HOSP_ID" -d "{\"referenceId\":null}" > /dev/null
HARD=$(curl -fsS -X DELETE "${H[@]}" "$API/references/$REF_ID")
node -e "const j=JSON.parse(process.argv[1]); if(j.message!=='Deleted') process.exit(1)" "$HARD" || fail "expected hard-delete, got: $HARD"
pass "hard-delete branch triggered"

printf '\n\033[1;32m✅ smoke passed\033[0m\n'
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x backend/scripts/smoke-reference.sh
```

- [ ] **Step 3: Run it (the dev server from Task 4 should still be up)**

```bash
bash backend/scripts/smoke-reference.sh
```

Expected: ends with `✅ smoke passed`.

The hospital-attach step in this script depends on Task 6 (`hospitalController` accepting `referenceId`). If it fails on the attach step with "referenceId is not a valid field," skip ahead and run Task 6 first, then re-run this smoke. If you want a green run in pure Task 5 order, comment out the "Attach to a hospital" section before running and re-enable it after Task 6.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/smoke-reference.sh
git commit -m "test(phase-2-0): reference master smoke script"
```

---

## Task 6: Hospital controller accepts `referenceId` + snapshots `referenceBy`

**Files:**
- Modify: `backend/controllers/hospitalController.js`

- [ ] **Step 1: Extend `buildHospitalData`**

In `backend/controllers/hospitalController.js`, find the existing `buildHospitalData` function:

```js
const buildHospitalData = (body) => ({
  name: body.name,
  contact: body.contact || '',
  email: body.email || '',
  phone: body.phone || '',
  address: body.address || '',
  city: body.city || '',
  state: body.state || '',
  pincode: body.pincode || '',
  referenceBy: body.referenceBy || '',
  isActive: body.isActive !== undefined ? body.isActive : true,
});
```

Replace the function with this async version (it needs an awaited lookup to snapshot the name):

```js
const buildHospitalData = async (body) => {
  let referenceId = body.referenceId === '' ? null : body.referenceId ?? undefined;
  let referenceByFromRef;
  if (referenceId) {
    const ref = await prisma.reference.findUnique({ where: { id: referenceId }, select: { name: true } });
    if (!ref) {
      const err = new Error('Reference not found');
      err.status = 400;
      throw err;
    }
    referenceByFromRef = ref.name;
  } else if (referenceId === null) {
    // explicit detach: clear the snapshot too
    referenceByFromRef = '';
  }
  const data = {
    name: body.name,
    contact: body.contact || '',
    email: body.email || '',
    phone: body.phone || '',
    address: body.address || '',
    city: body.city || '',
    state: body.state || '',
    pincode: body.pincode || '',
    isActive: body.isActive !== undefined ? body.isActive : true,
  };
  if (referenceId !== undefined) data.referenceId = referenceId;
  // referenceBy precedence: explicit body wins, else snapshot from ref, else legacy fallback
  if (body.referenceBy !== undefined) data.referenceBy = body.referenceBy || '';
  else if (referenceByFromRef !== undefined) data.referenceBy = referenceByFromRef;
  else data.referenceBy = '';
  return data;
};
```

- [ ] **Step 2: Await the now-async builder in all four callers**

The function is called four times in this file. Make each call `await`-ed and ensure the surrounding function is `async` (they already are):

Find every occurrence of `buildHospitalData(...)` in `backend/controllers/hospitalController.js` and prefix with `await`. Specifically (search to confirm — line numbers may have shifted):

- `bulkImportHospitals`: `const data = buildHospitalData({ name, ... })` → `const data = await buildHospitalData({ name, ... })`
- `createHospital`: `...buildHospitalData(req.body),` → `...(await buildHospitalData(req.body)),`
- `updateHospital`: `...buildHospitalData(req.body),` → `...(await buildHospitalData(req.body)),`

- [ ] **Step 3: Wrap the new throw in a 400 in `createHospital` and `updateHospital`**

In both `createHospital` and `updateHospital`, the existing `try { ... } catch (error) { res.status(500)... }` block needs to respect the 400 we throw. Find the catch block in each (they look like `res.status(500).json(...)`) and change it to:

```js
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
```

(Leave `bulkImportHospitals` as-is — it already catches per-row errors into `errors[]`.)

- [ ] **Step 4: Include `reference` in hospital responses**

At the top of the file find:

```js
const hospitalInclude = {
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  doctors: true,
};
```

Replace with:

```js
const hospitalInclude = {
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  doctors: true,
  reference: { select: { id: true, name: true, commissionRate: true, isActive: true } },
};
```

And similarly for `hospitalListInclude`:

```js
const hospitalListInclude = {
  billingServices: { select: { id: true } },
  doctors: { select: { id: true } },
  reference: { select: { id: true, name: true } },
};
```

- [ ] **Step 5: Restart the dev server and re-run the smoke (now with the attach step enabled)**

```bash
kill "$(cat /tmp/server.pid)" 2>/dev/null || true
cd backend && node server.js > /tmp/server.log 2>&1 &
echo $! > /tmp/server.pid
sleep 2
bash backend/scripts/smoke-reference.sh
```

Expected: ends with `✅ smoke passed`.

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/hospitalController.js
git commit -m "feat(phase-2-0): hospital accepts referenceId and snapshots referenceBy"
```

---

## Task 7: Frontend API client + Reference list page

**Files:**
- Modify: `frontend/src/services/api.js`
- Create: `frontend/src/pages/references/ReferenceList.js`
- Create: `frontend/src/pages/references/ReferenceFormModal.js`

- [ ] **Step 1: Add the API client functions**

In `frontend/src/services/api.js`, find the TPA block:

```js
// TPA
export const getTPAAPI = () => API.get('/tpa');
export const createTPAAPI = (data) => API.post('/tpa', data);
export const updateTPAAPI = (id, data) => API.put(`/tpa/${id}`, data);
export const deleteTPAAPI = (id) => API.delete(`/tpa/${id}`);
export const importTPAAPI = (rows) => API.post('/tpa/import', { rows });
```

Insert **immediately after**:

```js
// References (Commission Master)
export const getReferencesAPI = (params) => API.get('/references', { params });
export const getReferenceAPI = (id) => API.get(`/references/${id}`);
export const createReferenceAPI = (data) => API.post('/references', data);
export const updateReferenceAPI = (id, data) => API.put(`/references/${id}`, data);
export const deleteReferenceAPI = (id) => API.delete(`/references/${id}`);
```

- [ ] **Step 2: Create the form modal**

Create `frontend/src/pages/references/ReferenceFormModal.js`:

```jsx
import React, { useEffect, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';

const blank = { name: '', mobile: '', address: '', commissionRate: 0, applicableServiceIds: [] };

const ReferenceFormModal = ({ open, initial, services, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        name: initial.name || '',
        mobile: initial.mobile || '',
        address: initial.address || '',
        commissionRate: initial.commissionRate ?? 0,
        applicableServiceIds: (initial.applicableServices || []).map(s => s.billingServiceName?._id || s.billingServiceNameId).filter(Boolean),
      });
    } else {
      setForm(blank);
    }
  }, [open, initial]);

  if (!open) return null;

  const toggleService = (id) => {
    setForm(f => ({
      ...f,
      applicableServiceIds: f.applicableServiceIds.includes(id)
        ? f.applicableServiceIds.filter(x => x !== id)
        : [...f.applicableServiceIds, id],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave({ ...form, commissionRate: Number(form.commissionRate) || 0 });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Reference' : 'Add Reference'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
              <input value={form.mobile} onChange={e => setForm(f => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                inputMode="numeric" maxLength={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Commission %</label>
              <input type="number" min="0" max="100" step="0.01"
                value={form.commissionRate} onChange={e => setForm(f => ({ ...f, commissionRate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
            <input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Applicable Services</label>
            {services.length === 0 ? (
              <p className="text-xs text-gray-400">No billing-service names exist yet. Create them in Settings → Billing Service Names first.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-2 space-y-1">
                {services.map(s => (
                  <label key={s._id} className="flex items-center gap-2 px-2 py-1 text-sm rounded hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={form.applicableServiceIds.includes(s._id)} onChange={() => toggleService(s._id)}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                    <span>{s.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReferenceFormModal;
```

- [ ] **Step 3: Create the list page**

Create `frontend/src/pages/references/ReferenceList.js`:

```jsx
import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getReferencesAPI, createReferenceAPI, updateReferenceAPI, deleteReferenceAPI,
  getBillingServiceNamesAPI,
} from '../../services/api';
import ReferenceFormModal from './ReferenceFormModal';

const ReferenceList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('references', 'create');
  const canEdit = can('references', 'edit');
  const canDelete = can('references', 'delete');

  const [items, setItems] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(r => (r.name || '').toLowerCase().includes(q) || (r.mobile || '').includes(q));
  }, [items, search]);

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = useMemo(
    () => filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [filtered, currentPage, pageSize],
  );

  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);

  const fetchAll = async () => {
    try {
      const [refs, svcs] = await Promise.all([getReferencesAPI(), getBillingServiceNamesAPI()]);
      setItems(refs.data);
      setServices(svcs.data);
    } catch { toast.error('Failed to load references'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateReferenceAPI(modal.item._id, form);
        toast.success('Reference updated');
      } else {
        await createReferenceAPI(form);
        toast.success('Reference added');
      }
      setModal({ open: false, item: null });
      fetchAll();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
      throw error;
    }
  };

  const handleDelete = async (item) => {
    if (!await confirm(`Delete "${item.name}"?`, { title: 'Delete Reference', confirmLabel: 'Delete' })) return;
    try {
      const { data } = await deleteReferenceAPI(item._id);
      toast.success(data.message || 'Deleted');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-800">References</h1>
          <p className="text-sm text-gray-500">Commission engine — commission % and applicable services per reference</p>
        </div>
        {canCreate && (
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg">
            <HiOutlinePlus className="w-4 h-4" /> Add Reference
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100">
          <div className="relative max-w-sm">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or mobile"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading...</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">No references found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left py-3 px-4">Name</th>
                  <th className="text-left py-3 px-4">Mobile</th>
                  <th className="text-left py-3 px-4">Commission %</th>
                  <th className="text-left py-3 px-4">Applicable Services</th>
                  <th className="text-left py-3 px-4">Status</th>
                  <th className="text-right py-3 px-4">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(r => (
                  <tr key={r._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-800">{r.name}</td>
                    <td className="py-3 px-4 text-gray-600">{r.mobile || '-'}</td>
                    <td className="py-3 px-4 text-gray-600">{r.commissionRate}%</td>
                    <td className="py-3 px-4 text-gray-600">
                      <div className="flex flex-wrap gap-1">
                        {(r.applicableServices || []).map(s => (
                          <span key={s._id} className="px-2 py-0.5 text-xs bg-primary-50 text-primary-700 rounded">
                            {s.billingServiceName?.name}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`text-xs px-2 py-0.5 rounded ${r.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && (
                          <button onClick={() => setModal({ open: true, item: r })}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => handleDelete(r)}
                            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && total > 0 && (
          <PaginationBar
            page={currentPage} pages={pages} total={total}
            pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
          />
        )}
      </div>

      <ReferenceFormModal
        open={modal.open}
        initial={modal.item}
        services={services}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default ReferenceList;
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/api.js frontend/src/pages/references
git commit -m "feat(phase-2-0): reference master list page + API client"
```

---

## Task 8: Route + Sidebar nav for References

**Files:**
- Modify: `frontend/src/App.js`
- Modify: `frontend/src/components/layout/Sidebar.js`

- [ ] **Step 1: Add the route**

In `frontend/src/App.js`, find:

```jsx
<Route path="/tpa" element={<ProtectedRoute module="tpa" requireManage><TPAList /></ProtectedRoute>} />
```

Add the import at the top of the file (next to the other page imports — search for `TPAList` import and add this on the next line):

```jsx
import ReferenceList from './pages/references/ReferenceList';
```

Insert this route **immediately after** the `/tpa` route line:

```jsx
<Route path="/references" element={<ProtectedRoute module="references" requireManage><ReferenceList /></ProtectedRoute>} />
```

- [ ] **Step 2: Add the sidebar item**

In `frontend/src/components/layout/Sidebar.js`, find:

```js
  { to: '/tpa',            label: 'TPA',                 icon: HiOutlineClipboardList,  module: 'tpa' },
```

Insert **immediately after**:

```js
  { to: '/references',     label: 'References',          icon: HiOutlineTag,            module: 'references' },
```

(`HiOutlineTag` is already imported at the top of the file — no new import needed.)

- [ ] **Step 3: Start the frontend dev server and verify**

```bash
cd frontend && npm start
```

Manual verification checklist (visit each URL in your browser, logged in as `admin@claimoptiq.com` / `Admin@123`):

1. `http://localhost:3000/references` — page renders, "Add Reference" button visible
2. Click Add → modal opens with name/mobile/address/commission/services
3. Create a reference with 2 applicable services → list shows it with chips
4. Edit it → uncheck one service, change rate, save → list updates
5. Delete it → confirm dialog → row gone
6. Sidebar admin section shows "References" between TPA and Users

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.js frontend/src/components/layout/Sidebar.js
git commit -m "feat(phase-2-0): route and sidebar entry for references"
```

---

## Task 9: HospitalForm — searchable dropdown for Reference with text fallback

**Files:**
- Modify: `frontend/src/pages/hospitals/HospitalForm.js`

- [ ] **Step 1: Add reference state and fetch**

At the top of `frontend/src/pages/hospitals/HospitalForm.js`, add to the imports (alongside existing `getHospitalsAPI` etc.):

```jsx
import { getReferencesAPI } from '../../services/api';
```

Inside the component, near other `useState` declarations, add:

```jsx
const [references, setReferences] = useState([]);
```

Add a `useEffect` (near the other initial-fetch effects) to load references:

```jsx
useEffect(() => {
  getReferencesAPI({ active: 'true' }).then(({ data }) => setReferences(data)).catch(() => setReferences([]));
}, []);
```

Add `referenceId: ''` to the existing `form` initial state object (find the line `referenceBy: ''` and insert a sibling key):

```jsx
city: '', state: '', pincode: '', referenceBy: '', referenceId: '',
```

If the form is initialised from a fetched hospital (search for the load-hospital effect that populates `form`), add `referenceId: data.referenceId || data.reference?._id || '',` to the destructure/spread.

- [ ] **Step 2: Replace the plain Reference By input with dropdown + fallback**

In `frontend/src/pages/hospitals/HospitalForm.js`, find the existing block around line 242–246:

```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">Reference By</label>
  <input name="referenceBy" value={form.referenceBy} onChange={handleChange}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
</div>
```

Replace with:

```jsx
<div>
  <label className="block text-sm font-medium text-gray-700 mb-1">Reference By</label>
  {references.length > 0 ? (
    <>
      <select
        value={form.referenceId || ''}
        onChange={(e) => {
          const id = e.target.value;
          const ref = references.find(r => r._id === id);
          setForm(f => ({ ...f, referenceId: id, referenceBy: ref ? ref.name : '' }));
        }}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
        <option value="">— Select reference —</option>
        {references.map(r => (
          <option key={r._id} value={r._id}>{r.name} ({r.commissionRate}%)</option>
        ))}
      </select>
      {!form.referenceId && form.referenceBy && (
        <p className="text-xs text-gray-400 mt-1">Legacy text: "{form.referenceBy}" (saved as-is until you pick a reference)</p>
      )}
    </>
  ) : (
    <input name="referenceBy" value={form.referenceBy} onChange={handleChange}
      placeholder="Free text (create a Reference master to enable dropdown)"
      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
  )}
</div>
```

- [ ] **Step 3: Manual verification**

With the frontend dev server still running:

1. Create at least one Reference at `/references` first.
2. Visit `/hospitals/new` → "Reference By" is now a dropdown with the reference + rate shown.
3. Pick a reference → save → list shows the hospital with that reference name.
4. Edit the same hospital → dropdown pre-selects the saved reference.
5. Visit `/hospitals/new` from a clean DB with zero references (you can temporarily soft-delete all of them) → falls back to text input. Re-activate references afterwards.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/hospitals/HospitalForm.js
git commit -m "feat(phase-2-0): HospitalForm reference dropdown with text fallback"
```

---

## Task 10: Reports — extend reference filter to include Reference master names

**Files:**
- Modify: `frontend/src/pages/reports/Reports.js`

- [ ] **Step 1: Find the existing reference-distinct-values block**

In `frontend/src/pages/reports/Reports.js` around line 75 there is a comment `// Distinct, sorted list of non-empty referenceBy values from active hospitals.` Read the 20–30 lines around it to see how the distinct list is built and where the filter dropdown reads from.

- [ ] **Step 2: Union with active references**

Add the API client at the top of the file (alongside existing API imports):

```jsx
import { getReferencesAPI } from '../../services/api';
```

Add state + fetch near other `useState`/`useEffect` blocks:

```jsx
const [referenceMaster, setReferenceMaster] = useState([]);
useEffect(() => {
  getReferencesAPI({ active: 'true' }).then(({ data }) => setReferenceMaster(data)).catch(() => setReferenceMaster([]));
}, []);
```

Find the block that computes the distinct list (it likely uses `useMemo` over `claims.map(c => c.hospital?.referenceBy)`). Modify the memo to union:

```jsx
// existing logic returns Set of legacy referenceBy strings; union with master names
const masterNames = referenceMaster.map(r => r.name);
const combined = new Set([...(existingLegacyList || []), ...masterNames].filter(Boolean));
return Array.from(combined).sort((a, b) => a.localeCompare(b));
```

(Adapt to actual variable names in the file. Goal: the filter dropdown shows BOTH legacy `referenceBy` strings AND active Reference master names, deduped.)

- [ ] **Step 3: Manual verification**

With the frontend dev server still running:

1. Visit `/reports`.
2. Open the "Reference By" filter — confirm both legacy hospital strings AND active Reference master names appear in one deduped, sorted list.
3. Pick a Reference master name that you used for a hospital in Task 9 → the report filters claims for that hospital correctly (works because hospital.referenceBy was auto-snapshotted to the master name on save).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/reports/Reports.js
git commit -m "feat(phase-2-0): Reports reference filter includes master names"
```

---

## Task 11: End-to-end verification + cleanup

**Files:** none (verification only)

- [ ] **Step 1: Kill any background dev servers**

```bash
kill "$(cat /tmp/server.pid)" 2>/dev/null || true
rm -f /tmp/server.pid /tmp/server.log
```

- [ ] **Step 2: Full smoke run from a cold start**

```bash
# Terminal A
cd backend && node server.js
# Terminal B (after A boots)
cd frontend && npm start
# Terminal C
bash backend/scripts/smoke-reference.sh
```

Expected backend smoke: `✅ smoke passed`.

- [ ] **Step 3: End-to-end browser walk**

Logged in as `admin@claimoptiq.com` / `Admin@123`:

1. `/references` → create "Dr. Mehta", commission 5%, applicable services = TPA Desk + NABH (or whatever exists in your billing service names).
2. `/hospitals/new` (or edit existing) → pick "Dr. Mehta" from Reference By dropdown → save.
3. `/hospitals` list → row shows "Dr. Mehta" in Reference By column.
4. `/reports` → Reference By filter contains "Dr. Mehta" → selecting it filters claims for the linked hospital.
5. `/references` → delete "Dr. Mehta" → confirms it was soft-deleted (hospital still linked) → message: "Deactivated (still linked to 1 hospital)".
6. Edit hospital → clear reference → return to `/references` → delete → now hard-deletes.

- [ ] **Step 4: Confirm seed/migration are reproducible**

```bash
cd backend
# fresh DB sanity (only if you have a scratch DB; otherwise skip)
npx prisma migrate deploy
npm run seed
```

Expected: no errors; `references` module appears in `role_module_permissions` for `super_admin` and `fcc_staff`.

- [ ] **Step 5: Final commit if anything was tweaked during verification**

```bash
git status
# If clean, no commit needed.
```

- [ ] **Step 6: Open PR or hand off**

The branch should now have ~10 commits scoped to Phase 2.0. The next sub-project (2.1 Invoice) consumes the `referenceId` FK introduced here.

---

## Spec coverage check

Mapping every requirement in `docs/superpowers/specs/2026-06-13-phase-2-0-reference-master-design.md` to a task:

| Spec requirement | Task |
|---|---|
| `Reference` model with name/mobile/address/commissionRate/isActive | 1 |
| `ReferenceApplicableService` join to `BillingServiceName` (global catalog) | 1 |
| `Hospital.referenceId` FK added, `referenceBy` string kept | 1 |
| Back-relation on `BillingServiceName` | 1 |
| RBAC `references` module seeded for super_admin + fcc_staff | 2 |
| `GET /api/references` with `search` + `active` filters | 3, 4 |
| `GET /api/references/:id` | 3, 4 |
| `POST /api/references` | 3, 4 |
| `PATCH /api/references/:id` with full-replace of applicableServiceIds | 3, 4 |
| `DELETE /api/references/:id` with hospital-link guard (soft vs hard) | 3, 4 |
| `GET /api/references/:id/hospitals` | 3, 4 |
| Hospital create/edit accepts `referenceId`, server snapshots `referenceBy` from reference.name | 6 |
| Hospital responses include `reference` relation | 6 |
| `/references` UI list with multi-select form | 7, 8 |
| `HospitalForm` searchable dropdown with text fallback | 9 |
| `HospitalList` "Reference By" still works (no code change needed — column reads `referenceBy` which is now auto-synced) | covered by 6 |
| `Reports.js` reference filter unions master names + legacy strings | 10 |
| End-to-end browser walk per spec edge cases | 11 |

No gaps.
