// Applies the DDL from migration 20260714104000_direct_patient_per_claim
// (drop old composite partial index, add regular-only partial index) plus a
// one-shot data sync: any direct-patient claim already referenced by a non-void
// invoice line item has isBilled flipped to true so the wizard no longer
// treats it as pending.
const prisma = require('../config/prisma');

async function main() {
  console.log('› Dropping old partial unique index (if present)…');
  await prisma.$executeRawUnsafe(
    `DROP INDEX IF EXISTS "invoices_hospital_id_month_is_direct_patient_not_void_key"`,
  );

  console.log('› Creating regular-only partial unique index…');
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "invoices_hospital_id_month_regular_not_void_key"
       ON "invoices" ("hospital_id", "month")
       WHERE "status" <> 'void' AND "is_direct_patient" = false`,
  );

  console.log('› Marking migration as applied in _prisma_migrations…');
  await prisma.$executeRawUnsafe(
    `INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
     SELECT gen_random_uuid()::text, 'manual-apply', NOW(), '20260714104000_direct_patient_per_claim', NULL, NULL, NOW(), 1
     WHERE NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE "migration_name" = '20260714104000_direct_patient_per_claim')`,
  );

  console.log('› Syncing isBilled for direct-patient claims referenced by live invoices…');
  const rows = await prisma.$queryRawUnsafe(`
    UPDATE claims c
       SET is_billed = true
     WHERE c.is_direct_patient = true
       AND c.is_billed = false
       AND EXISTS (
         SELECT 1 FROM invoice_line_items li
         JOIN invoices i ON i.id = li.invoice_id
         WHERE li.claim_id = c.id AND i.status <> 'void'
       )
    RETURNING c.id, c.patient_name;
  `);
  console.log(`  ✓ synced ${rows.length} claim(s):`);
  rows.forEach((r) => console.log(`    - ${r.patient_name} (${r.id})`));

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
