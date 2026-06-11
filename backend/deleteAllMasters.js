// One-shot wipe of Insurance Companies, TPAs, and Hospitals.
//
// Usage:
//   cd backend
//   node deleteAllMasters.js                        # interactive
//   CONFIRM=DELETE_ALL node deleteAllMasters.js     # non-interactive
//
// Safety:
//   - Refuses if any Claim still exists (run delete-all-claims first).
//   - Before deleting Hospitals: nulls user.hospital_id (FK is nullable) and
//     deletes DocumentSubmissions tied to a hospital (FK is non-nullable so
//     they'd otherwise block the delete).
//   - Wraps mutations in a single transaction.
//
// Note on "starting from 1": these masters use UUID ids, so there's no
// sequence to reset. The "#" column in the lists is just a row index that
// already restarts at 1 on the next page load.

const readline = require('readline');
const prisma = require('./config/prisma');

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => { rl.close(); resolve(a); });
  });

(async () => {
  try {
    const [hospCount, insCount, tpaCount, claimCount] = await Promise.all([
      prisma.hospital.count(),
      prisma.insuranceCompany.count(),
      prisma.tPA.count(),
      prisma.claim.count(),
    ]);

    if (claimCount > 0) {
      console.log(`Refusing to wipe masters: ${claimCount} claim(s) still exist.`);
      console.log('Run `npm run delete-all-claims` first, then re-run this script.');
      process.exit(1);
    }

    if (hospCount + insCount + tpaCount === 0) {
      console.log('Nothing to delete — Hospitals, Insurance Companies, and TPAs are all empty.');
      process.exit(0);
    }

    const [usersWithHospital, hospitalSubs] = await Promise.all([
      prisma.user.count({ where: { hospitalId: { not: null } } }),
      prisma.documentSubmission.count(),
    ]);

    console.log(`About to permanently delete:`);
    console.log(`  - ${hospCount} hospital(s)  (cascades to billing services, doctors)`);
    console.log(`  - ${insCount} insurance company(ies)`);
    console.log(`  - ${tpaCount} TPA(s)`);
    if (usersWithHospital) {
      console.log(`  + unlink ${usersWithHospital} user(s) from their hospital (hospital_id → NULL)`);
    }
    if (hospitalSubs) {
      console.log(`  + delete ${hospitalSubs} document submission(s) (FK to hospital is non-nullable)`);
    }
    console.log('');
    console.log('Claims, users, roles, and other masters are NOT touched.');
    console.log('');

    const confirm = process.env.CONFIRM
      || (await ask('Type "DELETE ALL" to proceed: '));
    if (confirm.trim() !== 'DELETE ALL' && confirm.trim() !== 'DELETE_ALL') {
      console.log('Aborted — confirmation did not match.');
      process.exit(1);
    }

    const result = await prisma.$transaction(async (tx) => {
      let unlinkedUsers = 0;
      let deletedSubs = 0;
      if (usersWithHospital) {
        const r = await tx.user.updateMany({
          where: { hospitalId: { not: null } },
          data: { hospitalId: null },
        });
        unlinkedUsers = r.count;
      }
      if (hospitalSubs) {
        const r = await tx.documentSubmission.deleteMany({});
        deletedSubs = r.count;
      }
      const insDel  = await tx.insuranceCompany.deleteMany({});
      const tpaDel  = await tx.tPA.deleteMany({});
      const hospDel = await tx.hospital.deleteMany({});
      return {
        hospitals: hospDel.count,
        insurance: insDel.count,
        tpas:      tpaDel.count,
        unlinkedUsers,
        deletedSubs,
      };
    });

    console.log(`Deleted ${result.hospitals} hospital(s), ${result.insurance} insurance company(ies), ${result.tpas} TPA(s).`);
    if (result.unlinkedUsers) console.log(`Unlinked ${result.unlinkedUsers} user(s) from their hospital.`);
    if (result.deletedSubs)   console.log(`Deleted ${result.deletedSubs} document submission(s).`);
    console.log('Done.');
    process.exit(0);
  } catch (err) {
    console.error('Wipe failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
})();
