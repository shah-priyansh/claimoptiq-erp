// Google Drive provider — same surface as ./sftp.js, so backupService and
// fileRetrieval treat a Drive BackupServer like any other server.
//
// Auth: the server's encrypted OAuth refresh token (encGdriveRefreshToken) plus
// the app-wide Google OAuth client (utils/gdriveOAuth.js). The drive.file scope
// means the app only sees what it created itself, so everything lives under
// the app-made top folder (gdriveRootFolderName) and the account's hand-made
// folders are never seen or touched.
//
// Drive has no paths, only parent -> child IDs. `remoteKey` (the same POSIX
// path SFTP uses) is resolved by walking folder names down from that top
// folder, creating missing ones on upload. Folder IDs are cached in-process
// (with a short TTL so a folder trashed by hand gets re-resolved).
//
// Verification is stronger than SFTP: putFile compares Drive's md5Checksum
// with the local file's MD5, not just the size.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pipeline } = require('stream/promises');
const { drive: makeDrive } = require('@googleapis/drive');
const { decrypt } = require('../cryptoBackup');
const oauth = require('../gdriveOAuth');

const DEFAULT_ROOT_FOLDER = 'ClaimOptiq Backups';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const FOLDER_CACHE_TTL_MS = 10 * 60 * 1000;
const RETRY_ATTEMPTS = 3;
const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded']);
const RECONNECT = 'GDRIVE_RECONNECT';

// Lets Drive preview the backups; anything else uploads as a plain binary.
const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
const mimeFor = (name) => MIME_BY_EXT[path.extname(name).toLowerCase()] || 'application/octet-stream';

const rootFolderName = (server) => (server.gdriveRootFolderName || '').trim() || DEFAULT_ROOT_FOLDER;

// ---- errors ---------------------------------------------------------------

const statusOf = (err) => {
  const s = err && (err.status || (err.response && err.response.status) || err.code);
  return Number.isFinite(Number(s)) ? Number(s) : null;
};

const reasonOf = (err) => {
  const data = err && err.response && err.response.data;
  const errors = (data && data.error && data.error.errors) || (err && err.errors) || [];
  return (errors[0] && errors[0].reason) || null;
};

const isInvalidGrant = (err) => {
  const data = err && err.response && err.response.data;
  return (data && data.error === 'invalid_grant') || /invalid_grant/.test(String(err && err.message));
};

// Turn Google's errors into messages an operator can act on.
const normalizeError = (err) => {
  if (err && err.code === RECONNECT) return err;
  if (isInvalidGrant(err)) {
    const e = new Error('Google Drive access was revoked or expired — click Reconnect in Backup settings');
    e.code = RECONNECT;
    return e;
  }
  if (reasonOf(err) === 'storageQuotaExceeded') {
    return new Error('Google Drive is full (storage quota exceeded)');
  }
  return err;
};

const isRetryable = (err) => {
  if (isInvalidGrant(err)) return false;
  const status = statusOf(err);
  if (status === null && err && /^E[A-Z]+$/.test(String(err.code))) return true; // ECONNRESET, ETIMEDOUT…
  if (status === 429 || (status >= 500 && status < 600)) return true;
  return status === 403 && RATE_LIMIT_REASONS.has(reasonOf(err));
};

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry rate-limit / 5xx with exponential backoff. `fn` is re-invoked per
// attempt so upload streams are re-opened fresh each time.
const withRetry = async (fn) => {
  let lastErr;
  for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === RETRY_ATTEMPTS - 1) break;
      await sleep(500 * 2 ** attempt);
    }
  }
  throw normalizeError(lastErr);
};

// ---- client ---------------------------------------------------------------

const realDriveFor = (server) => {
  if (!server.encGdriveRefreshToken) {
    const err = new Error('Google Drive is not connected — click Connect in Backup settings');
    err.code = RECONNECT;
    throw err;
  }
  const auth = oauth.makeClient();
  auth.setCredentials({ refresh_token: decrypt(server.encGdriveRefreshToken) });
  // Retries are handled by withRetry (one predictable layer, stream-safe).
  return makeDrive({ version: 'v3', auth, retry: false });
};
let driveFor = realDriveFor;

