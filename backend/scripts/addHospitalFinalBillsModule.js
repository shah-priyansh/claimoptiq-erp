// Idempotently add the "hospital_final_bills" module permission row to every
// existing role in the live DB (the full seed is destructive). Safe to re-run.
// Initial view/edit values mirror each role's current `claims` permission so
// no one loses access to Hospital Final Bills the moment the routes switch
// from checkPermission('claims', ...) to checkPermission('hospital_final_bills', ...).
// From here on it's an independently editable permission on the Roles page.
const prisma = require('../config/prisma');

(async () => {
  try {
    const roles = await prisma.role.findMany({ include: { modulePermissions: true } });
    let created = 0;
    let skipped = 0;
    for (const role of roles) {
      const already = role.modulePermissions.find((m) => m.module === 'hospital_final_bills');
      if (already) { skipped++; continue; }
      const claimsPerm = role.modulePermissions.find((m) => m.module === 'claims');
      const view = claimsPerm?.view ?? false;
      const edit = claimsPerm?.edit ?? false;
      await prisma.roleModulePermission.create({
        data: { roleId: role.id, module: 'hospital_final_bills', view, edit },
      });
      created++;
      console.log(`  + ${role.name} (${role.slug}): view=${view}, edit=${edit}`);
    }
    console.log(`✅ hospital_final_bills module backfilled — ${created} created, ${skipped} already present.`);
  } catch (e) {
    console.error('ERR', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
