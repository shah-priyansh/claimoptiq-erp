# WhatsApp Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Baileys-based WhatsApp into the ClaimOptiq backend with a `/api/whatsapp/send` endpoint and an admin QR-scan UI, so the upcoming invoice feature can send messages by calling one endpoint.

**Architecture:** Single in-process Baileys socket inside the existing Express server, held as a module-level singleton. Auth state persisted to disk at `backend/.wa-auth/`. New `whatsapp` RBAC module reuses existing `view / create / edit` columns (labeled as View / Send / Manage). React settings page polls a `/status` endpoint and renders the QR data URL when needed.

**Tech Stack:** Express 5, Prisma 7, Baileys v7, React 19, Tailwind, react-toastify, react-icons.

**Reference spec:** `docs/superpowers/specs/2026-06-13-whatsapp-integration-design.md`

**Note on testing:** The spec defers automated tests for V1. Each phase ends with a manual verification checkpoint. Do NOT skip the verification steps — they are how we catch regressions.

---

## Phase 1 — Backend foundation

### Task 1: Install backend dependencies

**Files:**
- Modify: `backend/package.json`

- [ ] **Step 1: Install Baileys + helpers**

Run from the repo root:

```bash
cd backend && npm install baileys qrcode qrcode-terminal @hapi/boom pino
```

Expected: packages added to `backend/package.json` `dependencies`, `package-lock.json` updated. No build errors.

- [ ] **Step 2: Verify install**

Run:

```bash
cd backend && node -e "require('baileys'); require('qrcode'); require('@hapi/boom'); require('pino'); console.log('ok');"
```

Expected output: `ok` on a single line.

- [ ] **Step 3: Commit**

```bash
git add backend/package.json backend/package-lock.json
git commit -m "Add Baileys deps for WhatsApp integration"
```

---

### Task 2: Create the WhatsApp service module

**Files:**
- Create: `backend/services/whatsapp.js`

This module owns the Baileys socket lifecycle. It exposes a tiny API (`connect`, `disconnect`, `getStatus`, `sendText`, `sendDocument`, `isOnWhatsApp`) and keeps a module-level singleton. The controller is the only consumer.

- [ ] **Step 1: Create the services folder if missing**

Run:

```bash
ls backend/services 2>/dev/null || mkdir backend/services
```

- [ ] **Step 2: Write `backend/services/whatsapp.js`**

```js
const path = require('path');
const fs = require('fs');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('baileys');
const { Boom } = require('@hapi/boom');
const pino = require('pino');

const AUTH_DIR = path.join(__dirname, '..', '.wa-auth');

let sock = null;
let connecting = false;
let latestQr = null;          // raw QR string from Baileys (controller converts to data URL)
let phoneNumber = null;       // populated when connection.open fires
let isConnected = false;

const extractPhoneNumber = (jid) => {
  if (!jid) return null;
  const m = String(jid).match(/^(\d+)/);
  return m ? m[1] : null;
};

const wipeAuthDir = () => {
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
  }
};

async function connect() {
  if (isConnected || connecting) return;
  connecting = true;

  try {
    if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        latestQr = qr;
      }

      if (connection === 'open') {
        isConnected = true;
        latestQr = null;
        phoneNumber = extractPhoneNumber(sock?.user?.id);
        console.log('[whatsapp] connected as', phoneNumber);
      }

      if (connection === 'close') {
        isConnected = false;
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;

        if (loggedOut) {
          console.log('[whatsapp] logged out remotely; clearing auth dir');
          sock = null;
          phoneNumber = null;
          latestQr = null;
          wipeAuthDir();
        } else {
          console.log('[whatsapp] connection closed, reconnecting...');
          sock = null;
          connecting = false;
          connect().catch((err) => console.error('[whatsapp] reconnect failed', err));
        }
      }
    });
  } finally {
    connecting = false;
  }
}

async function disconnect() {
  try {
    if (sock) {
      await sock.logout().catch(() => {});
    }
  } finally {
    sock = null;
    isConnected = false;
    latestQr = null;
    phoneNumber = null;
    wipeAuthDir();
  }
}

function getStatus() {
  return {
    connected: isConnected,
    qr: latestQr,            // raw string; controller converts to data URL
    phoneNumber,
  };
}

function toJid(number) {
  const clean = String(number).replace(/\D/g, '');
  if (!clean) throw new Error('Invalid number');
  return `${clean}@s.whatsapp.net`;
}

async function isOnWhatsApp(number) {
  if (!sock || !isConnected) throw new Error('Not connected');
  const results = await sock.onWhatsApp(toJid(number));
  return results?.[0]?.exists === true;
}

async function sendText(number, text) {
  if (!sock || !isConnected) throw new Error('Not connected');
  return sock.sendMessage(toJid(number), { text });
}

const MIME_BY_EXT = {
  '.pdf':  'application/pdf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

async function sendDocument(number, absoluteFilePath, fileName, caption = '') {
  if (!sock || !isConnected) throw new Error('Not connected');
  if (!fs.existsSync(absoluteFilePath)) throw new Error('File not found');
  const ext = path.extname(absoluteFilePath).toLowerCase();
  const mimetype = MIME_BY_EXT[ext] || 'application/octet-stream';
  return sock.sendMessage(toJid(number), {
    document: fs.readFileSync(absoluteFilePath),
    mimetype,
    fileName: fileName || path.basename(absoluteFilePath),
    caption,
  });
}

function hasStoredCreds() {
  try {
    return fs.existsSync(path.join(AUTH_DIR, 'creds.json'));
  } catch {
    return false;
  }
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  sendText,
  sendDocument,
  isOnWhatsApp,
  hasStoredCreds,
  AUTH_DIR,
};
```

