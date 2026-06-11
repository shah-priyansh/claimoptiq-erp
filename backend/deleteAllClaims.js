// One-shot wipe of every claim in the database.
//
// Usage:
//   cd backend
//   node deleteAllClaims.js          # interactive — must type DELETE ALL to proceed
//   CONFIRM=DELETE_ALL node deleteAllClaims.js   # non-interactive for CI/scripts
//
// What it does (in this order, inside a single transaction):
//   1. Reads every ClaimDocument's filePath (so disk files can be cleaned after).
//   2. Unlinks DocumentSubmissions (sets claim_id = NULL) — that FK isn't cascade.
//   3. Deletes notifications referencing claims by id (referenceId).
//   4. Deletes all claims. Prisma cascades:
//        - claim_status_history
//        - claim_documents
//   5. Removes the physical files for the documents from disk.
//
// Hospitals, insurers, TPAs, users, masters, etc. are NOT touched.

const path = require('path');
const fs = require('fs');
const readline = require('readline');
const prisma = require('./config/prisma');

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a); });
  });

(async () => {
  try {
    const claimCount = await prisma.claim.count();
    if (claimCount === 0) {
      console.log('No claims to delete.');
      process.exit(0);
    }
    console.log(`About to permanently delete ${claimCount} claim(s).`);
    console.log('This also removes their status history, documents (DB rows + files on disk).');
    console.log('Hospitals, insurers, TPAs, users, and other masters are untouched.');
    console.log('');

    const confirm = process.env.CONFIRM
      || (await ask('Type "DELETE ALL" to proceed: '));
    if (confirm.trim() !== 'DELETE ALL' && confirm.trim() !== 'DELETE_ALL') {
      console.log('Aborted — confirmation did not match.');
      process.exit(1);
    }

    // 1. Collect file paths BEFORE deleting (cascade will drop the rows).
    const docs = await prisma.claimDocument.findMany({ select: { filePath: true } });

    // 2-4. Wrap DB mutations in a transaction so a partial failure doesn't
    //      leave dangling references.
    const result = await prisma.$transaction(async (tx) => {
      const unlinkedSubs = await tx.documentSubmission.updateMany({
        where: { claimId: { not: null } },
        data: { claimId: null },
      });

      // Best-effort: clear notifications whose referenceId is a deleted claim id.
      // `referenceId` is a generic string (not a FK), so collect ids first and
      // delete matching notifications.
      const claimIds = (await tx.claim.findMany({ select: { id: true } })).map(c => c.id);
      let notifCleared = 0;
      if (claimIds.length) {
        const r = await tx.notification.deleteMany({
          where: { type: 'claim', referenceId: { in: claimIds } },
        });
        notifCleared = r.count;
      }

      const deleted = await tx.claim.deleteMany({});

      // Reset the sr_no sequence so the next imported claim starts at 1.
      await tx.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('claims', 'sr_no'), 1, false)`
      );

      return { deleted: deleted.count, unlinkedSubs: unlinkedSubs.count, notifCleared };
    });

    console.log(`Deleted ${result.deleted} claim(s) from DB.`);
    console.log(`Unlinked ${result.unlinkedSubs} document submission(s) from their claim.`);
    console.log(`Cleared ${result.notifCleared} claim-referenced notification(s).`);

    // 5. Filesystem cleanup. Runs outside the transaction; if a file is missing
    //    we just skip it.
    let filesDeleted = 0;
    let filesMissing = 0;
    let filesErrored = 0;
    const uploadsDir = path.join(__dirname, 'uploads');
    for (const { filePath } of docs) {
      if (!filePath) continue;
      const abs = path.isAbsolute(filePath)
        ? filePath
        : path.join(uploadsDir, path.basename(filePath));
      try {
        if (fs.existsSync(abs)) {
          fs.unlinkSync(abs);
          filesDeleted += 1;
        } else {
          filesMissing += 1;
        }
      } catch (e) {
        filesErrored += 1;
        console.warn(`Could not delete ${abs}: ${e.message}`);
      }
    }
    console.log(`Files: ${filesDeleted} deleted, ${filesMissing} missing, ${filesErrored} errored.`);
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Wipe failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
