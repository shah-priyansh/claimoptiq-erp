// Idempotent repair: link hospitals to the Reference master by name.
//
// Hospitals imported via CSV carried the referrer as free-text `referenceBy`
// only, leaving `referenceId` (the FK) null — so the reference-commission engine
// (which keys off the FK) skipped them. This sets referenceId wherever the
// free-text `referenceBy` exactly matches a Reference master name (case-insensitive).
//
// Only fills null FKs; never overwrites an existing link; never touches text.
//   node scripts/linkHospitalReferences.js
const prisma = require('../config/prisma');

async function main() {
  const refs = await prisma.reference.findMany({ select: { id: true, name: true } });
  const byName = new Map(refs.map((r) => [r.name.trim().toLowerCase(), r.id]));

  const hosps = await prisma.hospital.findMany({
    where: { referenceId: null, NOT: { referenceBy: '' } },
    select: { id: true, name: true, referenceBy: true },
  });

  let linked = 0;
  const unmatched = new Set();
  for (const h of hosps) {
    const key = (h.referenceBy || '').trim().toLowerCase();
    if (!key) continue;
    const refId = byName.get(key);
    if (!refId) { unmatched.add(h.referenceBy); continue; }
    await prisma.hospital.update({ where: { id: h.id }, data: { referenceId: refId } });
    linked += 1;
    console.log(`  linked ${h.name} -> ${h.referenceBy}`);
  }

  const stillNull = await prisma.hospital.count({ where: { referenceId: null, NOT: { referenceBy: '' } } });
  console.log(`\nLinked ${linked} hospital(s). Free-text refs with no master match (left unlinked): ${[...unmatched].length}`);
  if (unmatched.size) console.log('  unmatched:', [...unmatched]);
  console.log(`Hospitals still free-text-only (referenceBy set, referenceId null): ${stillNull}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