- [ ] **Step 3: Syntax check**

Run:

```bash
cd backend && node -e "require('./services/whatsapp'); console.log('ok');"
```

Expected output: `ok`. (This loads the module without calling `connect()` — Baileys does not start until `connect()` is invoked.)

- [ ] **Step 4: Commit**

```bash
git add backend/services/whatsapp.js
git commit -m "Add WhatsApp Baileys service module"
```

---

### Task 3: Create the WhatsApp controller

**Files:**
- Create: `backend/controllers/whatsappController.js`

The controller is a thin HTTP layer over the service. It converts the raw QR string to a data URL, enforces the `text || filePath` rule for `/send`, and rejects path traversal.

- [ ] **Step 1: Write `backend/controllers/whatsappController.js`**

```js
const path = require('path');
const QRCode = require('qrcode');
const whatsapp = require('../services/whatsapp');

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

const resolveSafeUploadPath = (relativeOrName) => {
  if (typeof relativeOrName !== 'string' || !relativeOrName.length) return null;
  const resolved = path.resolve(UPLOADS_DIR, relativeOrName);
  if (!resolved.startsWith(UPLOADS_DIR + path.sep) && resolved !== UPLOADS_DIR) {
    return null;
  }
  return resolved;
};

exports.getStatus = async (req, res) => {
  try {
    const { connected, qr, phoneNumber } = whatsapp.getStatus();
    const qrDataUrl = qr ? await QRCode.toDataURL(qr) : null;
    res.json({ connected, qr: qrDataUrl, phoneNumber });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get status', error: error.message });
  }
};

exports.connect = async (req, res) => {
  try {
    await whatsapp.connect();
    const { connected, qr, phoneNumber } = whatsapp.getStatus();
    const qrDataUrl = qr ? await QRCode.toDataURL(qr) : null;
    res.json({ connected, qr: qrDataUrl, phoneNumber });
  } catch (error) {
    res.status(500).json({ message: 'Failed to connect', error: error.message });
  }
};

exports.disconnect = async (req, res) => {
  try {
    await whatsapp.disconnect();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disconnect', error: error.message });
  }
};

exports.send = async (req, res) => {
  try {
    const { number, text, filePath, fileName, caption } = req.body || {};
    if (!number) return res.status(400).json({ message: 'number is required' });
    if (!text && !filePath) {
      return res.status(400).json({ message: 'text or filePath is required' });
    }

    if (!whatsapp.getStatus().connected) {
      return res.status(503).json({ message: 'WhatsApp not connected' });
    }

    const onWa = await whatsapp.isOnWhatsApp(number).catch(() => false);
    if (!onWa) {
      return res.status(400).json({ code: 'NOT_ON_WHATSAPP', message: 'Number is not on WhatsApp' });
    }

    const results = [];

    if (filePath) {
      const abs = resolveSafeUploadPath(filePath);
      if (!abs) {
        return res.status(400).json({ code: 'INVALID_FILE_PATH', message: 'filePath must be under backend/uploads' });
      }
      const docCaption = caption ?? (filePath && text ? '' : text || '');
      const docResult = await whatsapp.sendDocument(number, abs, fileName, docCaption);
      results.push({ kind: 'document', id: docResult?.key?.id });
      if (text && caption !== undefined) {
        const textResult = await whatsapp.sendText(number, text);
        results.push({ kind: 'text', id: textResult?.key?.id });
      }
    } else {
      const textResult = await whatsapp.sendText(number, text);
      results.push({ kind: 'text', id: textResult?.key?.id });
    }

    res.json({ ok: true, results });
  } catch (error) {
    res.status(500).json({ message: 'Failed to send', error: error.message });
  }
};

exports.check = async (req, res) => {
  try {
    const { number } = req.body || {};
    if (!number) return res.status(400).json({ message: 'number is required' });
    if (!whatsapp.getStatus().connected) {
      return res.status(503).json({ message: 'WhatsApp not connected' });
    }
    const exists = await whatsapp.isOnWhatsApp(number);
    res.json({ exists });
  } catch (error) {
    res.status(500).json({ message: 'Failed to check number', error: error.message });
  }
};
```

