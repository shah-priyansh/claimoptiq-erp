// Backup / offload engine.
//
// Copies local uploaded files to ALL enabled SFTP servers, byte-verifies each
// copy, and (once the PRIMARY server confirms) marks the file synced and frees
// the local copy. Retrieval of offloaded files happens in services/fileRetrieval.
//
// Safety invariants:
//   * never delete a local file unless the PRIMARY FileBackupLocation is
//     'verified' (remoteSize === localSize)
//   * one offload run at a time (module mutex) — cron/on-settled/manual overlap
//   * idempotent via FileBackupLocation @@unique(sourceType, sourceId, serverId)

const fs = require('fs');
const path = require('path');
const prisma = require('../config/prisma');
const sftp = require('../utils/sftpProvider');
const { loadConfig } = require('../utils/backupConfig');
const { uploadsUsagePct, uploadsDir } = require('../utils/diskUsage');

let isRunning = false;

const CLAIM_DOC = 'claim_document';
const SUBMISSION = 'document_submission';

// Resolve the on-disk path for a record, tolerating legacy absolute paths that
// may not match the current deploy root (mirrors claimController.removeClaimFiles).
const resolveLocalPath = (filePath, fileName) => {
  if (filePath && path.isAbsolute(filePath) && fs.existsSync(filePath)) return filePath;
  const byBase = path.join(uploadsDir, path.basename(filePath || fileName || ''));
  if (fs.existsSync(byBase)) return byBase;
  return filePath || byBase;
};

const remoteKeyFor = (sourceType, date, fileName) => {
  const d = date instanceof Date ? date : new Date(date || Date.now());
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${sourceType}/${yyyy}/${mm}/${fileName}`;
};

const getEnabledServers = () =>
  prisma.backupServer.findMany({
    where: { isEnabled: true },
    orderBy: [{ isPrimary: 'desc' }, { order: 'asc' }, { createdAt: 'asc' }],
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
    prisma.claimDocument.findMany({ where: claimWhere, orderBy: { uploadedAt: 'asc' }, take: limit }),
    prisma.documentSubmission.findMany({ where: subWhere, orderBy: { createdAt: 'asc' }, take: limit }),
  ]);
  const items = [
    ...docs.map((d) => ({
      sourceType: CLAIM_DOC, id: d.id, fileName: d.fileName, filePath: d.filePath,
      fileSize: d.fileSize, date: d.uploadedAt,
    })),
    ...subs.map((s) => ({
      sourceType: SUBMISSION, id: s.id, fileName: s.fileName, filePath: s.filePath,
      fileSize: s.fileSize, date: s.createdAt,
    })),
  ];
  items.sort((a, b) => new Date(a.date) - new Date(b.date));
  return items.slice(0, limit);
};

const fileModel = (sourceType) =>
  (sourceType === CLAIM_DOC ? prisma.claimDocument : prisma.documentSubmission);

// Offload a single file to every enabled server, then gate local deletion on
// the primary. Mutates `run` counters. Returns a short result object.
const offloadOne = async (item, servers, primaryId, run, cfg, log) => {
  const localPath = resolveLocalPath(item.filePath, item.fileName);
  if (!fs.existsSync(localPath)) {
    log(`skip ${item.fileName}: not found on local disk`);
    return { uploaded: false, deletedLocal: false, bytesFreed: 0 };
  }
  const localSize = fs.statSync(localPath).size;
  const remoteKey = remoteKeyFor(item.sourceType, item.date, item.fileName);

  let primaryVerified = false;
  for (const server of servers) {
    const baseWhere = {
      sourceType_sourceId_serverId: {
        sourceType: item.sourceType, sourceId: item.id, serverId: server.id,
      },
    };
    await prisma.fileBackupLocation.upsert({
      where: baseWhere,
      create: { sourceType: item.sourceType, sourceId: item.id, serverId: server.id, remoteKey, status: 'pending' },
      update: { remoteKey, status: 'pending', error: null },
    });
    try {
      await sftp.putFile(server, localPath, remoteKey);
      const rSize = await sftp.remoteSize(server, remoteKey);
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
      if (loc.server) await sftp.deleteRemote(loc.server, loc.remoteKey);
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
      await sftp.getFile(source, loc.remoteKey, tmpPath);
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
        await sftp.putFile(t, tmpPath, loc.remoteKey);
        const rSize = await sftp.remoteSize(t, loc.remoteKey);
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

    // Pressure gate (manual force bypasses it).
    const threshold = cfg.num('backup_disk_threshold_pct');
    const target = cfg.num('backup_disk_target_pct');
    let pct = await uploadsUsagePct();
    if (!force && pct !== null && pct < threshold) {
      log(`disk ${pct.toFixed(1)}% < threshold ${threshold}% — nothing to do`);
      return await finish('skipped');
    }

    const servers = await getEnabledServers();
    if (!servers.length) {
      log('no enabled backup servers configured');
      return await finish('failed', { errorCount: 1 });
    }
    const primary = servers.find((s) => s.isPrimary) || null;
    if (!primary) {
      log('no enabled PRIMARY server — cannot gate local deletion');
      return await finish('failed', { errorCount: 1 });
    }

    const cap = cfg.num('backup_run_file_cap');
    const items = await listOffloadableFiles(fileFilter, cap);
    run.errorCount = 0;
    let filesUploaded = 0;
    let filesDeleted = 0;
    let bytesFreed = 0;

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

    const status = run.errorCount === 0
      ? 'success'
      : (filesUploaded > 0 ? 'partial' : 'failed');

    return await finish(status, {
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
  getEnabledServers,
  remoteKeyFor,
  resolveLocalPath,
  CLAIM_DOC,
  SUBMISSION,
};
