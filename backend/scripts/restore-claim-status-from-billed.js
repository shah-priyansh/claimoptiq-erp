// One-shot repair: claims whose `status` got overwritten to 'billed' by the
// pre-fix `invoice.issue` flow. Walks every claim currently at status='billed',
// finds the latest issued invoice line item that billed it, and restores the
// claim to `line.meta.priorStatus`. Falls back to 'settled' if no meta.
//
// Mirrors backend/controllers/claimController.js `fixBilledStatus` but runs
// directly against the DB (no auth required). Safe: only writes claim.status.
//
// Usage:
//   node backend/scripts/restore-claim-status-from-billed.js         # dry run
//   node backend/scripts/restore-claim-status-from-billed.js --apply # write

const prisma = require('../config/prisma');
const APPLY = process.argv.includes('--apply');

async function main() {
  const stuck = await prisma.claim.findMany({
    where: { status: 'billed' },
    select: { id: true },
  });
  if (!stuck.length) {
    console.log('No claims stuck at status="billed". Nothing to do.');
    return;
  }
  const stuckIds = stuck.map(c => c.id);

  const lines = await prisma.invoiceLineItem.findMany({
    where: {
      claimId: { in: stuckIds },
      lineType: 'claim_tpa_desk',
      invoice: { status: { in: ['issued', 'partially_paid', 'paid'] } },
    },
    select: { claimId: true, meta: true, invoice: { select: { issuedAt: true, createdAt: true } } },
  });
  lines.sort((a, b) => {
    const ta = new Date(a.invoice?.issuedAt || a.invoice?.createdAt || 0).getTime();
    const tb = new Date(b.invoice?.issuedAt || b.invoice?.createdAt || 0).getTime();
    return ta - tb;
  });
  const priorByClaim = new Map();
  for (const line of lines) {
    const prior = line.meta?.priorStatus;
    if (prior && prior !== 'billed') priorByClaim.set(line.claimId, prior);
  }

  const buckets = new Map();
  let fallback = 0;
  for (const id of stuckIds) {
    const prior = priorByClaim.get(id);
    if (prior) {
      if (!buckets.has(prior)) buckets.set(prior, []);
      buckets.get(prior).push(id);
    } else {
      if (!buckets.has('settled')) buckets.set('settled', []);
      buckets.get('settled').push(id);
      fallback++;
    }
  }

  console.log(`Scanned ${stuckIds.length} stuck claims. Restore plan:`);
  for (const [status, ids] of buckets) console.log(`  → ${status}: ${ids.length}`);
  console.log(`  (fallback to 'settled' because no meta.priorStatus: ${fallback})`);

  if (!APPLY) {
    console.log('\nDry run — pass --apply to write changes.');
    return;
  }

  let restored = 0;
  await prisma.$transaction(async (tx) => {
    for (const [status, ids] of buckets) {
      if (!ids.length) continue;
      const r = await tx.claim.updateMany({ where: { id: { in: ids } }, data: { status } });
      restored += r.count;
    }
  });
  console.log(`\n✓ Restored ${restored} claims.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
