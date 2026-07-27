// `claimType` (optional) restricts which services apply: each service carries
// `claimTypes` (resolved from the billing-service-name master). A service only
// counts when its claimTypes is empty (universal) or includes the claim's type.
// Without a claimType argument, no filtering happens (legacy callers unchanged).
const calculateFilePrice = (billingServices = [], hospitalFinalBill = 0, finalApprovalAmount = 0, claimType = null) => {
  let total = 0;
  for (const svc of billingServices) {
    if (!svc.isActive) continue;
    if (svc.billingType === 'fixed_onetime' || svc.billingType === 'fixed_monthly') continue;
    // Skip services that don't apply to this claim's type. Empty/absent
    // claimTypes = universal (applies to every claim type).
    const svcClaimTypes = Array.isArray(svc.claimTypes) ? svc.claimTypes : [];
    if (claimType && svcClaimTypes.length && !svcClaimTypes.includes(claimType)) continue;
    const validBases = ['hospital_final_bill', 'final_approval'];
    if (!validBases.includes(svc.calculationBasis)) continue;
    const basis = svc.calculationBasis === 'hospital_final_bill' ? hospitalFinalBill : finalApprovalAmount;
    // Skip when the basis is unset / zero. Previously a hospitalFinalBill of
    // 0 still matched the first `rangeStart: 0` slab and picked up its price,
    // so rejected / mid-flight claims with no bill entered came out at ₹1,500
    // instead of ₹0. Operator wants a manual override in that case, not an
    // auto slab match.
    if (!basis || basis <= 0) continue;
    if (svc.billingType === 'per_claim_slab') {
      const mode = svc.slabMode || 'slab_wise';
      const slabs = [...(svc.slabs || [])].sort((a, b) => a.rangeStart - b.rangeStart);
      const matchingSlab = slabs.find(s => basis >= s.rangeStart && (s.rangeEnd === 0 || basis <= s.rangeEnd));
      if (matchingSlab) {
        total += matchingSlab.price;
      } else if (mode === 'both' && svc.slabIncrementRange > 0 && svc.slabIncrementPrice > 0) {
        const lastSlab = slabs[slabs.length - 1];
        if (lastSlab) {
          const above = Math.max(0, basis - lastSlab.rangeEnd);
          const increments = Math.ceil(above / svc.slabIncrementRange);
          total += lastSlab.price + increments * svc.slabIncrementPrice;
        }
      }
    } else if (svc.billingType === 'percentage') {
      total += Math.round(basis * (svc.percentageRate || 0) / 100);
    }
  }
  return Math.round(total);
};

module.exports = calculateFilePrice;
