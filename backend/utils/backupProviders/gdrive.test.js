// Standalone test for the Google Drive backup provider, against an in-memory
// fake Drive (no network, no Google account needed).
// Run: node backend/utils/backupProviders/gdrive.test.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const gdrive = require('./gdrive');
const { providerFor } = require('./index');

let failures = 0;
const check = (name, cond) => {
  if (!cond) failures++;
  console.log(`${cond ? '✔' : '✘ FAIL'}  ${name}`);
};

const FOLDER = 'application/vnd.google-apps.folder';
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const readAll = async (stream) => {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};
const httpError = (status, reason, extra = {}) => {
  const err = new Error(`HTTP ${status}${reason ? ' ' + reason : ''}`);
  err.status = status;
  err.response = { status, data: { error: { errors: reason ? [{ reason }] : [] }, ...extra } };
  return err;
};

// Minimal in-memory Drive v3: just the calls the provider makes.
const makeFakeDrive = () => {
  const files = new Map(); // id -> { id, name, parents, mimeType, content, trashed, createdTime }
  const calls = { folderCreates: 0, fileCreates: 0, fileUpdates: 0, list: 0 };
  const failNext = []; // queued errors thrown by the next API call
  let corruptMd5 = false;
  let seq = 0;
  const maybeFail = () => { if (failNext.length) throw failNext.shift(); };
  const unq = (s) => s.replace(/\\(.)/g, '$1');
  const meta = (f) => ({
    id: f.id, name: f.name,
    size: f.content ? String(f.content.length) : undefined,
    md5Checksum: f.content ? (corruptMd5 ? 'bad' : md5(f.content)) : undefined,
  });

  const drive = {
    files: {
      list: async ({ q }) => {
        maybeFail();
        calls.list += 1;
        const m = /^name = '((?:[^'\\]|\\.)*)' and '((?:[^'\\]|\\.)*)' in parents and trashed = false and mimeType (=|!=) '([^']*)'$/.exec(q);
        if (!m) throw new Error(`fake drive: unparsed q: ${q}`);
        const [, name, parent, op, mime] = m;
        const hits = [...files.values()]
          .filter((f) => !f.trashed && f.name === unq(name) && f.parents.includes(unq(parent))
            && (op === '=' ? f.mimeType === mime : f.mimeType !== mime))
          .sort((a, b) => a.createdTime - b.createdTime);
        return { data: { files: hits.map(meta) } };
      },
      create: async ({ requestBody, media }) => {
        maybeFail();
        const parent = requestBody.parents[0];
        if (parent !== 'root' && !files.has(parent)) throw httpError(404, 'notFound');
        const content = media ? await readAll(media.body) : null;
        seq += 1;
        const f = {
          id: `id${seq}`, name: requestBody.name, parents: [parent],
          mimeType: requestBody.mimeType || (media && media.mimeType), content, trashed: false, createdTime: seq,
        };
        files.set(f.id, f);
        if (f.mimeType === FOLDER) calls.folderCreates += 1; else calls.fileCreates += 1;
        return { data: meta(f) };
      },
      update: async ({ fileId, media, requestBody }) => {
        maybeFail();
        const f = files.get(fileId);
        if (!f) throw httpError(404, 'notFound');
        if (media) { f.content = await readAll(media.body); calls.fileUpdates += 1; }
        if (requestBody && requestBody.trashed !== undefined) f.trashed = requestBody.trashed;
        return { data: meta(f) };
      },
      get: async ({ fileId }, opts = {}) => {
        maybeFail();
        const f = files.get(fileId);
        if (!f) throw httpError(404, 'notFound');
        let body = f.content;
        const range = opts.headers && opts.headers.Range;
        if (range) {
          const [, s, e] = /^bytes=(\d+)-(\d*)$/.exec(range);
          body = body.subarray(Number(s), e === '' ? body.length : Number(e) + 1);
        }
        return { data: Readable.from([body]) };
      },
    },
    about: {
      get: async () => {
        maybeFail();
        return { data: { user: { emailAddress: 'client@gmail.com' }, storageQuota: { limit: '16106127360', usage: '1024' } } };
      },
    },
  };
  return {
    drive, files, calls, failNext,
    setCorruptMd5: (v) => { corruptMd5 = v; },
    folderNamed: (name) => [...files.values()].filter((f) => f.mimeType === FOLDER && f.name === name && !f.trashed),
  };
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdrive-test-'));
const writeTmp = (name, content) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
};

