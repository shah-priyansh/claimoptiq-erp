# WhatsApp Integration — V1 Design

**Date:** 2026-06-13
**Status:** Approved (pre-implementation)
**Scope:** Minimal plumbing only. Connection management + generic send endpoint. Invoice-send and reminder UX land in a later spec when the invoice feature is built.

## Goal

Wire WhatsApp into the ClaimOptiq backend so that future features (invoice send, reminders, etc.) can call a single `POST /api/whatsapp/send` endpoint. Provide an admin UI to scan the QR and manage the linked device.

## Non-Goals (V1)

- Auto-send on claim status change
- Invoice-send / reminder buttons on Claim Detail
- Message log table
- Templates editor
- Bulk sending
- Auto-replies to incoming messages

These are deferred. The endpoint shape in V1 is designed so they can be added without breaking changes.

## Architecture

Baileys runs **in-process** inside the existing Express server (`backend/server.js`). One Baileys socket per Node process, held in a module-level singleton inside `backend/services/whatsapp.js`. Auth state persists to disk at `backend/.wa-auth/` using Baileys' `useMultiFileAuthState`.

**Why in-process and not a separate service:** keeps deploy footprint to one process, matches how `uploads/` already relies on the backend's filesystem, and avoids introducing a queue/IPC layer for what is currently a low-volume transactional use case.

**Why file-based auth (not DB-backed):** matches the existing `uploads/` storage pattern. The deploy host that persists uploads will also persist `.wa-auth/`. If the host is ephemeral, the user re-scans the QR after redeploy — acceptable for V1.

## Components

### Backend

**`backend/services/whatsapp.js`** — moved/rewritten from the project-root `whatsapp.js`. Exports:

- `connect()` — idempotent; opens socket if not connected, restores session from `.wa-auth/` if creds exist
- `disconnect()` — logs out, wipes `.wa-auth/`, nulls the singleton
- `getStatus()` → `{ connected: boolean, qr: string|null, phoneNumber: string|null }`
- `sendText(number, text)` → Baileys send result
- `sendDocument(number, filePath, fileName, caption)` → Baileys send result
- `isOnWhatsApp(number)` → boolean

The QR string (raw, not data URL) and connection state are kept in module-local variables so `getStatus()` is synchronous and cheap (the settings page will poll it). The data-URL conversion happens in the controller, on demand, so `/status` stays cheap when nothing is rendering the QR.

Reconnect logic from the existing file is preserved: on `connection.close` that isn't `loggedOut`, reconnect automatically; on `loggedOut`, clear the singleton so a fresh `connect()` can be issued.

**`backend/controllers/whatsappController.js`** — thin wrapper around the service. Endpoints:

| Method | Path | Body / Query | Returns | Permission |
|---|---|---|---|---|
| GET | `/api/whatsapp/status` | — | `{ connected, qr: dataUrl\|null, phoneNumber }` | `whatsapp.view` |
| POST | `/api/whatsapp/connect` | — | `{ connected, qr: dataUrl\|null }` | `whatsapp.manage` |
| POST | `/api/whatsapp/disconnect` | — | `{ ok: true }` | `whatsapp.manage` |
| POST | `/api/whatsapp/send` | `{ number, text?, filePath?, fileName?, caption? }` | `{ ok: true, messageId }` | `whatsapp.send` |
| POST | `/api/whatsapp/check` | `{ number }` | `{ exists: boolean }` | `whatsapp.send` |

`POST /send` rules:
- `number` is required.
- At least one of `text` or `filePath` is required. If both provided, document is sent with `caption` (or `text` if no caption), and any separate `text` is sent as a follow-up message.
- `filePath` is resolved relative to `backend/uploads/`. Path traversal (`..`) is rejected. Other roots are rejected.
- Document mimetype is inferred from the file extension (PDF / image / generic octet-stream).

If the socket is not connected, all send endpoints return `503 { message: 'WhatsApp not connected' }`.

**`backend/routes/whatsappRoutes.js`** — wires the controller, mounts at `/api/whatsapp`, guarded by `protect` + `checkPermission`.

**`backend/server.js`** — on boot, if `backend/.wa-auth/creds.json` exists, fire-and-forget `whatsapp.connect()` so the socket reattaches automatically.

### RBAC

New module slug: `whatsapp`. Actions used: `view`, `send`, `manage` (manage = connect/disconnect).

`super_admin` always bypasses (existing behavior in `checkPermission`). Seed script adds a `RoleModulePermission` row granting `view + send + manage` to `super_admin` for `whatsapp` (so the module appears in the role-permissions UI).

**Schema note:** The existing `RoleModulePermission` model has columns `view, create, edit, delete, export`. There is no `send` or `manage` column. For V1 we **reuse existing columns** to avoid a migration:
- `view` → can see WhatsApp settings page and call `/status`
- `create` → can send messages (call `/send`, `/check`)
- `edit` → can manage connection (call `/connect`, `/disconnect`)

The role-permissions UI for the `whatsapp` module will be relabeled in the frontend so non-technical admins see "View / Send / Manage" instead of "View / Create / Edit". `delete` and `export` are hidden / unused for this module.

### Frontend

**`frontend/src/pages/settings/WhatsAppSettings.js`** — new admin page.

