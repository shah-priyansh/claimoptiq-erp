// Backup / offload engine.
//
// Copies local uploaded files to ALL enabled backup servers (SFTP or Google
// Drive — see utils/backupProviders), byte-verifies each copy, and (once the
// PRIMARY server confirms) marks the file synced and frees the local copy.
// Retrieval of offloaded files happens in services/fileRetrieval.
//
// Every run also does a copy-only "catch-up" for non-primary servers (before
// the disk-pressure gate): any file with no verified copy there yet is copied
// from local disk, or from another server once the local copy is gone. That
// back-fills a newly added server and retries copies that failed earlier.
//
// Safety invariants:
//   * never delete a local file unless the PRIMARY FileBackupLocation is
//     'verified' (remoteSize === localSize)
//   * one offload run at a time (module mutex) — cron/on-settled/manual overlap
//   * idempotent via FileBackupLocation @@unique(sourceType, sourceId, serverId)

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const { providerFor } = require('../utils/backupProviders');
const { RECONNECT } = require('../utils/backupProviders/gdrive');
const { loadConfig } = require('../utils/backupConfig');
const { uploadsUsagePct, uploadsDir } = require('../utils/diskUsage');
const fccPath = require('../utils/fccBackupPath');

let isRunning = false;

const CLAIM_DOC = 'claim_document';
const SUBMISSION = 'document_submission';
const CATCH_UP_MAX_FAILS_IN_A_ROW = 5;

