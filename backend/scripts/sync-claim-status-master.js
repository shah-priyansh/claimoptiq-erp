// Syncs the CLAIM STATUS MASTER (21 rows from CLAIM STATUS MASTER.xlsx) into
// the DB. Safe to run against production: touches nothing but the
// `claim_statuses` table, and upserts by slug so any custom statuses the
// operator added via the UI are preserved.
//
// The old generic slugs (discharged / submitted / rejected) were consolidated
// into discharged_submitted / file_submitted / claim_rejected and removed —
// see scripts/consolidate-legacy-statuses.js.
//
// Usage:
//   node backend/scripts/sync-claim-status-master.js

const prisma = require('../config/prisma');

const claimStatuses = [
  { slug: 'admitted',                       label: 'Patient Admitted',               color: 'blue',   order: 1,  isSystem: true },
  { slug: 'pre_auth_claim_under_process',   label: 'Pre-Auth Claim Under Process',   color: 'yellow', order: 2,  isSystem: true },
  { slug: 'query',                          label: 'Query',                          color: 'yellow', order: 3,  isSystem: true },
  { slug: 'pre_auth_approved',              label: 'Pre-auth Approved',              color: 'purple', order: 4,  isSystem: true },
  { slug: 'enhancement_submitted',          label: 'Enhancement Submitted',          color: 'indigo', order: 5,  isSystem: true },
  { slug: 'enhancement_under_process',      label: 'Enhancement Under Process',      color: 'yellow', order: 6,  isSystem: true },
  { slug: 'enhancement_approved',           label: 'Enhancement Approved',           color: 'purple', order: 7,  isSystem: true },
  { slug: 'discharged_submitted',           label: 'Discharged Submitted',           color: 'orange', order: 8,  isSystem: true },
  { slug: 'discharged_claim_under_process', label: 'Discharged Claim Under Process', color: 'yellow', order: 9,  isSystem: true },
  { slug: 'discharge_approved',             label: 'Discharge Approved',             color: 'purple', order: 10, isSystem: true },
  { slug: 'claim_rejected',                 label: 'Claim Rejected',                 color: 'red',    order: 11, isSystem: true },
  { slug: 'reconsider_claim_submitted',     label: 'Reconsider Claim Submitted',     color: 'pink',   order: 12, isSystem: true },
  { slug: 'reconsider_claim_under_process', label: 'Reconsider Claim Under Process', color: 'pink',   order: 13, isSystem: true },
  { slug: 'claim_online_submitted',         label: 'Claim Online Submitted',         color: 'indigo', order: 14, isSystem: true },
  { slug: 'file_pending',                   label: 'File Pending',                   color: 'gray',   order: 15, isSystem: true },
  { slug: 'file_received',                  label: 'File Received',                  color: 'purple', order: 16, isSystem: true },
  { slug: 'file_submitted',                 label: 'File Submitted',                 color: 'indigo', order: 17, isSystem: true },
  { slug: 'claim_settlement_under_process', label: 'Claim Settlement Under Process', color: 'yellow', order: 18, isSystem: true },
  { slug: 'claim_settlement_approved',      label: 'Claim Settlement Approved',      color: 'green',  order: 19, isSystem: true },
  { slug: 'settled',                        label: 'Claim Settled',                  color: 'green',  order: 20, isSystem: true },
  { slug: 'billed',                         label: 'FCC Billed',                     color: 'teal',   order: 21, isSystem: true, superAdminOnly: true },
];

async function main() {
  let created = 0;
  let updated = 0;
  for (const s of claimStatuses) {
    const existing = await prisma.claimStatus.findUnique({ where: { slug: s.slug } });
    await prisma.claimStatus.upsert({
      where: { slug: s.slug },
      update: {
        label: s.label,
        color: s.color,
        order: s.order,
        isSystem: true,
        superAdminOnly: s.superAdminOnly ?? false,
      },
      create: s,
    });
    if (existing) updated++; else created++;
  }
  console.log(`✓ Claim status master synced — ${created} created, ${updated} updated (total ${claimStatuses.length})`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