- [ ] **Step 2: Syntax check**

Run:

```bash
cd backend && node -e "require('./controllers/whatsappController'); console.log('ok');"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add backend/controllers/whatsappController.js
git commit -m "Add WhatsApp controller"
```

---

### Task 4: Create the WhatsApp route

**Files:**
- Create: `backend/routes/whatsappRoutes.js`

Endpoint → permission mapping (spec): `view` for status; `edit` for connect/disconnect (Manage); `create` for send/check (Send).

- [ ] **Step 1: Write `backend/routes/whatsappRoutes.js`**

```js
const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const ctl = require('../controllers/whatsappController');

router.get('/status', protect, checkPermission('whatsapp', 'view'), ctl.getStatus);
router.post('/connect', protect, checkPermission('whatsapp', 'edit'), ctl.connect);
router.post('/disconnect', protect, checkPermission('whatsapp', 'edit'), ctl.disconnect);
router.post('/send', protect, checkPermission('whatsapp', 'create'), ctl.send);
router.post('/check', protect, checkPermission('whatsapp', 'create'), ctl.check);

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/routes/whatsappRoutes.js
git commit -m "Add WhatsApp routes"
```

---

### Task 5: Mount the route and boot-time reconnect in `server.js`

**Files:**
- Modify: `backend/server.js`

Mount `/api/whatsapp`. On boot, if creds exist, kick off `whatsapp.connect()` so the socket reattaches without admin intervention.

- [ ] **Step 1: Add route mount**

In `backend/server.js`, add this line right after the existing `app.use('/api/settings', ...)` line (currently line 37):

```js
app.use('/api/whatsapp', require('./routes/whatsappRoutes'));
```

- [ ] **Step 2: Auto-reconnect on boot**

Add a require at the top of `backend/server.js`, alongside the existing `prisma` require (currently line 6):

```js
const whatsapp = require('./services/whatsapp');
```

Then modify the `main()` function (currently lines 51-57) to attempt reconnection if creds exist:

```js
async function main() {
  await prisma.$connect();
  console.log('PostgreSQL connected via Prisma');

  if (whatsapp.hasStoredCreds()) {
    whatsapp.connect().catch((err) => console.error('[whatsapp] boot connect failed', err));
  }

  app.listen(PORT, () => {
    console.log(`ClaimOptiq Server running on port ${PORT}`);
  });
}
```

- [ ] **Step 3: Boot smoke test**

Start the backend:

```bash
cd backend && npm run dev
```

Expected logs (no errors):
```
PostgreSQL connected via Prisma
ClaimOptiq Server running on port 5001
```