// Resolve the on-disk path for a record, tolerating legacy absolute paths that
// may not match the current deploy root (mirrors claimController.removeClaimFiles).
const resolveLocalPath = (filePath, fileName) => {
  if (filePath && path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
  const byBase = path.join(uploadsDir, path.basename(filePath || fileName || ''));
  if (fs.existsSync(byBase)) return byBase;
  return filePath || byBase;
};

// Claim documents file into the same FCC filing tree the local upload path
// and the Settled Claims Backup ZIP already use (Hospital -> Patient ->
// category), so the SFTP server is human-browsable too. Everything else
// (document submissions, or a claim document whose claim relation somehow
// didn't load) keeps the flat sourceType/YYYY/MM/fileName scheme — those
// don't carry the hospital/patient context the tree needs.
const remoteKeyFor = (item) => {
  if (item.sourceType === CLAIM_DOC && item.claim) {
    const dir = fccPath.documentFolderPath(item.claim, item.category);
    return `${dir}/${item.fileName}`;
  }
  const d = item.date instanceof Date ? item.date : new Date(item.date || Date.now());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${item.sourceType}/${yyyy}/${mm}/${item.fileName}`;
};

// A Google Drive server that was never connected has nothing to talk to yet.
const getEnabledServers = () =>
  prisma.backupServer.findMany({
    where: { isEnabled: true, NOT: { type: 'gdrive', encGdriveRefreshToken: null } },
    orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
  });

const CLAIM_PATH_SELECT = {
  claimType: true, isDirectPatient: true, patientName: true, srNo: true,
  hospital: { select: { name: true } },
  insuranceCompany: { select: { name: true } },
  tpa: { select: { name: true } },
};

const docToItem = (d) => ({
  sourceType: CLAIM_DOC, id: d.id, fileName: d.fileName, filePath: d.filePath,
  fileSize: d.fileSize, date: d.uploadedAt, claim: d.claim, category: d.category,
  remoteKey: d.remoteKey,
});
const subToItem = (s) => ({
  sourceType: SUBMISSION, id: s.id, fileName: s.fileName, filePath: s.filePath,
  fileSize: s.fileSize, date: s.createdAt, remoteKey: s.remoteKey,
});

// Build the unified list of offloadable files (oldest-first), capped by `limit`.
// `fileFilter` may scope by claimId, e.g. { claimId: 'x' } or { claimId: { in: [...] } }.
const listOffloadableFiles = async (fileFilter = null, limit = 1000) => {
  const claimWhere = { isSynced: false, storageLocation: 'local' };
  const subWhere = { isSynced: false, storageLocation: 'local' };
  if (fileFilter && fileFilter.claimId !== undefined) {
    claimWhere.claimId = fileFilter.claimId;
    subWhere.claimId = fileFilter.claimId;
  }
  const [docs, subs] = await Promise.all([
    prisma.claimDocument.findMany({
      where: claimWhere, orderBy: { uploadedAt: 'asc' }, take: limit,
      include: { claim: { select: CLAIM_PATH_SELECT } },
    }),
    prisma.documentSubmission.findMany({ where: subWhere, orderBy: { createdAt: 'asc' }, take: limit }),
  ]);
  const items = [...docs.map(docToItem), ...subs.map(subToItem)];
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  return items.slice(0, limit);
};

const fileModel = (sourceType) =>
  (sourceType === CLAIM_DOC ? prisma.claimDocument : prisma.documentSubmission);

// A Drive server whose Google access was revoked fails every call — flag it so
// Backup settings shows it as unreachable (with a Reconnect button).
const noteServerError = async (server, err) => {
  if (!err || err.code !== RECONNECT) return;
  await prisma.backupServer.update({
    where: { id: server.id },
    data: { lastTestOk: false, lastTestedAt: new Date() },
  }).catch(() => {});
};

// Offload a single file to every enabled server, then gate local deletion on
// the primary. Mutates `run` counters. Returns a short result object.
const offloadOne = async (item, servers, primaryId, run, cfg, log) => {
  const localPath = resolveLocalPath(item.filePath, item.fileName);
  if (!fs.existsSync(localPath)) {
    log(`skip ${item.fileName}: not found on local disk`);
    return { uploaded: false, deletedLocal: false, bytesFreed: 0 };
  }
  const localSize = fs.statSync(localPath).size;
  const remoteKey = remoteKeyFor(item);

  let primaryVerified = false;
  for (const server of servers) {
    const baseWhere = {
      sourceType_sourceId_serverId: {
        sourceType: item.sourceType, sourceId: item.id, serverId: server.id,
      },
    };
    // Already copied under the same key (e.g. by an earlier catch-up) — don't
    // upload the same bytes twice.
    const existing = await prisma.fileBackupLocation.findUnique({ where: baseWhere });
    if (existing && existing.status === 'verified' && existing.remoteKey === remoteKey) {
      if (server.id === primaryId) primaryVerified = true;
      continue;
    }
    await prisma.fileBackupLocation.upsert({
      where: baseWhere,
      create: { sourceType: item.sourceType, sourceId: item.id, serverId: server.id, remoteKey, status: 'pending' },
      update: { remoteKey, status: 'pending', error: null },
    });
    try {
      const provider = providerFor(server);
      await provider.putFile(server, localPath, remoteKey);
      const rSize = await provider.remoteSize(server, remoteKey);
      if (rSize === localSize) {
        await prisma.fileBackupLocation.update({
          where: baseWhere,
          data: { status: 'verified', remoteSize: rSize, uploadedAt: new Date() },
        });
        if (server.id === primaryId) primaryVerified = true;
      } else {
        await prisma.fileBackupLocation.update({
          where: baseWhere,
          data: { status: 'failed', remoteSize: rSize, error: `size mismatch: local ${localSize} vs remote ${rSize}` },
        });
        run.errorCount += 1;
        log(`FAIL ${item.fileName} on ${server.name}: size mismatch (${localSize} vs ${rSize})`);
      }
    } catch (err) {
      await prisma.fileBackupLocation.update({
        where: baseWhere,
        data: { status: 'failed', error: err.message },
      }).catch(() => {});
      run.errorCount += 1;
      log(`FAIL ${item.fileName} on ${server.name}: ${err.message}`);
      await noteServerError(server, err);
    }
  }

  if (!primaryVerified) {
    return { uploaded: false, deletedLocal: false, bytesFreed: 0 };
  }

  // Delete-during-run race: re-read the record; if it's gone, sweep remotes.
  const current = await fileModel(item.sourceType).findUnique({ where: { id: item.id } });
  if (!current) {
    log(`record ${item.fileName} deleted mid-run — cleaning remote copies`);
    await deleteRemoteCopies(item.sourceType, item.id).catch(() => {});
    return { uploaded: true, deletedLocal: false, bytesFreed: 0 };
  }

  await fileModel(item.sourceType).update({
    where: { id: item.id },
    data: { isSynced: true, storageLocation: 'remote', remoteKey, syncedAt: new Date() },
  });

  let deletedLocal = false;
  let bytesFreed = 0;
  if (cfg.bool('backup_delete_local_after_sync')) {
    try {
      if (fs.existsSync(localPath)) {
        fs.unlinkSync(localPath);
        deletedLocal = true;
        bytesFreed = localSize;
        await fileModel(item.sourceType).update({
          where: { id: item.id },
          data: { localDeletedAt: new Date() },
        });
      }
    } catch (err) {
      log(`WARN could not delete local ${item.fileName}: ${err.message}`);
    }
  }
  log(`OK ${item.fileName} → ${remoteKey} (${deletedLocal ? 'freed ' + localSize + 'B' : 'kept local'})`);
  return { uploaded: true, deletedLocal, bytesFreed };
};

// Remove every remote copy of a file across all servers and drop its location
// rows. Best-effort; never throws (callers fire-and-forget).
const deleteRemoteCopies = async (sourceType, sourceId) => {
  const locations = await prisma.fileBackupLocation.findMany({
    where: { sourceType, sourceId },
    include: { server: true },
  });
  for (const loc of locations) {
    try {
      if (loc.server) await providerFor(loc.server).deleteRemote(loc.server, loc.remoteKey);
    } catch { /* ignore unreachable host / already gone */ }
  }
  await prisma.fileBackupLocation.deleteMany({ where: { sourceType, sourceId } });
  return locations.length;
};

// Sole-holder guard: return the verified locations on `serverId` for files that
// have NO other verified copy on another enabled server AND whose local copy is
// already gone (storageLocation = 'remote'). Removing/disabling such a server
// would make those files permanently unreachable.
const assessServerRemoval = async (serverId) => {
  const mine = await prisma.fileBackupLocation.findMany({
    where: { serverId, status: 'verified' },
  });
  const sole = [];
  for (const loc of mine) {
    const others = await prisma.fileBackupLocation.count({
      where: {
        sourceType: loc.sourceType,
        sourceId: loc.sourceId,
        status: 'verified',
        serverId: { not: serverId },
        server: { isEnabled: true },
      },
    });
    if (others > 0) continue;
    const rec = await fileModel(loc.sourceType).findUnique({
      where: { id: loc.sourceId },
      select: { storageLocation: true },
    });
    if (rec && rec.storageLocation === 'remote') sole.push(loc);
  }
  return sole;
};

// Re-replicate this server's sole-hosted files to other enabled servers so the
// server can then be safely removed/disabled. Downloads each file from the
// source server to a temp local file, uploads + verifies on every other enabled
// server, then deletes the temp. Returns { replicated, targets }.
const replicateFromServer = async (serverId) => {
  const sole = await assessServerRemoval(serverId);
  if (!sole.length) return { replicated: 0, targets: 0 };

  const source = await prisma.backupServer.findUnique({ where: { id: serverId } });
  const targets = (await getEnabledServers()).filter((s) => s.id !== serverId);
  if (!targets.length) {
    const err = new Error('no other enabled server to replicate to');
    err.status = 409;
    throw err;
  }

  let replicated = 0;
  for (const loc of sole) {
    const tmpPath = path.join(uploadsDir, `.replicate-${loc.id}`);
    try {
      await providerFor(source).getFile(source, loc.remoteKey, tmpPath);
      const size = fs.statSync(tmpPath).size;
      for (const t of targets) {
        const where = {
          sourceType_sourceId_serverId: {
            sourceType: loc.sourceType, sourceId: loc.sourceId, serverId: t.id,
          },
        };
        await prisma.fileBackupLocation.upsert({
          where,
          create: { sourceType: loc.sourceType, sourceId: loc.sourceId, serverId: t.id, remoteKey: loc.remoteKey, status: 'pending' },
          update: { remoteKey: loc.remoteKey, status: 'pending', error: null },
        });
        await providerFor(t).putFile(t, tmpPath, loc.remoteKey);
        const rSize = await providerFor(t).remoteSize(t, loc.remoteKey);
        await prisma.fileBackupLocation.update({
          where,
          data: rSize === size
            ? { status: 'verified', remoteSize: rSize, uploadedAt: new Date() }
            : { status: 'failed', remoteSize: rSize, error: `size mismatch: ${size} vs ${rSize}` },
        });
      }
      replicated += 1;
    } finally {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
  return { replicated, targets: targets.length };
};

// Files with no verified copy on `serverId`: never-tried first, then ones that
// failed before (so a stuck file can't hog the cap every run), oldest first.
// Raw SQL because FileBackupLocation is keyed by (sourceType, sourceId), not a
// Prisma relation, and a NOT EXISTS scales where `notIn: [ids]` wouldn't.
const listMissingOn = async (serverId, limit) => {
  const [docRows, subRows] = await Promise.all([
    prisma.$queryRaw`
      SELECT d.id, d.uploaded_at AS at,
        EXISTS (SELECT 1 FROM file_backup_locations l
                WHERE l.source_type = ${CLAIM_DOC} AND l.source_id = d.id AND l.server_id = ${serverId}) AS tried
      FROM claim_documents d
      WHERE NOT EXISTS (SELECT 1 FROM file_backup_locations l
                        WHERE l.source_type = ${CLAIM_DOC} AND l.source_id = d.id
                          AND l.server_id = ${serverId} AND l.status = 'verified')
      ORDER BY tried ASC, d.uploaded_at ASC
      LIMIT ${limit}::int`,
    prisma.$queryRaw`
      SELECT s.id, s.created_at AS at,
        EXISTS (SELECT 1 FROM file_backup_locations l
                WHERE l.source_type = ${SUBMISSION} AND l.source_id = s.id AND l.server_id = ${serverId}) AS tried
      FROM document_submissions s
      WHERE NOT EXISTS (SELECT 1 FROM file_backup_locations l
                        WHERE l.source_type = ${SUBMISSION} AND l.source_id = s.id
                          AND l.server_id = ${serverId} AND l.status = 'verified')
      ORDER BY tried ASC, s.created_at ASC
      LIMIT ${limit}::int`,
  ]);
  const picked = pickCatchUp(docRows, subRows, limit);
  const docIds = picked.filter((r) => r.sourceType === CLAIM_DOC).map((r) => r.id);
  const subIds = picked.filter((r) => r.sourceType === SUBMISSION).map((r) => r.id);
  const [docs, subs] = await Promise.all([
    docIds.length
      ? prisma.claimDocument.findMany({ where: { id: { in: docIds } }, include: { claim: { select: CLAIM_PATH_SELECT } } })
      : [],
    subIds.length ? prisma.documentSubmission.findMany({ where: { id: { in: subIds } } }) : [],
  ]);
  const byKey = new Map([
    ...docs.map((d) => [`${CLAIM_DOC}:${d.id}`, docToItem(d)]),
    ...subs.map((s) => [`${SUBMISSION}:${s.id}`, subToItem(s)]),
  ]);
  return picked.map((r) => byKey.get(`${r.sourceType}:${r.id}`)).filter(Boolean);
};

// Merge the two per-table candidate lists into one, keeping the same order
// rule (untried before tried, then oldest first). Pure, for unit tests.
const pickCatchUp = (docRows, subRows, limit) => [
  ...docRows.map((r) => ({ sourceType: CLAIM_DOC, id: r.id, at: new Date(r.at), tried: !!r.tried })),
  ...subRows.map((r) => ({ sourceType: SUBMISSION, id: r.id, at: new Date(r.at), tried: !!r.tried })),
]
  .sort((a, b) => (a.tried === b.tried ? a.at - b.at : (a.tried ? 1 : -1)))
  .slice(0, limit);

// Copy one file onto `server`: from local disk when it's still there, else
// from a verified copy on one of `others` (primary first). Copy-only — never
// deletes anything. Returns true when the copy is verified.
const catchUpOne = async (item, server, others, log) => {
  const remoteKey = item.remoteKey || remoteKeyFor(item);
  const where = {
    sourceType_sourceId_serverId: { sourceType: item.sourceType, sourceId: item.id, serverId: server.id },
  };
  await prisma.fileBackupLocation.upsert({
    where,
    create: { sourceType: item.sourceType, sourceId: item.id, serverId: server.id, remoteKey, status: 'pending' },
    update: { remoteKey, status: 'pending', error: null },
  });

  let srcPath = resolveLocalPath(item.filePath, item.fileName);
  let tmpPath = null;
  try {
    if (!fs.existsSync(srcPath)) {
      const locs = await prisma.fileBackupLocation.findMany({
        where: {
          sourceType: item.sourceType, sourceId: item.id, status: 'verified',
          serverId: { in: others.map((s) => s.id) },
        },
      });
      locs.sort((a, b) => others.findIndex((s) => s.id === a.serverId) - others.findIndex((s) => s.id === b.serverId));
      if (!locs.length) throw new Error('no local copy and no verified copy on another server');
      tmpPath = path.join(uploadsDir, `.catchup-${server.id}-${item.id}`);
      let pulled = false;
      let lastErr = null;
      for (const loc of locs) {
        const src = others.find((s) => s.id === loc.serverId);
        try {
          await providerFor(src).getFile(src, loc.remoteKey, tmpPath);
          pulled = true;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!pulled) throw lastErr;
      srcPath = tmpPath;
    }

    const size = fs.statSync(srcPath).size;
    const provider = providerFor(server);
    await provider.putFile(server, srcPath, remoteKey);
    const rSize = await provider.remoteSize(server, remoteKey);
    if (rSize !== size) throw new Error(`size mismatch: local ${size} vs remote ${rSize}`);
    await prisma.fileBackupLocation.update({
      where,
      data: { status: 'verified', remoteSize: rSize, uploadedAt: new Date() },
    });
    return { ok: true };
  } catch (err) {
    await prisma.fileBackupLocation.update({ where, data: { status: 'failed', error: err.message } }).catch(() => {});
    log(`FAIL catch-up ${item.fileName} on ${server.name}: ${err.message}`);
    return { ok: false, err };
  } finally {
    try { if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
};

// Back-fill every non-primary server (all of them if there's no primary), up to
// `cap` files per server. Returns { copied, failed }.
const catchUpSecondaries = async (servers, primaryId, cap, log) => {
  let copied = 0;
  let failed = 0;
  for (const server of servers.filter((s) => s.id !== primaryId)) {
    const items = await listMissingOn(server.id, cap);
    if (!items.length) continue;
    log(`catch-up ${server.name}: ${items.length} file(s) missing`);
    const others = servers.filter((s) => s.id !== server.id);
    let failedInARow = 0;
    for (const item of items) {
      const res = await catchUpOne(item, server, others, log);
      if (res.ok) {
        copied += 1;
        failedInARow = 0;
      } else {
        failed += 1;
        failedInARow += 1;
        // Revoked / disconnected Drive: every other file would fail the same way.
        if (res.err && res.err.code === RECONNECT) {
          await noteServerError(server, res.err);
          log(`catch-up ${server.name}: stopped — ${res.err.message}`);
          break;
        }
        // Likely unreachable — don't burn the whole run on connect timeouts.
        // (Files that failed before sort last, so this can't starve new ones.)
        if (failedInARow >= CATCH_UP_MAX_FAILS_IN_A_ROW) {
          log(`catch-up ${server.name}: stopped after ${failedInARow} failures in a row`);
          break;
        }
      }
    }
  }
  return { copied, failed };
};

// Mark any run left 'running' (process crashed/redeployed mid-run) as interrupted.
const cleanupStaleRuns = async () => {
  const res = await prisma.backupRun.updateMany({
    where: { status: 'running' },
    data: { status: 'interrupted', finishedAt: new Date() },
  });
  return res.count;
};

// Top-level orchestrator.
// opts: { trigger, triggeredById, fileFilter, force, dryRun }
const runBackup = async (opts = {}) => {
  const { trigger = 'manual', triggeredById = null, fileFilter = null, force = false, dryRun = false } = opts;

  if (isRunning) return { skipped: true, reason: 'a backup run is already in progress' };
  isRunning = true;

  const logLines = [];
  const log = (line) => { logLines.push(line); };
  let run = null;

  try {
    const cfg = await loadConfig();

    run = await prisma.backupRun.create({
      data: { trigger, triggeredById, status: 'running' },
    });

    const finish = async (status, extra = {}) => {
      await prisma.backupRun.update({
        where: { id: run.id },
        data: { status, finishedAt: new Date(), log: logLines.join('\n').slice(0, 20000), ...extra },
      });
      // bytesFreed is a BigInt for the DB column but isn't JSON-serializable —
      // coerce to Number so the result can be sent over the wire (res.json).
      const wire = { ...extra };
      if (typeof wire.bytesFreed === 'bigint') wire.bytesFreed = Number(wire.bytesFreed);
      return { runId: run.id, status, ...wire };
    };

    if (!cfg.bool('backup_enabled')) {
      log('backup is globally disabled');
      return await finish('skipped');
    }

    const servers = await getEnabledServers();
    const primary = servers.find((s) => s.isPrimary) || null;
    const cap = cfg.num('backup_run_file_cap');
    run.errorCount = 0;
    let filesUploaded = 0;
    let filesDeleted = 0;
    let bytesFreed = 0;
    const outcome = () => (run.errorCount === 0 ? 'success' : (filesUploaded > 0 ? 'partial' : 'failed'));

    // Catch-up runs before the disk gate: it only copies, so safety-copy
    // servers (e.g. Google Drive) stay current even while the disk is fine.
    if (!dryRun && servers.length) {
      const caught = await catchUpSecondaries(servers, primary ? primary.id : null, cap, log);
      filesUploaded += caught.copied;
      run.errorCount += caught.failed;
    }

    // Pressure gate (manual force bypasses it).
    const threshold = cfg.num('backup_disk_threshold_pct');
    const target = cfg.num('backup_disk_target_pct');
    let pct = await uploadsUsagePct();
    if (!force && pct !== null && pct < threshold) {
      log(`disk ${pct.toFixed(1)}% < threshold ${threshold}% — nothing to offload`);
      if (!filesUploaded && !run.errorCount) return await finish('skipped');
      return await finish(outcome(), { filesUploaded, errorCount: run.errorCount });
    }

    if (!servers.length) {
      log('no enabled backup servers configured');
      return await finish('failed', { errorCount: run.errorCount + 1 });
    }
    if (!primary) {
      log('no enabled PRIMARY server — cannot gate local deletion');
      return await finish('failed', { filesUploaded, errorCount: run.errorCount + 1 });
    }

    const items = await listOffloadableFiles(fileFilter, cap);

    log(`${trigger} run: ${items.length} candidate file(s), disk ${pct === null ? 'n/a' : pct.toFixed(1) + '%'}`);

    if (dryRun) {
      const projected = items.reduce((sum, it) => sum + (it.fileSize || 0), 0);
      log(`dry run: would offload ${items.length} file(s), ~${projected} bytes`);
      return await finish('success', {
        filesScanned: items.length,
      });
    }

    for (const item of items) {
      const res = await offloadOne(item, servers, primary.id, run, cfg, log);
      if (res.uploaded) filesUploaded += 1;
      if (res.deletedLocal) filesDeleted += 1;
      bytesFreed += res.bytesFreed;

      // Stop early once disk pressure is relieved (only for non-forced runs).
      if (!force && target) {
        pct = await uploadsUsagePct();
        if (pct !== null && pct <= target) {
          log(`disk back to ${pct.toFixed(1)}% ≤ target ${target}% — stopping`);
          break;
        }
      }
    }

    return await finish(outcome(), {
      filesScanned: items.length,
      filesUploaded,
      filesDeleted,
      bytesFreed: BigInt(bytesFreed),
      errorCount: run.errorCount,
    });
  } catch (err) {
    if (run) {
      log(`run error: ${err.message}`);
      await prisma.backupRun.update({
        where: { id: run.id },
        data: { status: 'failed', finishedAt: new Date(), errorCount: { increment: 1 }, log: logLines.join('\n').slice(0, 20000) },
      }).catch(() => {});
    }
    return { error: err.message, runId: run ? run.id : null };
  } finally {
    isRunning = false;
  }
};

module.exports = {
  runBackup,
  listOffloadableFiles,
  offloadOne,
  deleteRemoteCopies,
  cleanupStaleRuns,
  assessServerRemoval,
  replicateFromServer,
  catchUpSecondaries,
  pickCatchUp,
  getEnabledServers,
  remoteKeyFor,
  resolveLocalPath,
  CLAIM_DOC,
  SUBMISSION,
};
