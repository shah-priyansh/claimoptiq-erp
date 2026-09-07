// Targeted, idempotent repair for the reported bug: bulk-imported HOSPITAL
// invoices were saved with partyId = null (the bulk-import path never linked
// them to their hospital's party), so they never appeared in the hospital's
// party ledger/balance. This links every such invoice to its hospital's party.
//
// Only touches invoices where hospitalId is set and partyId is null; it never
// creates parties (all hospitals already have one), never touches expenses, and
// is safe to re-run.
//
//   node scripts/linkHospitalInvoiceParties.js
const prisma = require('../config/prisma');

async function main() {
  const before = await prisma.invoice.count({ where: { partyId: null, hospitalId: { not: null } } });
  console.log(`Hospital invoices with partyId=null before: ${before}`);

  let linked = 0, skippedNoParty = 0;
  for (const h of await prisma.hospital.findMany({ select: { id: true, name: true } })) {
    const party = await prisma.party.findUnique({ where: { hospitalId: h.id }, select: { id: true } });
    if (!party) {
      const cnt = await prisma.invoice.count({ where: { hospitalId: h.id, partyId: null } });
      if (cnt) { skippedNoParty += cnt; console.log(`  ! ${h.name} has ${cnt} unlinked invoice(s) but NO party — skipped`); }
      continue;
    }
    const res = await prisma.invoice.updateMany({ where: { hospitalId: h.id, partyId: null }, data: { partyId: party.id } });
    if (res.count) { linked += res.count; console.log(`  linked ${res.count} invoice(s) -> ${h.name}`); }
  }

  const after = await prisma.invoice.count({ where: { partyId: null, hospitalId: { not: null } } });
  console.log(`\nLinked: ${linked}   Skipped (hospital has no party): ${skippedNoParty}`);
  console.log(`Hospital invoices with partyId=null after: ${after}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
