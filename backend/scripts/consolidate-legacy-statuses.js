// Consolidates the legacy generic claim statuses into the granular master.
//
// The old workflow wrote generic slugs (discharged / submitted / rejected).
// Those are now redundant with the granular statuses, so this script:
//   1. Rewrites claim.status and claim_status_history.status onto the granular
//      slugs (see MAPPING below).
//   2. Also fixes malformed space-slug values ("discharge approved" /
//      "pre-auth approved") left behind by an old import bug.
//   3. Deletes the three legacy rows (discharged / submitted / rejected) from
//      the claim_statuses master.
//
// Safe to run against production and idempotent: updateMany/deleteMany are
// no-ops once the data has already been migrated. Data is migrated BEFORE the
// master rows are deleted, so no claim ever points at a missing slug.
//
// Usage:
//   node backend/scripts/consolidate-legacy-statuses.js

const prisma = require('../config/prisma');

// old status value → granular slug it should become
const MAPPING = {
  discharged: 'discharged_submitted',
  submitted: 'file_submitted',
  rejected: 'claim_rejected',
  // malformed leftovers from the old import bug (label stored with spaces)
  'discharge approved': 'discharge_approved',
  'pre-auth approved': 'pre_auth_approved',
};

// legacy master rows to remove (these were real claim_statuses entries)
const LEGACY_SLUGS = ['discharged', 'submitted', 'rejected'];

async function main() {
  // ── Safety: every target slug must exist in the master ────────────────
  const targets = [...new Set(Object.values(MAPPING))];
  const present = await prisma.claimStatus.findMany({
    where: { slug: { in: targets } },
    select: { slug: true },
  });
  const presentSet = new Set(present.map(s => s.slug));
  const missing = targets.filter(t => !presentSet.has(t));
  if (missing.length) {
    throw new Error(`Aborting — target status slug(s) missing from master: ${missing.join(', ')}`);
  }

  // ── Before snapshot ───────────────────────────────────────────────────
  const fromValues = Object.keys(MAPPING);
  const beforeClaims = await prisma.claim.groupBy({
    by: ['status'], where: { status: { in: fromValues } }, _count: { id: true },
  });
  const beforeHistory = await prisma.claimStatusHistory.groupBy({
    by: ['status'], where: { status: { in: fromValues } }, _count: { id: true },
  });
  console.log('Before — claim.status:', JSON.stringify(beforeClaims.map(r => ({ [r.status]: r._count.id }))));
  console.log('Before — history.status:', JSON.stringify(beforeHistory.map(r => ({ [r.status]: r._count.id }))));

  // ── Migrate data (claims + history) ───────────────────────────────────
  let claimsMoved = 0;
  let historyMoved = 0;
  for (const [from, to] of Object.entries(MAPPING)) {
    const c = await prisma.claim.updateMany({ where: { status: from }, data: { status: to } });
    const h = await prisma.claimStatusHistory.updateMany({ where: { status: from }, data: { status: to } });
    if (c.count || h.count) console.log(`  ${from} → ${to}: ${c.count} claim(s), ${h.count} history row(s)`);
    claimsMoved += c.count;
    historyMoved += h.count;
  }

  // ── Delete legacy master rows ─────────────────────────────────────────
  const del = await prisma.claimStatus.deleteMany({ where: { slug: { in: LEGACY_SLUGS } } });

  console.log(`\n✓ Consolidated ${claimsMoved} claim(s) and ${historyMoved} history row(s); removed ${del.count} legacy status row(s).`);

  // ── After verification ────────────────────────────────────────────────
  const leftoverClaims = await prisma.claim.count({ where: { status: { in: fromValues } } });
  const leftoverStatuses = await prisma.claimStatus.count({ where: { slug: { in: LEGACY_SLUGS } } });
  console.log(`After — claims still on old values: ${leftoverClaims}; legacy master rows remaining: ${leftoverStatuses}`);
  if (leftoverClaims !== 0 || leftoverStatuses !== 0) {
    throw new Error('Post-migration check failed — some legacy data/rows remain.');
  }
}

main()
  .then(() => console.log('Done.'))
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