const server = { id: 'srv1', type: 'gdrive', name: 'Drive', gdriveRootFolderName: null, encGdriveRefreshToken: 'x' };
const KEY_A = "First Care Consultancy/Hospital TPA Desk/Cashless Claim/City Hospital/D'Souza - Medi Assist - 7/a.pdf";
const KEY_B = "First Care Consultancy/Hospital TPA Desk/Cashless Claim/City Hospital/D'Souza - Medi Assist - 7/b.pdf";

(async () => {
  gdrive._setSleep(async () => {}); // no real backoff waits in tests
  let fake = makeFakeDrive();
  gdrive._setDriveFor(() => fake.drive);
  gdrive._clearCache();

  // ── providerFor ────────────────────────────────────────────────────────────
  check('providerFor(gdrive) is the Drive provider', providerFor({ type: 'gdrive' }) === gdrive);
  check('providerFor(sftp) is the SFTP provider', providerFor({ type: 'sftp' }) === require('./sftp'));
  check('providerFor(no type) defaults to SFTP', providerFor({}) === require('./sftp'));
  let threw = false;
  try { providerFor({ type: 'ftp' }); } catch { threw = true; }
  check('providerFor(unknown) throws', threw);

  // ── upload creates the tree once, under the app's top folder ──────────────
  const fileA = writeTmp('a.pdf', 'hello drive');
  const size = await gdrive.putFile(server, fileA, KEY_A);
  check('putFile returns the remote size', size === 11);
  check('top folder "ClaimOptiq Backups" created in My Drive',
    fake.folderNamed('ClaimOptiq Backups').length === 1
    && fake.folderNamed('ClaimOptiq Backups')[0].parents[0] === 'root');
  check('6 folders created (top + 5 path segments)', fake.calls.folderCreates === 6);
  check("folder with an apostrophe (D'Souza) created", fake.folderNamed("D'Souza - Medi Assist - 7").length === 1);

  // Same folder again: no new folders; same file again: replaced, not duplicated.
  await gdrive.putFile(server, writeTmp('b.pdf', 'second'), KEY_B);
  check('second file in same folder creates no new folders', fake.calls.folderCreates === 6);
  await gdrive.putFile(server, writeTmp('a2.pdf', 'hello drive v2'), KEY_A);
  check('re-uploading the same key updates instead of creating', fake.calls.fileCreates === 2 && fake.calls.fileUpdates === 1);

  // ── read back ─────────────────────────────────────────────────────────────
  check('remoteSize reflects the replaced content', (await gdrive.remoteSize(server, KEY_A)) === 14);
  check('existsRemote true for an uploaded key', await gdrive.existsRemote(server, KEY_A));
  check('existsRemote false for a missing key', !(await gdrive.existsRemote(server, 'nope/x.pdf')));
  const out = path.join(tmp, 'out.pdf');
  await gdrive.getFile(server, KEY_A, out);
  check('getFile downloads the exact bytes', fs.readFileSync(out, 'utf8') === 'hello drive v2');
  const full = await gdrive.openReadStream(server, KEY_A);
  check('openReadStream streams the whole file', (await readAll(full.stream)).toString() === 'hello drive v2');
  const part = await gdrive.openReadStream(server, KEY_A, { start: 6, end: 10 });
  check('openReadStream honors a byte range', (await readAll(part.stream)).toString() === 'drive');
  threw = false;
  try { await gdrive.remoteSize(server, 'nope/x.pdf'); } catch (err) { threw = err.status === 404; }
  check('remoteSize on a missing key throws 404', threw);

  // ── delete goes to Trash ──────────────────────────────────────────────────
  await gdrive.deleteRemote(server, KEY_B);
  const bFile = [...fake.files.values()].find((f) => f.name === 'b.pdf');
  check('deleteRemote moves the file to Trash (not hard-deleted)', bFile && bFile.trashed === true);
  check('trashed file no longer exists remotely', !(await gdrive.existsRemote(server, KEY_B)));
  check('deleteRemote on a missing key is a no-op', (await gdrive.deleteRemote(server, KEY_B)) === true);

  // ── concurrent uploads into a brand-new folder share one folder create ────
  const before = fake.calls.folderCreates;
  await Promise.all([1, 2, 3].map((i) => gdrive.putFile(server, writeTmp(`c${i}.pdf`, `c${i}`), `New Folder/c${i}.pdf`)));
  check('3 parallel uploads create "New Folder" once', fake.calls.folderCreates === before + 1 && fake.folderNamed('New Folder').length === 1);

  // ── stale folder cache (folder deleted by hand in Drive) recovers ─────────
  const newFolder = fake.folderNamed('New Folder')[0];
  fake.files.delete(newFolder.id);
  await gdrive.putFile(server, writeTmp('c4.pdf', 'c4'), 'New Folder/c4.pdf');
  check('upload after the cached folder vanished re-creates it', fake.folderNamed('New Folder').length === 1);

  // ── MD5 verification ──────────────────────────────────────────────────────
  fake.setCorruptMd5(true);
  threw = false;
  try { await gdrive.putFile(server, writeTmp('d.pdf', 'd'), 'x/d.pdf'); } catch (err) { threw = /md5 mismatch/.test(err.message); }
  check('putFile fails when Drive MD5 differs from local', threw);
  fake.setCorruptMd5(false);

  // ── retries + error mapping ───────────────────────────────────────────────
  fake.failNext.push(httpError(429), httpError(403, 'userRateLimitExceeded'));
  check('rate-limited calls are retried until they succeed', (await gdrive.remoteSize(server, KEY_A)) === 14);

  fake.failNext.push(httpError(500), httpError(500), httpError(500));
  threw = false;
  try { await gdrive.remoteSize(server, KEY_A); } catch (err) { threw = err.status === 500; }
  check('gives up after 3 attempts', threw && fake.failNext.length === 0);

  const grant = new Error('invalid_grant');
  grant.response = { status: 400, data: { error: 'invalid_grant' } };
  fake.failNext.push(grant, grant);
  let caught = null;
  try { await gdrive.remoteSize(server, KEY_A); } catch (err) { caught = err; }
  check('revoked access maps to a Reconnect error', caught && caught.code === gdrive.RECONNECT && /Reconnect/.test(caught.message));
  check('revoked access is not retried', fake.failNext.length === 1);
  fake.failNext.length = 0;

  fake.failNext.push(httpError(403, 'storageQuotaExceeded'));
  caught = null;
  try { await gdrive.putFile(server, writeTmp('e.pdf', 'e'), 'x/e.pdf'); } catch (err) { caught = err; }
  check('full Drive gives a plain "Google Drive is full" error', caught && /Google Drive is full/.test(caught.message));

  // ── testConnection ────────────────────────────────────────────────────────
  const t = await gdrive.testConnection(server);
  check('testConnection ok with account email + quota', t.ok && t.email === 'client@gmail.com' && t.storage.limit === 16106127360);
  fake.failNext.push(grant);
  const tBad = await gdrive.testConnection(server);
  check('testConnection reports reconnect on revoked access', !tBad.ok && tBad.reconnect === true);
  fake.failNext.length = 0;

  // ── custom top-folder name ────────────────────────────────────────────────
  const named = { ...server, id: 'srv2', gdriveRootFolderName: 'FCC Backup' };
  await gdrive.putFile(named, writeTmp('f.pdf', 'f'), 'y/f.pdf');
  check('custom top-folder name is used', fake.folderNamed('FCC Backup').length === 1);

  // ── not connected ─────────────────────────────────────────────────────────
  gdrive._setDriveFor(null); // back to the real client factory
  caught = null;
  try { await gdrive.remoteSize({ ...server, encGdriveRefreshToken: null }, KEY_A); } catch (err) { caught = err; }
  check('a never-connected server fails with a Connect message', caught && caught.code === gdrive.RECONNECT && /not connected/.test(caught.message));

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${failures === 0 ? 'ALL PASSED' : failures + ' FAILURE(S)'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
