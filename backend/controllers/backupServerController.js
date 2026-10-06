const prisma = require('../config/prisma');
const { encrypt, decrypt, isAvailable } = require('../utils/cryptoBackup');
const { providerFor } = require('../utils/backupProviders');
const gdrive = require('../utils/backupProviders/gdrive');
const gdriveOAuth = require('../utils/gdriveOAuth');
const { sanitizeSegment } = require('../utils/fccBackupPath');
const backupService = require('../services/backupService');

// Strip ciphertext from API responses; expose only "is a secret set?" booleans.
const toServerResponse = (s) => {
  if (!s) return s;
  const { encPassword, encPrivateKey, encPassphrase, encGdriveRefreshToken, ...rest } = s;
  return {
    ...rest,
    _id: s.id,
    hasPassword: !!encPassword,
    hasPrivateKey: !!encPrivateKey,
    hasPassphrase: !!encPassphrase,
    gdriveConnected: !!encGdriveRefreshToken,
  };
};

const gdriveRootName = (s) => s.gdriveRootFolderName || gdrive.DEFAULT_ROOT_FOLDER;

// Non-secret fields. Secrets are handled separately so we never log/echo them.
// A Drive server only has a name, a top-folder name and the shared toggles.
const pickFields = (body, type = 'sftp') => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).slice(0, 200);
  if (body.isEnabled !== undefined) data.isEnabled = !!body.isEnabled;
  if (body.order !== undefined) {
    const n = Number(body.order);
    if (Number.isFinite(n)) data.order = n;
  }
  if (type === 'gdrive') {
    if (body.gdriveRootFolderName !== undefined) {
      data.gdriveRootFolderName = sanitizeSegment(body.gdriveRootFolderName, gdrive.DEFAULT_ROOT_FOLDER);
    }
    return data;
  }
  if (body.host !== undefined) data.host = String(body.host || '').slice(0, 255);
  if (body.username !== undefined) data.username = String(body.username || '').slice(0, 200);
  if (body.authType !== undefined) data.authType = body.authType === 'key' ? 'key' : 'password';
  if (body.remoteBasePath !== undefined) data.remoteBasePath = String(body.remoteBasePath || '/backups').slice(0, 1024);
  if (body.port !== undefined) {
    const n = Number(body.port);
    if (Number.isFinite(n) && n > 0) data.port = Math.floor(n);
  }
  return data;
};

// Apply secret updates. undefined = leave unchanged; '' = clear; value = encrypt.
const applySecrets = (data, body) => {
  if (body.password !== undefined) data.encPassword = body.password === '' ? null : encrypt(body.password);
  if (body.privateKey !== undefined) data.encPrivateKey = body.privateKey === '' ? null : encrypt(body.privateKey);
  if (body.passphrase !== undefined) data.encPassphrase = body.passphrase === '' ? null : encrypt(body.passphrase);
};

// Decrypt for a best-effort revoke; a missing/rotated key just skips it.
const safeDecrypt = (blob) => {
  try { return decrypt(blob); } catch { return null; }
};

const flipPrimary = async (tx, id) => {
  await tx.backupServer.updateMany({ where: { id: { not: id } }, data: { isPrimary: false } });
};

