// SFTP provider — thin wrapper over ssh2-sftp-client.
//
// One connection per operation (connect → op → end) to keep the single
// Express process simple and avoid stale long-lived sockets. Credentials are
// decrypted (utils/cryptoBackup.js) at call time and never logged.
//
// Atomic writes: upload to `<key>.tmp` then rename, so a concurrent reader
// never sees a half-written file. Host keys are pinned per server via
// `hostFingerprint` (sha256 base64); the first successful test captures it.

const path = require('path');
const crypto = require('crypto');
const Client = require('ssh2-sftp-client');
const { decrypt } = require('./cryptoBackup');

const fingerprintOf = (key) => crypto.createHash('sha256').update(key).digest('base64');

// Build the ssh2 connect config from a BackupServer row. `onFingerprint` is
// invoked with the observed host fingerprint so callers (test-connection) can
// pin it. If the server already has a pinned fingerprint, a mismatch rejects.
const buildConfig = (server, onFingerprint) => {
  const cfg = {
    host: server.host,
    port: server.port || 22,
    username: server.username,
    readyTimeout: 20000,
    hostVerifier: (keyBuf) => {
      const fp = fingerprintOf(keyBuf);
      if (typeof onFingerprint === 'function') onFingerprint(fp);
      if (server.hostFingerprint) return fp === server.hostFingerprint;
      // No pin yet (first connect / test) — accept and let the caller persist it.
      return true;
    },
  };
  if (server.authType === 'key') {
    cfg.privateKey = decrypt(server.encPrivateKey);
    const pass = decrypt(server.encPassphrase);
    if (pass) cfg.passphrase = pass;
  } else {
    cfg.password = decrypt(server.encPassword);
  }
  return cfg;
};

const remotePathFor = (server, remoteKey) =>
  path.posix.join(server.remoteBasePath || '/backups', remoteKey);

// Connect, run fn(sftp), always disconnect. Returns fn's result.
const withClient = async (server, fn) => {
  const sftp = new Client();
  try {
    await sftp.connect(buildConfig(server));
    return await fn(sftp);
  } finally {
    try { await sftp.end(); } catch { /* already closed */ }
  }
};

// Test connectivity and capture the host fingerprint. Returns
// { ok, fingerprint, error }. Never throws.
const testConnection = async (server) => {
  const sftp = new Client();
  let fingerprint = null;
  try {
    await sftp.connect(buildConfig(server, (fp) => { fingerprint = fp; }));
    // touch the base path so we know it's reachable/usable
    await sftp.exists(server.remoteBasePath || '/backups');
    return { ok: true, fingerprint, error: null };
  } catch (err) {
    return { ok: false, fingerprint, error: err.message };
  } finally {
    try { await sftp.end(); } catch { /* ignore */ }
  }
};

// Atomic upload: fastPut to <remote>.tmp then rename to <remote>.
const putFile = async (server, localPath, remoteKey) => {
  const remote = remotePathFor(server, remoteKey);
  const tmp = `${remote}.tmp`;
  return withClient(server, async (sftp) => {
    await sftp.mkdir(path.posix.dirname(remote), true).catch(() => {});
    // remove any stale tmp from a previous interrupted run
    if (await sftp.exists(tmp)) await sftp.delete(tmp).catch(() => {});
    await sftp.fastPut(localPath, tmp);
    if (await sftp.exists(remote)) await sftp.delete(remote).catch(() => {});
    await sftp.rename(tmp, remote);
    const stat = await sftp.stat(remote);
    return stat.size;
  });
};

const remoteSize = async (server, remoteKey) =>
  withClient(server, async (sftp) => {
    const stat = await sftp.stat(remotePathFor(server, remoteKey));
    return stat.size;
  });

// Download a remote object to a local path (used for re-replication).
const getFile = async (server, remoteKey, localPath) =>
  withClient(server, async (sftp) => {
    await sftp.fastGet(remotePathFor(server, remoteKey), localPath);
    return localPath;
  });

const existsRemote = async (server, remoteKey) =>
  withClient(server, async (sftp) => !!(await sftp.exists(remotePathFor(server, remoteKey))));

const deleteRemote = async (server, remoteKey) =>
  withClient(server, async (sftp) => {
    const remote = remotePathFor(server, remoteKey);
    if (await sftp.exists(remote)) await sftp.delete(remote);
    return true;
  });

// Open a read stream for retrieval. Returns { stream, close }. The caller MUST
// call close() (or it auto-closes when the stream emits 'close'/'error') so the
// underlying SFTP connection is released. Supports an optional byte range.
const openReadStream = async (server, remoteKey, range) => {
  const sftp = new Client();
  await sftp.connect(buildConfig(server));
  const opts = {};
  if (range && Number.isFinite(range.start)) opts.start = range.start;
  if (range && Number.isFinite(range.end)) opts.end = range.end;
  let ended = false;
  const end = async () => {
    if (ended) return;
    ended = true;
    try { await sftp.end(); } catch { /* ignore */ }
  };
  let stream;
  try {
    stream = sftp.createReadStream(remotePathFor(server, remoteKey), opts);
  } catch (err) {
    await end();
    throw err;
  }
  stream.on('close', end);
  stream.on('error', end);
  return { stream, close: end };
};

module.exports = {
  withClient,
  testConnection,
  putFile,
  getFile,
  remoteSize,
  existsRemote,
  deleteRemote,
  openReadStream,
  remotePathFor,
  fingerprintOf,
};
