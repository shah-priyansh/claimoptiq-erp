// One-time repair: rename already-backed-up files on every backup server
// (Google Drive / SFTP) from multer's disk name ("1794487633059-307975679.pdf")
// to the name the user uploaded (ClaimDocument/DocumentSubmission.originalName).
//
// New backups already use the original name (services/backupService
// remoteKeyFor); this fixes the copies made before that change. Files are
// renamed in place — nothing is re-uploaded or deleted. Only keys whose file
// name is still the disk name are touched, so re-running is safe.
//
// Dry run by default (prints the plan). Run when no backup is in progress:
//   node scripts/renameBackupFilesToOriginal.js           # dry run
//   node scripts/renameBackupFilesToOriginal.js --apply   # rename for real
const path = require('path');
const prisma = require('../config/prisma');
const { providerFor } = require('../utils/backupProviders');
const fccPath = require('../utils/fccBackupPath');

const APPLY = process.argv.includes('--apply');
const CLAIM_DOC = 'claim_document';
const SUBMISSION = 'document_submission';
const MAX_SUFFIX = 50;

const fileModel = (sourceType) =>
  (sourceType === CLAIM_DOC ? prisma.claimDocument : prisma.documentSubmission);

// Same dir as the old key, original name, " (n)" when another record already
// owns that key. `reserved` holds keys planned earlier in a dry run.
const candidateKeys = function* (oldKey, record) {
  const dir = path.posix.dirname(oldKey);
  const name = fccPath.sanitizeSegment(record.originalName, '');
  if (!name) return;
  const ext = path.posix.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n <= MAX_SUFFIX; n += 1) {
    yield `${dir}/${n === 1 ? name : `${stem} (${n})${ext}`}`;
  }
};

const keyTakenByOther = async (key, sourceType, sourceId, reserved) => {
  if (reserved.has(key) && reserved.get(key) !== `${sourceType}:${sourceId}`) return true;
  const hit = await prisma.fileBackupLocation.findFirst({
    where: { remoteKey: key, NOT: { sourceType, sourceId } },
    select: { id: true },
  });
  return !!hit;
};

async function main() {
  console.log(APPLY ? '=== APPLY: renaming files ===' : '=== DRY RUN (pass --apply to rename) ===');

  const locs = await prisma.fileBackupLocation.findMany({
    where: { status: 'verified' },
    include: { server: true },
    orderBy: { createdAt: 'asc' },
  });

  // Group verified copies by record.
  const byRecord = new Map();
  for (const loc of locs) {
    const k = `${loc.sourceType}:${loc.sourceId}`;
    if (!byRecord.has(k)) byRecord.set(k, []);
    byRecord.get(k).push(loc);
  }

  const reserved = new Map(); // planned newKey -> record (dry run collision guard)
  const stats = { records: 0, renamed: 0, skipped: 0, failed: 0 };

  for (const [recKey, recLocs] of byRecord) {
    const [sourceType, sourceId] = recKey.split(':');
    if (sourceType !== CLAIM_DOC && sourceType !== SUBMISSION) continue;
    const record = await fileModel(sourceType).findUnique({
      where: { id: sourceId },
      select: { id: true, fileName: true, originalName: true, remoteKey: true },
    });
    if (!record || !record.originalName) { stats.skipped += 1; continue; }
    const diskName = path.basename(record.fileName || '');

    // Every distinct old key of this record that still carries the disk name.
    const oldKeys = [...new Set(recLocs.map((l) => l.remoteKey))]
      .filter((k) => path.posix.basename(k) === diskName);
    if (!oldKeys.length) continue;
    stats.records += 1;

    for (const oldKey of oldKeys) {
      let newKey = null;
      for (const cand of candidateKeys(oldKey, record)) {
        if (cand === oldKey) break;
        if (!(await keyTakenByOther(cand, sourceType, sourceId, reserved))) { newKey = cand; break; }
      }
      if (!newKey) { stats.skipped += 1; console.log(`  skip ${oldKey}: no free name`); continue; }
      reserved.set(newKey, recKey);

      const servers = recLocs.filter((l) => l.remoteKey === oldKey);
      console.log(`  ${oldKey}\n    -> ${path.posix.basename(newKey)}  (${servers.map((l) => l.server.name).join(', ')})`);
      if (!APPLY) { stats.renamed += servers.length; continue; }

      for (const loc of servers) {
        try {
          await providerFor(loc.server).renameRemote(loc.server, oldKey, newKey);
          await prisma.fileBackupLocation.update({ where: { id: loc.id }, data: { remoteKey: newKey } });
          stats.renamed += 1;
        } catch (err) {
          stats.failed += 1;
          console.log(`    FAIL on ${loc.server.name}: ${err.message}`);
        }
      }
      // Keep the record's key (used for catch-up copies) and any not-yet-verified
      // rows in step once at least one server holds the new name.
      const anyMoved = await prisma.fileBackupLocation.findFirst({
        where: { sourceType, sourceId, remoteKey: newKey, status: 'verified' }, select: { id: true },
      });
      if (anyMoved) {
        if (record.remoteKey === oldKey) {
          await fileModel(sourceType).update({ where: { id: sourceId }, data: { remoteKey: newKey } });
        }
        await prisma.fileBackupLocation.updateMany({
          where: { sourceType, sourceId, remoteKey: oldKey, status: { not: 'verified' } },
          data: { remoteKey: newKey },
        });
      }
    }
  }

  console.log(`\nrecords: ${stats.records}  ${APPLY ? 'renamed' : 'would rename'}: ${stats.renamed} copies  skipped: ${stats.skipped}  failed: ${stats.failed}`);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