(No `[whatsapp]` line yet because creds don't exist.)

In another terminal, verify the route is mounted (it will 401 without a token, which is the correct behavior — meaning the route exists):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/whatsapp/status
```

Expected: `401`.

Stop the dev server (Ctrl+C).

- [ ] **Step 4: Commit**

```bash
git add backend/server.js
git commit -m "Mount WhatsApp route and auto-reconnect on boot"
```

---

### Task 6: Gitignore `.wa-auth/`, delete the root `whatsapp.js`

**Files:**
- Modify: `.gitignore` (repo root)
- Delete: `whatsapp.js` (repo root)

- [ ] **Step 1: Append `.wa-auth/` to the root `.gitignore`**

Add this block under the existing "Uploads" section in `.gitignore`:

```
# WhatsApp Baileys session
backend/.wa-auth/
```

- [ ] **Step 2: Delete the root `whatsapp.js`**

```bash
git rm whatsapp.js
```

Expected: `rm 'whatsapp.js'`.

- [ ] **Step 3: Commit**

```bash
git add .gitignore
git commit -m "Ignore .wa-auth and remove root whatsapp.js stub"
```

---

### Task 7: Add `whatsapp` RBAC module and seed super-admin permissions

**Files:**
- Modify: `backend/controllers/roleController.js` (around line 8-22)
- Modify: `backend/seed.js` (around lines 5-9 and 26-38)
- Modify: `frontend/src/pages/roles/RoleForm.js` (line 7-13)

The Role-edit UI has a hardcoded `MODULE_GROUPS` array — any module not listed in a group is silently dropped from the matrix. We add a new "Communication" group containing `whatsapp` so admins can edit its permissions. The column headers (View/Create/Edit/Delete/Export) stay generic — we hint the mapping in the module label.

- [ ] **Step 1: Add `whatsapp` to the backend module list**

In `backend/controllers/roleController.js`, inside `exports.getModules`, add this entry to the `modules` array (place it after the `staff` entry, currently line 21):

```js
{ key: 'whatsapp', label: 'WhatsApp (Send = Create, Manage = Edit)', actions: ['view', 'create', 'edit'] },
```

- [ ] **Step 2: Add `whatsapp` to `seed.js` `allModules`**

In `backend/seed.js`, replace the existing `allModules` array (lines 5-9) with:

```js
const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions', 'staff',
  'whatsapp',
];
```

- [ ] **Step 3: Grant the super-admin role full WhatsApp perms in seed**

In `backend/seed.js`, in the Super Admin `buildPermissions` block (currently lines 26-38), add this line right before the closing `})`:

```js
      whatsapp:             { view: true, create: true, edit: true },
```

The resulting block:

```js
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true, edit: true, delete: true, export: true },
      hospitals:            { view: true, create: true, edit: true, delete: true },
      insurance:            { view: true, create: true, edit: true, delete: true },
      tpa:                  { view: true, create: true, edit: true, delete: true },
      users:                { view: true, create: true, edit: true, delete: true },
      roles:                { view: true, create: true, edit: true, delete: true },
      reports:              { view: true, export: true },
      claim_statuses:       { view: true, create: true, edit: true, delete: true },
      claim_document_types: { view: true, create: true, edit: true, delete: true },
      document_submissions: { view: true, create: true, edit: true, delete: true },
      whatsapp:             { view: true, create: true, edit: true },
    }),