Layout (single column, scaled to existing settings pages):
- Header: "WhatsApp Integration"
- Connection card:
  - **Disconnected state:** status pill (red) + "Connect" button → calls `POST /connect`, then polls `GET /status` every 2s. When `qr` is returned, render `<img src={qr}/>` with instructions ("WhatsApp → Settings → Linked Devices → Link a device"). When `connected: true`, swap to the connected state.
  - **Connected state:** status pill (green), linked phone number, "Disconnect" button (confirm dialog).
- Caveat note at the bottom: "Uses unofficial WhatsApp Web protocol. Use only for transactional messages to your customers."

Navigation: linked from the existing **Settings** sidebar item. New sub-route `/settings/whatsapp`. Reuses the same nav pattern as `SiteSettings.js`.

**`frontend/src/services/api.js`** — add `whatsappAPI`:
```js
whatsappAPI = {
  status: () => api.get('/whatsapp/status'),
  connect: () => api.post('/whatsapp/connect'),
  disconnect: () => api.post('/whatsapp/disconnect'),
  send: (payload) => api.post('/whatsapp/send', payload),
  check: (number) => api.post('/whatsapp/check', { number }),
}
```

## Data Flow

**Connecting (first time):**
1. Admin opens `/settings/whatsapp` → frontend calls `GET /status` → `{ connected: false, qr: null }`.
2. Admin clicks Connect → `POST /connect`. Backend calls `whatsapp.connect()`; Baileys emits a `qr` event.
3. Service stores raw QR string; `getStatus()` returns it; controller converts to data URL.
4. Frontend polls `GET /status` every 2s, renders the QR.
5. Admin scans → Baileys emits `connection.open` → service clears QR, captures phone number from `sock.user.id`.
6. Next poll returns `{ connected: true, qr: null, phoneNumber }`. UI swaps to connected state.

**Subsequent boots:** `server.js` sees `.wa-auth/creds.json`, calls `whatsapp.connect()`, Baileys resumes via stored creds, no QR shown.

**Sending (future invoice flow):** invoice controller (out of scope here) calls `whatsapp.sendDocument(number, '/uploads/invoices/INV-001.pdf', 'INV-001.pdf', 'Your invoice from FCC')`. On success, invoice row marked sent. Later "Send Reminder" button calls `whatsapp.sendText(number, '...')`. The /send endpoint itself is also callable from the frontend (used for ad-hoc tests in V1).

## Error Handling

- **Not connected** → all send endpoints return `503`. Frontend surfaces a toast pointing the user to `/settings/whatsapp`.
- **Number not on WhatsApp** → `/send` returns `400 { code: 'NOT_ON_WHATSAPP' }`.
- **File not found / path traversal** → `/send` returns `400 { code: 'INVALID_FILE_PATH' }`.
- **Baileys throws** → `500 { error: message }`. The service does not retry inside the request; the caller decides whether to retry.
- **Connection drop after `connection.open`** → service auto-reconnects (existing behavior in the source file). Send requests during reconnect get `503`.
- **Logged-out remotely** (user unlinks from phone) → service nulls singleton, clears `.wa-auth/`, returns `503` on sends until admin re-scans.

## Testing

No automated tests in V1 (existing backend has none). Manual QA checklist:
1. Fresh install: open `/settings/whatsapp`, click Connect, scan QR from phone, verify state flips to connected.
2. Send a text: use POST `/api/whatsapp/send` with `{ number: <your-test-number>, text: 'Hello' }` → message arrives.
3. Send a PDF: drop a PDF into `backend/uploads/`, call `/send` with `filePath: 'test.pdf'` → file arrives as document.
4. Restart server: verify it auto-reconnects without showing QR.
5. Disconnect from UI: verify `.wa-auth/` is cleared and next `/status` returns disconnected.
6. Unlink from phone: verify service handles it (next `/status` returns disconnected).
7. RBAC: log in as non-super-admin without `whatsapp.view` → page is not accessible. Grant view but not "send" → page loads but `/send` returns 403.

## Dependencies

Add to `backend/package.json`:
- `baileys` (latest v7)
- `qrcode`
- `qrcode-terminal`
- `@hapi/boom`
- `pino`

## Files Touched

**New:**
- `backend/services/whatsapp.js`
- `backend/controllers/whatsappController.js`
- `backend/routes/whatsappRoutes.js`
- `frontend/src/pages/settings/WhatsAppSettings.js`
- `backend/.wa-auth/` (runtime — gitignored)

**Modified:**
- `backend/server.js` — mount `/api/whatsapp`, call `whatsapp.connect()` on boot if creds exist
- `backend/seed.js` — seed `whatsapp` module permissions for `super_admin`
- `backend/.gitignore` — add `.wa-auth/`
- `frontend/src/services/api.js` — add `whatsappAPI`
- `frontend/src/App.js` (or routes file) — add `/settings/whatsapp` route
- `frontend/src/components/layout/*` — add nav link under Settings
- The root-level `whatsapp.js` reference file is deleted (its contents are migrated into `backend/services/whatsapp.js`)

## Caveats

- **Unofficial protocol.** Baileys can break or get the number banned if used for bulk/marketing. Keep all V1 use transactional.
- **Single device per backend.** One `.wa-auth/` directory → one linked WhatsApp account. Multi-tenant (per-hospital) WhatsApp accounts are out of scope.
- **Deploy persistence.** If the deploy host wipes the filesystem between deploys, the QR must be re-scanned. Same constraint as `uploads/`. Migrating auth to Postgres is a future hardening.