// ---- folders --------------------------------------------------------------

// `${serverId}\0${rootName}\0${relPath}` -> { promise, at }
const folderCache = new Map();
const cacheKey = (server, relPath) => `${server.id}\u0000${rootFolderName(server)}\u0000${relPath}`;

const forgetServer = (serverId) => {
  for (const key of folderCache.keys()) {
    if (key.startsWith(`${serverId}\u0000`)) folderCache.delete(key);
  }
};

// Drive query strings are single-quoted; escape backslash and quote.
const q = (value) => String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const findChild = async (drive, parentId, name, isFolder) => {
  const res = await withRetry(() => drive.files.list({
    q: `name = '${q(name)}' and '${q(parentId)}' in parents and trashed = false and mimeType ${isFolder ? '=' : '!='} '${FOLDER_MIME}'`,
    fields: 'files(id,name,size,md5Checksum)',
    spaces: 'drive',
    orderBy: 'createdTime',
    pageSize: 10,
  }));
  const files = (res.data && res.data.files) || [];
  return files[0] || null;
};

// Folder `name` under `parentId` (cached by relPath). With create=false a miss
// returns null and isn't cached. Concurrent callers share one in-flight
// lookup/create, so two uploads never make the same folder twice.
const folderId = async (drive, server, relPath, parentId, name, create) => {
  const key = cacheKey(server, relPath);
  const hit = folderCache.get(key);
  if (hit && Date.now() - hit.at < FOLDER_CACHE_TTL_MS) return hit.promise;

  if (!create) {
    const found = await findChild(drive, parentId, name, true);
    if (found) folderCache.set(key, { promise: Promise.resolve(found.id), at: Date.now() });
    return found ? found.id : null;
  }

  const promise = (async () => {
    const found = await findChild(drive, parentId, name, true);
    if (found) return found.id;
    const res = await withRetry(() => drive.files.create({
      requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
      fields: 'id',
    }));
    return res.data.id;
  })();
  folderCache.set(key, { promise, at: Date.now() });
  try {
    return await promise;
  } catch (err) {
    folderCache.delete(key);
    throw err;
  }
};

// Walk `dirPath` (POSIX, relative to the top folder). Returns the folder ID, or
// null when create=false and some folder doesn't exist yet.
const resolveFolder = async (drive, server, dirPath, create) => {
  let parentId = await folderId(drive, server, '', 'root', rootFolderName(server), create);
  if (!parentId) return null;
  let walked = '';
  for (const seg of String(dirPath || '').split('/').filter((s) => s && s !== '.')) {
    walked = walked ? `${walked}/${seg}` : seg;
    parentId = await folderId(drive, server, walked, parentId, seg, create);
    if (!parentId) return null;
  }
  return parentId;
};

const findFile = async (drive, server, remoteKey) => {
  const parentId = await resolveFolder(drive, server, path.posix.dirname(remoteKey), false);
  if (!parentId) return null;
  return findChild(drive, parentId, path.posix.basename(remoteKey), false);
};

const requireFile = async (drive, server, remoteKey) => {
  const file = await findFile(drive, server, remoteKey);
  if (!file) {
    const err = new Error(`not found on Google Drive: ${remoteKey}`);
    err.status = 404;
    throw err;
  }
  return file;
};

const md5OfFile = async (localPath) => {
  const hash = crypto.createHash('md5');
  await pipeline(fs.createReadStream(localPath), hash);
  return hash.digest('hex');
};

// ---- provider surface (mirrors ./sftp.js) ----------------------------------

// Never throws. Creates the top folder so a passing test means uploads work.
const testConnection = async (server) => {
  try {
    forgetServer(server.id);
    const drive = driveFor(server);
    await resolveFolder(drive, server, '', true);
    const about = await withRetry(() => drive.about.get({ fields: 'user(emailAddress),storageQuota(limit,usage)' }));
    const quota = (about.data && about.data.storageQuota) || {};
    return {
      ok: true,
      fingerprint: null,
      error: null,
      email: (about.data && about.data.user && about.data.user.emailAddress) || null,
      storage: {
        limit: quota.limit ? Number(quota.limit) : null, // null = unlimited
        usage: quota.usage ? Number(quota.usage) : null,
      },
    };
  } catch (err) {
    const e = normalizeError(err);
    return { ok: false, fingerprint: null, error: e.message, reconnect: e.code === RECONNECT };
  }
};