```

- [ ] **Step 4: Add `whatsapp` to the frontend role-edit UI grouping**

In `frontend/src/pages/roles/RoleForm.js`, replace the existing `MODULE_GROUPS` constant (lines 7-13) with:

```js
const MODULE_GROUPS = [
  { label: null,             keys: ['dashboard', 'claims'] },
  { label: 'Administration', keys: ['hospitals', 'insurance', 'tpa', 'users', 'roles', 'claim_statuses', 'claim_document_types'] },
  { label: 'Documents',      keys: ['document_submissions'] },
  { label: null,             keys: ['reports'] },
  { label: 'Staff',          keys: ['staff'] },
  { label: 'Communication',  keys: ['whatsapp'] },
];
```

- [ ] **Step 5: Note about existing deployments**

Existing Super Admin roles already in the DB will not automatically get the `whatsapp` permission — they only have rows for the modules that existed when their permissions were last written. This is fine: `checkPermission` in `middleware/auth.js` already bypasses all checks for `super_admin` role slug, so the super admin can call WhatsApp endpoints without re-seeding.

To grant access to other existing roles, the user will edit them in the Roles UI after deploying. No data migration needed.

- [ ] **Step 6: Commit**

```bash
git add backend/controllers/roleController.js backend/seed.js frontend/src/pages/roles/RoleForm.js
git commit -m "Add whatsapp RBAC module to roles, seed, and role-edit UI"
```

---

### Task 8: Manual backend smoke test

- [ ] **Step 1: Start backend, log in, hit `/status`**

Terminal A:
```bash
cd backend && npm run dev
```

Terminal B (log in to get a token — replace if your test password differs):
```bash
TOKEN=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@claimoptiq.com","password":"Admin@123"}' | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
echo "$TOKEN" | head -c 30
```

Expected: a JWT prefix prints (no error).

- [ ] **Step 2: Call `/status` while disconnected**

```bash
curl -s http://localhost:5001/api/whatsapp/status -H "Authorization: Bearer $TOKEN"
```

Expected JSON: `{"connected":false,"qr":null,"phoneNumber":null}`.

- [ ] **Step 3: Call `/connect`**

```bash
curl -s -X POST http://localhost:5001/api/whatsapp/connect -H "Authorization: Bearer $TOKEN"
```

Expected JSON: `{"connected":false,"qr":"data:image/png;base64,...","phoneNumber":null}` (within ~2-3 seconds; if it's null on first call, wait 1 second and call `/status` again — Baileys emits QR asynchronously).

- [ ] **Step 4: Confirm `/send` is gated when not connected**

```bash
curl -s -X POST http://localhost:5001/api/whatsapp/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"919999999999","text":"test"}'
```

Expected: HTTP 503 body `{"message":"WhatsApp not connected"}`.

(Do not scan the QR yet — full end-to-end testing happens after the frontend lands.)

- [ ] **Step 5: Stop the dev server**

Ctrl+C in Terminal A.

---

## Phase 2 — Frontend UI

### Task 9: Add `whatsappAPI` to the frontend API service

**Files:**
- Modify: `frontend/src/services/api.js`

- [ ] **Step 1: Append the WhatsApp API block**

At the end of `frontend/src/services/api.js`, immediately before the `export default API;` line, add:

```js
// WhatsApp
export const getWhatsAppStatusAPI = () => API.get('/whatsapp/status');
export const connectWhatsAppAPI = () => API.post('/whatsapp/connect');
export const disconnectWhatsAppAPI = () => API.post('/whatsapp/disconnect');
export const sendWhatsAppAPI = (payload) => API.post('/whatsapp/send', payload);
export const checkWhatsAppNumberAPI = (number) => API.post('/whatsapp/check', { number });
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/services/api.js
git commit -m "Add WhatsApp API client methods"
```

---

### Task 10: Create the WhatsApp Settings page

**Files:**
- Create: `frontend/src/pages/settings/WhatsAppSettings.js`

The page shows connection status. When disconnected, "Connect" triggers `POST /connect` and starts a 2s poll of `/status`; whenever `qr` arrives, render it. When connected, show the linked phone number and a "Disconnect" button.

- [ ] **Step 1: Write `frontend/src/pages/settings/WhatsAppSettings.js`**

```jsx
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import {
  getWhatsAppStatusAPI,
  connectWhatsAppAPI,
  disconnectWhatsAppAPI,
} from '../../services/api';

const POLL_INTERVAL_MS = 2000;

const WhatsAppSettings = () => {
  const [status, setStatus] = useState({ connected: false, qr: null, phoneNumber: null });
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const pollRef = useRef(null);

  const fetchStatus = async () => {
    try {
      const { data } = await getWhatsAppStatusAPI();
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => {
    fetchStatus().finally(() => setLoading(false));
    return stopPolling;
  }, []);

  // Stop polling once connected (QR no longer needed).
  useEffect(() => {
    if (status.connected) stopPolling();
  }, [status.connected]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data } = await connectWhatsAppAPI();
      setStatus(data);
      startPolling();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect WhatsApp? You will need to scan a new QR to reconnect.')) return;
    setDisconnecting(true);
    try {
      await disconnectWhatsAppAPI();
      await fetchStatus();
      toast.success('WhatsApp disconnected');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3">
        <div className="w-8 h-8 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading...</p>
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-base font-semibold text-gray-700">WhatsApp Integration</h2>
            <p className="text-xs text-gray-400 mt-0.5">Link a phone to send claim communications via WhatsApp.</p>
          </div>
          {status.connected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              Disconnected
            </span>
          )}
        </div>

        {status.connected ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Linked phone</p>
              <p className="text-sm font-medium text-gray-800 mt-0.5">+{status.phoneNumber || '—'}</p>
            </div>
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={disconnecting}
              className="bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {status.qr ? (
              <div className="flex flex-col items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
                <img src={status.qr} alt="WhatsApp QR" className="w-64 h-64" />
                <ol className="text-xs text-gray-600 space-y-1 list-decimal list-inside">
                  <li>Open WhatsApp on your phone</li>
                  <li>Tap <span className="font-semibold">Settings → Linked Devices</span></li>
                  <li>Tap <span className="font-semibold">Link a device</span> and scan this QR</li>
                </ol>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleConnect}
                disabled={connecting}
                className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                {connecting ? 'Starting...' : 'Connect'}
              </button>
            )}
          </div>
        )}

        <p className="mt-6 pt-4 border-t border-gray-100 text-xs text-gray-400 italic">
          Uses the unofficial WhatsApp Web protocol. Send only transactional messages to your customers — bulk sending can get the number banned.
        </p>
      </div>
    </div>
  );
};