exports.list = async (req, res) => {
  try {
    const items = await prisma.backupServer.findMany({
      orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    res.json(items.map(toServerResponse));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toServerResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.create = async (req, res) => {
  try {
    // Type is fixed at creation: switching it would strand the copies already on it.
    const type = req.body.type === 'gdrive' ? 'gdrive' : 'sftp';
    const data = { ...pickFields(req.body, type), type };
    if (!data.name) return res.status(400).json({ message: 'name is required' });
    if (type === 'sftp') {
      if (!data.host) return res.status(400).json({ message: 'host is required' });
      if (!data.username) return res.status(400).json({ message: 'username is required' });
      applySecrets(data, req.body);
    } else if (!gdriveOAuth.isConfigured()) {
      return res.status(400).json({ message: 'Google Drive is not configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI).' });
    }

    const item = await prisma.$transaction(async (tx) => {
      const primaryCount = await tx.backupServer.count({ where: { isEnabled: true, isPrimary: true } });
      // Without an enabled primary, a new SFTP server becomes it (needed to gate
      // local deletion). Google Drive is a safety copy only — never primary.
      const wantsPrimary = type === 'sftp' && (req.body.isPrimary === true || primaryCount === 0);
      const created = await tx.backupServer.create({ data: { ...data, isPrimary: wantsPrimary } });
      if (wantsPrimary) await flipPrimary(tx, created.id);
      return created;
    });
    res.status(201).json(toServerResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = pickFields(req.body, existing.type);
    if (existing.type !== 'gdrive') applySecrets(data, req.body);
    const wantsPrimary = req.body.isPrimary === true;

    if (existing.type === 'gdrive') {
      if (wantsPrimary) {
        return res.status(400).json({ message: 'Google Drive is a safety copy and can\'t be the primary server.' });
      }
      // Existing copies are found by path under the top folder; renaming it
      // would make them unreachable.
      if (data.gdriveRootFolderName !== undefined && data.gdriveRootFolderName !== gdriveRootName(existing)) {
        const used = await prisma.fileBackupLocation.count({ where: { serverId: existing.id } });
        if (used) return res.status(400).json({ message: 'The folder name can\'t change once files are backed up to it.' });
      }
    }

    // Block un-primary-ing the only primary — needed for the deletion gate.
    if (existing.isPrimary && req.body.isPrimary === false) {
      return res.status(400).json({ message: 'A primary server is required. Promote another server first.' });
    }
    // Sole-holder guard: disabling a server that solely holds offloaded files.
    if (existing.isEnabled && data.isEnabled === false) {
      const sole = await backupService.assessServerRemoval(req.params.id);
      if (sole.length) {
        return res.status(409).json({
          message: `${sole.length} file(s) exist only on this server. Replicate them elsewhere before disabling.`,
          soleCount: sole.length,
        });
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.backupServer.update({
        where: { id: req.params.id },
        data: { ...data, ...(wantsPrimary ? { isPrimary: true } : {}) },
      });
      if (wantsPrimary) await flipPrimary(tx, updated.id);
      return updated;
    });
    res.json(toServerResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.setPrimary = async (req, res) => {
  try {
    const existing = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });
    if (!existing.isEnabled) return res.status(400).json({ message: 'Enable the server before making it primary.' });
    if (existing.type === 'gdrive') {
      return res.status(400).json({ message: 'Google Drive is a safety copy and can\'t be the primary server.' });
    }

    const item = await prisma.$transaction(async (tx) => {
      const updated = await tx.backupServer.update({ where: { id: req.params.id }, data: { isPrimary: true } });
      await flipPrimary(tx, updated.id);
      return updated;
    });
    res.json(toServerResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    if (existing.isPrimary) {
      return res.status(400).json({ message: 'Promote another server as primary before deleting this one.' });
    }
    // Sole-holder guard — block losing the only verified copy of offloaded files.
    const sole = await backupService.assessServerRemoval(req.params.id);
    if (sole.length) {
      return res.status(409).json({
        message: `${sole.length} file(s) exist only on this server. Replicate them elsewhere before deleting.`,
        soleCount: sole.length,
      });
    }
    if (existing.type === 'gdrive') {
      await gdriveOAuth.revoke(safeDecrypt(existing.encGdriveRefreshToken));
      gdrive.forgetServer(existing.id);
    }
    // Cascade removes its FileBackupLocation rows.
    await prisma.backupServer.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.testConnection = async (req, res) => {
  try {
    const server = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ message: 'Not found' });

    const result = await providerFor(server).testConnection(server);
    const update = { lastTestedAt: new Date(), lastTestOk: result.ok };
    // Pin the host fingerprint on first successful connection (SFTP only).
    if (result.ok && result.fingerprint && !server.hostFingerprint) {
      update.hostFingerprint = result.fingerprint;
    }
    await prisma.backupServer.update({ where: { id: req.params.id }, data: update });
    res.json({
      ok: result.ok,
      error: result.error,
      fingerprint: result.fingerprint,
      email: result.email,
      storage: result.storage,
      reconnect: result.reconnect,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Re-replicate this server's sole-hosted files to other enabled servers so it
// can then be safely removed/disabled.
exports.replicate = async (req, res) => {
  try {
    const server = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ message: 'Not found' });
    const result = await backupService.replicateFromServer(req.params.id);
    res.json({ message: `Replicated ${result.replicated} file(s) to ${result.targets} server(s)`, ...result });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

// ---- Google Drive connect / disconnect ------------------------------------

const backupPageUrl = (params) => {
  const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}/backup?${new URLSearchParams(params).toString()}`;
};

// Step 1 of "Connect Google Drive": a Google consent URL whose `state` is a
// signed, 10-minute token naming this server.
exports.gdriveAuthUrl = async (req, res) => {
  try {
    if (!gdriveOAuth.isConfigured()) {
      return res.status(503).json({ message: 'Google Drive is not configured on the server (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI).' });
    }
    if (!isAvailable()) {
      return res.status(400).json({ message: 'Set BACKUP_ENCRYPTION_KEY first — the Google token is stored encrypted.' });
    }
    const server = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ message: 'Not found' });
    if (server.type !== 'gdrive') return res.status(400).json({ message: 'Not a Google Drive server' });

    const state = gdriveOAuth.signState({ serverId: server.id, userId: req.user.id });
    res.json({ url: gdriveOAuth.buildAuthUrl(state) });
  } catch (error) {
    res.status(error.status || 500).json({ message: error.message });
  }
};

// Step 2: Google redirects the browser here (no Bearer token — the signed
// `state` is the auth). Always answers with a redirect back to the backup page
// carrying a short reason code, never raw error text.
exports.gdriveCallback = async (req, res) => {
  const fail = (reason) => res.redirect(backupPageUrl({ gdrive: 'error', reason }));
  let serverId;
  try {
    ({ serverId } = gdriveOAuth.verifyState(req.query.state));
  } catch {
    return fail('state');
  }
  if (req.query.error) return fail(req.query.error === 'access_denied' ? 'denied' : 'google');

  try {
    const server = await prisma.backupServer.findUnique({ where: { id: serverId } });
    if (!server || server.type !== 'gdrive') return fail('server');

    let tokens;
    try {
      tokens = await gdriveOAuth.exchangeCode(req.query.code);
    } catch (err) {
      return fail(err.code === 'scope' || err.code === 'no_refresh' ? err.code : 'exchange');
    }

    // Copies already made live in the first Gmail's Drive; switching accounts
    // would silently orphan them. A different account needs a new server.
    const sameAccount = !server.gdriveAccountEmail || !tokens.email
      || server.gdriveAccountEmail.toLowerCase() === tokens.email.toLowerCase();
    if (!sameAccount) {
      const used = await prisma.fileBackupLocation.count({ where: { serverId } });
      if (used) {
        await gdriveOAuth.revoke(tokens.refreshToken);
        return fail('account');
      }
    }

    gdrive.forgetServer(serverId);
    const updated = await prisma.backupServer.update({
      where: { id: serverId },
      data: { encGdriveRefreshToken: encrypt(tokens.refreshToken), gdriveAccountEmail: tokens.email },
    });
    const result = await gdrive.testConnection(updated);
    await prisma.backupServer.update({
      where: { id: serverId },
      data: { lastTestedAt: new Date(), lastTestOk: result.ok },
    });
    return res.redirect(backupPageUrl(result.ok ? { gdrive: 'connected' } : { gdrive: 'error', reason: 'test' }));
  } catch (error) {
    console.error('[backup] Google Drive callback failed:', error.message);
    return fail('server');
  }
};

// Revoke at Google and forget the token. Blocked (like disabling) while Drive
// holds the only copy of offloaded files.
exports.gdriveDisconnect = async (req, res) => {
  try {
    const server = await prisma.backupServer.findUnique({ where: { id: req.params.id } });
    if (!server) return res.status(404).json({ message: 'Not found' });
    if (server.type !== 'gdrive') return res.status(400).json({ message: 'Not a Google Drive server' });

    const sole = await backupService.assessServerRemoval(server.id);
    if (sole.length) {
      return res.status(409).json({
        message: `${sole.length} file(s) exist only on this server. Replicate them elsewhere before disconnecting.`,
        soleCount: sole.length,
      });
    }
    await gdriveOAuth.revoke(safeDecrypt(server.encGdriveRefreshToken));
    gdrive.forgetServer(server.id);
    // Keep gdriveAccountEmail so a reconnect can insist on the same account.
    const updated = await prisma.backupServer.update({
      where: { id: server.id },
      data: { encGdriveRefreshToken: null, lastTestOk: null, lastTestedAt: null },
    });
    res.json(toServerResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
