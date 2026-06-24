const prisma = require('../config/prisma');
const { encrypt } = require('../utils/cryptoBackup');
const sftp = require('../utils/sftpProvider');
const backupService = require('../services/backupService');

// Strip ciphertext from API responses; expose only "is a secret set?" booleans.
const toServerResponse = (s) => {
  if (!s) return s;
  const { encPassword, encPrivateKey, encPassphrase, ...rest } = s;
  return {
    ...rest,
    _id: s.id,
    hasPassword: !!encPassword,
    hasPrivateKey: !!encPrivateKey,
    hasPassphrase: !!encPassphrase,
  };
};

// Non-secret fields. Secrets are handled separately so we never log/echo them.
const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).slice(0, 200);
  if (body.host !== undefined) data.host = String(body.host || '').slice(0, 255);
  if (body.username !== undefined) data.username = String(body.username || '').slice(0, 200);
  if (body.authType !== undefined) data.authType = body.authType === 'key' ? 'key' : 'password';
  if (body.remoteBasePath !== undefined) data.remoteBasePath = String(body.remoteBasePath || '/backups').slice(0, 1024);
  if (body.isEnabled !== undefined) data.isEnabled = !!body.isEnabled;
  if (body.port !== undefined) {
    const n = Number(body.port);
    if (Number.isFinite(n) && n > 0) data.port = Math.floor(n);
  }
  if (body.order !== undefined) {
    const n = Number(body.order);
    if (Number.isFinite(n)) data.order = n;
  }
  return data;
};

// Apply secret updates. undefined = leave unchanged; '' = clear; value = encrypt.
const applySecrets = (data, body) => {
  if (body.password !== undefined) data.encPassword = body.password === '' ? null : encrypt(body.password);
  if (body.privateKey !== undefined) data.encPrivateKey = body.privateKey === '' ? null : encrypt(body.privateKey);
  if (body.passphrase !== undefined) data.encPassphrase = body.passphrase === '' ? null : encrypt(body.passphrase);
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
    const data = pickFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'name is required' });
    if (!data.host) return res.status(400).json({ message: 'host is required' });
    if (!data.username) return res.status(400).json({ message: 'username is required' });
    applySecrets(data, req.body);

    const item = await prisma.$transaction(async (tx) => {
      const enabledCount = await tx.backupServer.count({ where: { isEnabled: true } });
      // First enabled server becomes the primary (needed to gate local deletion).
      const wantsPrimary = req.body.isPrimary === true || enabledCount === 0;
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

    const data = pickFields(req.body);
    applySecrets(data, req.body);
    const wantsPrimary = req.body.isPrimary === true;

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

    const result = await sftp.testConnection(server);
    const update = { lastTestedAt: new Date(), lastTestOk: result.ok };
    // Pin the host fingerprint on first successful connection.
    if (result.ok && result.fingerprint && !server.hostFingerprint) {
      update.hostFingerprint = result.fingerprint;
    }
    await prisma.backupServer.update({ where: { id: req.params.id }, data: update });
    res.json({ ok: result.ok, error: result.error, fingerprint: result.fingerprint });
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
