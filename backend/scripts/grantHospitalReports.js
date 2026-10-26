// Idempotent: enable the Claim Settlement report (reports.view) + claim export
// (claims.export) for the hospital roles, so every hospital login gets them by
// default. Financial reports stay hard-blocked for hospital logins server-side.
// Safe to re-run. Run from backend/:  node scripts/grantHospitalReports.js
const prisma = require('../config/prisma');

(async () => {
  try {
    const slugs = ['hospital_admin', 'hospital_staff'];
    for (const slug of slugs) {
      const role = await prisma.role.findUnique({ where: { slug }, select: { id: true } });
      if (!role) { console.log(`skip: no role ${slug}`); continue; }

      const rep = await prisma.roleModulePermission.updateMany({
        where: { roleId: role.id, module: 'reports' }, data: { view: true },
      });
      if (rep.count === 0) {
        await prisma.roleModulePermission.create({
          data: { roleId: role.id, module: 'reports', view: true },
        });
      }
      await prisma.roleModulePermission.updateMany({
        where: { roleId: role.id, module: 'claims' }, data: { export: true },
      });
      console.log(`${slug}: reports.view=true, claims.export=true`);
    }

    // Verify
    const roles = await prisma.role.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, modulePermissions: { where: { module: { in: ['reports', 'claims'] } }, select: { module: true, view: true, export: true } } },
    });
    console.log('\nVerify:');
    roles.forEach((r) => r.modulePermissions.forEach((m) => console.log(`  ${r.slug}.${m.module}: view=${m.view} export=${m.export}`)));
  } catch (e) {
    console.error('FAIL:', e.message); process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