// Upload (or replace) the file at remoteKey, then check Drive's MD5 against the
// local file. Replacing an existing same-name file keeps retries idempotent.
// Returns the remote size.
const putFile = async (server, localPath, remoteKey, retriedStaleCache = false) => {
  const drive = driveFor(server);
  const name = path.posix.basename(remoteKey);
  try {
    const parentId = await resolveFolder(drive, server, path.posix.dirname(remoteKey), true);
    const existing = await findChild(drive, parentId, name, false);
    const media = () => ({ mimeType: mimeFor(name), body: fs.createReadStream(localPath) });
    const fields = 'id,size,md5Checksum';
    const res = await withRetry(() => (existing
      ? drive.files.update({ fileId: existing.id, media: media(), fields })
      : drive.files.create({ requestBody: { name, parents: [parentId] }, media: media(), fields })));

    const localMd5 = await md5OfFile(localPath);
    if (res.data.md5Checksum && res.data.md5Checksum !== localMd5) {
      throw new Error(`md5 mismatch: local ${localMd5} vs Drive ${res.data.md5Checksum}`);
    }
    return Number(res.data.size);
  } catch (err) {
    // A cached folder was deleted in Drive by hand: forget the cache, try once more.
    if (statusOf(err) === 404 && !retriedStaleCache) {
      forgetServer(server.id);
      return putFile(server, localPath, remoteKey, true);
    }
    throw normalizeError(err);
  }
};

const remoteSize = async (server, remoteKey) => {
  try {
    const file = await requireFile(driveFor(server), server, remoteKey);
    return Number(file.size);
  } catch (err) {
    throw normalizeError(err);
  }
};

// Download to a local path (used for re-replication / catch-up).
const getFile = async (server, remoteKey, localPath) => {
  try {
    const drive = driveFor(server);
    const file = await requireFile(drive, server, remoteKey);
    const res = await withRetry(() => drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'stream' }));
    await pipeline(res.data, fs.createWriteStream(localPath));
    return localPath;
  } catch (err) {
    throw normalizeError(err);
  }
};

const existsRemote = async (server, remoteKey) => {
  try {
    return !!(await findFile(driveFor(server), server, remoteKey));
  } catch (err) {
    throw normalizeError(err);
  }
};

// Moves to Drive's Trash (30-day undo) rather than deleting outright.
const deleteRemote = async (server, remoteKey) => {
  try {
    const drive = driveFor(server);
    const file = await findFile(drive, server, remoteKey);
    if (file) {
      await withRetry(() => drive.files.update({ fileId: file.id, requestBody: { trashed: true }, fields: 'id' }));
    }
    return true;
  } catch (err) {
    throw normalizeError(err);
  }
};

// Returns { stream, close }. Drive honors HTTP Range on alt=media, so PDF/image
// viewers can seek the same as with local or SFTP files.
const openReadStream = async (server, remoteKey, range) => {
  try {
    const drive = driveFor(server);
    const file = await requireFile(drive, server, remoteKey);
    const headers = {};
    if (range && Number.isFinite(range.start)) {
      headers.Range = `bytes=${range.start}-${Number.isFinite(range.end) ? range.end : ''}`;
    }
    const res = await withRetry(() => drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'stream', headers },
    ));
    const stream = res.data;
    const close = () => { try { stream.destroy(); } catch { /* ignore */ } };
    return { stream, close };
  } catch (err) {
    throw normalizeError(err);
  }
};

module.exports = {
  DEFAULT_ROOT_FOLDER,
  RECONNECT,
  testConnection,
  putFile,
  getFile,
  remoteSize,
  existsRemote,
  deleteRemote,
  openReadStream,
  forgetServer,
  normalizeError,
  // test hooks
  _setDriveFor: (fn) => { driveFor = fn || realDriveFor; },
  _setSleep: (fn) => { sleep = fn; },
  _clearCache: () => folderCache.clear(),
};
