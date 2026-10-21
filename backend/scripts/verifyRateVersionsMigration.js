// Run: node backend/scripts/verifyRateVersionsMigration.js
//
// Read-only verification for the 20261021120000_hospital_rate_versions
// migration (Task 1 of the hospital-rate-versions feature). Asserts:
//   (a) every hospital has exactly one base version (effectiveFromMonth === null)
//   (b) hospital_billing_services with NULL rateVersionId count === 0
//   (c) every service's rateVersionId resolves to its own hospital's base version
//
// Does not write anything — findMany/count/groupBy only.
require('dotenv').config();
const prisma = require('../config/prisma');

let failures = 0;

function check(label, pass, detail) {
  if (pass) {
    console.log(`✔ ${label}`);
  } else {
    failures += 1;
    console.log(`✗ FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

(async () => {
  // (a) Every hospital has exactly one base version.
  const hospitals = await prisma.hospital.findMany({ select: { id: true } });
  const baseVersions = await prisma.hospitalRateVersion.findMany({
    where: { effectiveFromMonth: null },
    select: { id: true, hospitalId: true },
  });

  const baseCountByHospital = new Map();
  for (const v of baseVersions) {
    baseCountByHospital.set(v.hospitalId, (baseCountByHospital.get(v.hospitalId) || 0) + 1);
  }

  const missingBase = hospitals.filter((h) => !baseCountByHospital.has(h.id));
  const multipleBase = [...baseCountByHospital.entries()].filter(([, count]) => count > 1);

  check(
    `every hospital (${hospitals.length}) has exactly one base rate version`,
    missingBase.length === 0 && multipleBase.length === 0,
    `missing=${missingBase.length} duplicated=${multipleBase.length}`
  );

  // Any base version whose hospital no longer exists would also be a problem,
  // though the FK (ON DELETE CASCADE) should make this impossible.
  const hospitalIds = new Set(hospitals.map((h) => h.id));
  const orphanBase = baseVersions.filter((v) => !hospitalIds.has(v.hospitalId));
  check('no base version references a non-existent hospital', orphanBase.length === 0, `orphans=${orphanBase.length}`);

  // (b) No hospital_billing_services row has a NULL rate_version_id.
  // rateVersionId is now a required (NOT NULL) column, so a direct count
  // via Prisma can't express "IS NULL" on a non-nullable field — use raw SQL,
  // which is still read-only.
  const nullRows = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM "hospital_billing_services" WHERE "rate_version_id" IS NULL`;
  const nullCount = Number(nullRows[0]?.count ?? 0);
  check('hospital_billing_services rows with NULL rate_version_id', nullCount === 0, `count=${nullCount}`);

  // (c) Every service's rateVersionId resolves to its own hospital's base version.
  const services = await prisma.hospitalBillingService.findMany({
    select: {
      id: true,
      hospitalId: true,
      rateVersionId: true,
      rateVersion: { select: { id: true, hospitalId: true, effectiveFromMonth: true } },
    },
  });

  const mismatched = services.filter((s) => {
    const v = s.rateVersion;
    return !v || v.hospitalId !== s.hospitalId || v.effectiveFromMonth !== null;
  });

  check(
    `every billing service (${services.length}) resolves to its own hospital's base version`,
    mismatched.length === 0,
    mismatched.length
      ? `mismatched=${mismatched.length} e.g. service ${mismatched[0].id}`
      : undefined
  );

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
