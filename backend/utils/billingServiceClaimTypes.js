const prisma = require('../config/prisma');

// The claim-type applicability of a billing service lives on the
// BillingServiceName master (keyed by name), not on the per-hospital
// HospitalBillingService row. These helpers resolve that mapping so the
// file-price calc can skip services that don't apply to a claim's type.

// Returns { [serviceName]: string[] } from the billing-service-name master.
const loadServiceClaimTypesMap = async () => {
  const names = await prisma.billingServiceName.findMany({
    select: { name: true, claimTypes: true },
  });
  const map = {};
  for (const n of names) {
    map[n.name] = Array.isArray(n.claimTypes) ? n.claimTypes : [];
  }
  return map;
};

// Returns a copy of `services` with each service's `claimTypes` populated from
// the master map. Unknown names default to [] (universal — applies to all types).
const attachClaimTypes = (services, map = {}) =>
  (services || []).map((s) => ({ ...s, claimTypes: map[s.serviceName] || [] }));

module.exports = { loadServiceClaimTypesMap, attachClaimTypes };