export default WhatsAppSettings;
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/settings/WhatsAppSettings.js
git commit -m "Add WhatsApp Settings page"
```

---

### Task 11: Wire the route in `App.js`

**Files:**
- Modify: `frontend/src/App.js`

- [ ] **Step 1: Add the import**

In `frontend/src/App.js`, alongside the existing `SiteSettings` import (currently line 29), add:

```js
import WhatsAppSettings from './pages/settings/WhatsAppSettings';
```

- [ ] **Step 2: Add the route**

Inside `<Routes>`, right after the existing `/settings` route (currently line 67), add:

```jsx
<Route path="/settings/whatsapp" element={<ProtectedRoute module="whatsapp"><WhatsAppSettings /></ProtectedRoute>} />
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.js
git commit -m "Add WhatsApp settings route"
```

---

### Task 12: Add the sidebar nav link

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.js`

Place a "WhatsApp" link above the existing Settings link, gated on `canViewModule('whatsapp')`. Uses `HiOutlineChat` from `react-icons/hi`.

- [ ] **Step 1: Import the icon**

In `frontend/src/components/layout/Sidebar.js`, add `HiOutlineChat` to the existing `react-icons/hi` import block (currently lines 4-18):

```js
import {
  HiOutlineHome,
  HiOutlineOfficeBuilding,
  HiOutlineDocumentText,
  HiOutlineUserGroup,
  HiOutlineShieldCheck,
  HiOutlineClipboardList,
  HiOutlineChartBar,
  HiOutlineKey,
  HiOutlineTag,
  HiOutlineCog,
  HiOutlineChevronDown,
  HiOutlineInbox,
  HiOutlineCloudUpload,
  HiOutlineChat,
} from 'react-icons/hi';
```

- [ ] **Step 2: Add the nav link**

Immediately before the existing `{isSuperAdmin && (` block that renders `/settings` (currently lines 157-162), add:

```jsx
          {canViewModule('whatsapp') && (
            <NavLink to="/settings/whatsapp" className={linkClass} onClick={onClose}>
              <HiOutlineChat className="w-5 h-5 flex-shrink-0" />
              WhatsApp
            </NavLink>
          )}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/layout/Sidebar.js
git commit -m "Add WhatsApp link to sidebar"
```

---

### Task 13: End-to-end manual verification

This is the gate before declaring V1 done. Run all checks. Do NOT skip.

- [ ] **Step 1: Start both servers**

Terminal A:
```bash
cd backend && npm run dev
```

Terminal B:
```bash
cd frontend && npm start
```

Expected: backend on 5001, frontend opens on 3000, no console errors.

- [ ] **Step 2: Log in as super admin**

In the browser: log in with `admin@claimoptiq.com` / `Admin@123`.

Expected: dashboard loads. Sidebar shows a new "WhatsApp" entry.

- [ ] **Step 3: Connect flow**

Click WhatsApp in the sidebar → page loads with red "Disconnected" pill + "Connect" button → click Connect → within ~3 seconds a QR appears.

Scan the QR from your phone (WhatsApp → Settings → Linked Devices → Link a device).

Expected: within ~5 seconds the UI swaps to green "Connected" pill, shows the linked phone number, and the QR disappears. The backend log prints `[whatsapp] connected as <number>`.

