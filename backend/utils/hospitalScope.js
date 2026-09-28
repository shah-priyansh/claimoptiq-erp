const prisma = require('../config/prisma');

const getUserHospitalId = (user) => {
  return user.hospitalId || user.hospital?.id || null;
};

// Hospital IDs owned by a reference-scoped user's reference — matched by the
// referenceId FK OR the denormalised free-text `referenceBy` name (case-
// insensitive), since only ~1/4 of hospitals carry the FK. Returns [] when the
// reference owns no hospitals (so the user correctly sees nothing).
const getReferenceHospitalIds = async (user) => {
  const or = [{ referenceId: user.referenceId }];
  if (user.reference?.name) or.push({ referenceBy: { equals: user.reference.name, mode: 'insensitive' } });
  const hospitals = await prisma.hospital.findMany({ where: { OR: or }, select: { id: true } });
  return hospitals.map((h) => h.id);
};

// A hospital user is normally scoped to their own hospital's records. A Hospital
// *Admin* whose hospital is a *parent* additionally sees every branch's records,
// so their effective view scope is [ownId, ...branchIds]. Everyone else
// (hospital staff, or an admin of a hospital with no branches) stays limited to
// their own hospital. A reference-scoped login (User.referenceId set) is
// limited to the hospitals belonging to their reference and takes precedence —
// a reference user has no single hospitalId. Returns an array of hospital IDs,
// or null for non-hospital/non-reference users (super admin / office) who
// aren't scoped at all. Used for READ paths only — create/import/delete-all
// and per-record write guards keep the exact single-hospital rule.
const getUserHospitalScope = async (user) => {
  if (user?.referenceId) return getReferenceHospitalIds(user);
  const hospitalId = getUserHospitalId(user);
  if (!hospitalId) return null;
  if (user.role?.slug !== 'hospital_admin') return [hospitalId];
  const branches = await prisma.hospital.findMany({
    where: { parentHospitalId: hospitalId },
    select: { id: true },
  });
  return branches.length ? [hospitalId, ...branches.map((b) => b.id)] : [hospitalId];
};

module.exports = { getUserHospitalId, getReferenceHospitalIds, getUserHospitalScope };
