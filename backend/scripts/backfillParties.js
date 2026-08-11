// One-time (idempotent) backfill for the Party ledger. Creates a Party for
// every reference, hospital, and distinct free-text expense party name, then
// links existing expenses/invoices to their party. Safe to re-run: it skips
// parties that already link a master and only fills rows whose partyId is null.
//
//   node scripts/backfillParties.js
const prisma = require('../config/prisma');

async function main() {
  let refParties = 0, hospParties = 0, nameParties = 0, expLinked = 0, invLinked = 0;

  // 1) References -> parties, then link their expenses.
  for (const r of await prisma.reference.findMany()) {
    let party = await prisma.party.findUnique({ where: { referenceId: r.id } });
    if (!party) {
      party = await prisma.party.create({
        data: { name: r.name, phone: r.mobile || '', billingAddress: r.address || '', referenceId: r.id, isActive: r.isActive },
      });
      refParties++;
    }
    expLinked += (await prisma.expense.updateMany({ where: { referenceId: r.id, partyId: null }, data: { partyId: party.id } })).count;
  }

  // 2) Hospitals -> parties, then link their invoices.
  for (const h of await prisma.hospital.findMany()) {
    let party = await prisma.party.findUnique({ where: { hospitalId: h.id } });
    if (!party) {
      party = await prisma.party.create({
        data: { name: h.name, phone: h.phone || '', email: h.email || '', billingAddress: h.address || '', state: h.state || '', hospitalId: h.id, isActive: h.isActive },
      });
      hospParties++;
    }
    invLinked += (await prisma.invoice.updateMany({ where: { hospitalId: h.id, partyId: null }, data: { partyId: party.id } })).count;
  }

  // 3) Free-text expense party names (no reference) -> standalone parties.
  const orphans = await prisma.expense.findMany({
    where: { partyId: null, referenceId: null, NOT: { partyName: '' } },
    select: { id: true, partyName: true },
  });
  const byName = new Map();
  for (const e of orphans) {
    const key = (e.partyName || '').trim();
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(e.id);
  }
  for (const [name, ids] of byName) {
    let party = await prisma.party.findFirst({ where: { name, hospitalId: null, referenceId: null } });
    if (!party) { party = await prisma.party.create({ data: { name } }); nameParties++; }
    expLinked += (await prisma.expense.updateMany({ where: { id: { in: ids } }, data: { partyId: party.id } })).count;
  }

  console.log(`Parties created — references: ${refParties}, hospitals: ${hospParties}, expense names: ${nameParties}`);
  console.log(`Linked — expenses: ${expLinked}, invoices: ${invLinked}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
