// Pure resolver that picks the hospital rate version in effect for a claim's
// billing month, and computes the claim's file price through it.
//
// Why monthKeyNum exists: bulk-imported claims store `Claim.month` as
// IST-local midnight of the 1st (e.g. new Date(2026,10,1) when run in an
// IST process), which in UTC is the PRIOR day ~18:30. A naive UTC year/month
// comparison against a DB-stored `effectiveFromMonth` of
// `2026-11-01T00:00:00Z` would therefore read the imported claim as October,
// off by one month. Converting both sides into "IST calendar month" before
// comparing fixes that: add 330 minutes (5h30m) to shift into IST, then read
// the UTC getters off the shifted instant.
const calculateFilePrice = require('./calculateFilePrice');

const IST_OFFSET_MINUTES = 5 * 60 + 30;

const monthKeyNum = (date) => {
  const shifted = new Date(date.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
  return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
};

const resolveRateVersion = (versions = [], claimMonth) => {
  const base = versions.find(v => v.effectiveFromMonth == null);
  if (claimMonth == null) return base ? base.billingServices : [];

  const claimKey = monthKeyNum(claimMonth);
  let best = null;
  let bestKey = -Infinity;
  for (const v of versions) {
    if (v.effectiveFromMonth == null) continue;
    const key = monthKeyNum(v.effectiveFromMonth);
    if (key <= claimKey && key > bestKey) {
      best = v;
      bestKey = key;
    }
  }
  if (best) return best.billingServices;
  if (base) return base.billingServices;
  return [];
};

const resolveClaimFilePrice = (claim, versionsByHospital = {}) => {
  if (claim.filePriceOverridden && claim.filePrice) return claim.filePrice;
  const versions = versionsByHospital[claim.hospitalId] || [];
  const billingServices = resolveRateVersion(versions, claim.month);
  return calculateFilePrice(
    billingServices,
    claim.hospitalFinalBill || 0,
    claim.finalApprovalAmount || 0,
    claim.claimType,
    claim.settlementAmount || 0,
  );
};

module.exports = { monthKeyNum, resolveRateVersion, resolveClaimFilePrice };