- [ ] **Step 4: Send a text via curl**

```bash
TOKEN=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@claimoptiq.com","password":"Admin@123"}' | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
curl -s -X POST http://localhost:5001/api/whatsapp/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"<YOUR_TEST_NUMBER_WITH_COUNTRY_CODE>","text":"ClaimOptiq test"}'
```

Replace `<YOUR_TEST_NUMBER_WITH_COUNTRY_CODE>` with a real WhatsApp number (e.g. `919876543210`).

Expected response: `{"ok":true,"results":[{"kind":"text","id":"..."}]}`. The message arrives on the target phone.

- [ ] **Step 5: Send a PDF via curl**

Place any PDF into `backend/uploads/` (e.g. copy an existing claim document, or create one):
```bash
cp $(find backend/uploads -name '*.pdf' | head -1) backend/uploads/wa-test.pdf 2>/dev/null || echo "%PDF-1.4 test" > backend/uploads/wa-test.pdf
```

Then send it:
```bash
curl -s -X POST http://localhost:5001/api/whatsapp/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"<YOUR_TEST_NUMBER>","filePath":"wa-test.pdf","fileName":"Test.pdf","caption":"Test attachment"}'
```

Expected: `{"ok":true,"results":[{"kind":"document","id":"..."}]}`. The PDF arrives as a document on the target phone.

Clean up: `rm backend/uploads/wa-test.pdf`.

- [ ] **Step 6: Path traversal rejection**

```bash
curl -s -X POST http://localhost:5001/api/whatsapp/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"<YOUR_TEST_NUMBER>","filePath":"../../etc/hosts"}'
```

Expected: HTTP 400 body `{"code":"INVALID_FILE_PATH","message":"filePath must be under backend/uploads"}`.

- [ ] **Step 7: NOT_ON_WHATSAPP rejection**

Use a number you know is not on WhatsApp (or invent one with the wrong country code):
```bash
curl -s -X POST http://localhost:5001/api/whatsapp/send \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"number":"10000000000","text":"hi"}'
```

Expected: HTTP 400 body `{"code":"NOT_ON_WHATSAPP","message":"Number is not on WhatsApp"}`.

- [ ] **Step 8: Restart-persistence check**

Stop the backend (Ctrl+C in Terminal A). Restart: `npm run dev`. Within ~5 seconds the log should print `[whatsapp] connected as <number>` without any browser action. Reload the WhatsApp Settings page — still shows Connected.

- [ ] **Step 9: Disconnect flow**

In the UI, click Disconnect → confirm dialog → page returns to Disconnected. The backend `.wa-auth/` folder is now empty (`ls backend/.wa-auth` shows no `creds.json`). Calling `/send` returns 503.

- [ ] **Step 10: RBAC check**

Log out, log back in as `fccstaff@claimoptiq.com` / `Test@123` (no `whatsapp` perms by default).

Expected: WhatsApp link is NOT in the sidebar. Browsing directly to `/settings/whatsapp` renders the ProtectedRoute fallback (per the existing `ProtectedRoute` behavior — typically redirects to dashboard).

Calling `/api/whatsapp/status` with this user's token returns 403:
```bash
TOKEN2=$(curl -s -X POST http://localhost:5001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"fccstaff@claimoptiq.com","password":"Test@123"}' | python3 -c "import sys, json; print(json.load(sys.stdin)['token'])")
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5001/api/whatsapp/status \
  -H "Authorization: Bearer $TOKEN2"
```

Expected: `403`.

- [ ] **Step 11: Final commit (if any uncommitted tweaks)**

```bash
git status
```

If anything is uncommitted from manual fixes during testing, commit it. Otherwise:

```bash
git log --oneline -15
```

Expected: see the 12 task commits above, in order.

---

## Done

V1 plumbing is complete. The `/api/whatsapp/send` endpoint is callable from any future feature. When the invoice feature lands, it will:

1. Generate the invoice PDF into `backend/uploads/invoices/<id>.pdf`
2. Call `sendWhatsAppAPI({ number: client.phone, filePath: 'invoices/<id>.pdf', fileName: 'Invoice.pdf', caption: '...' })`
3. Show a "Send Reminder" button that calls `sendWhatsAppAPI({ number, text: 'Reminder: ...' })`

That UX lives in a future spec, not this plan.
