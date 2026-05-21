const calculateFilePrice = (billingServices = [], hospitalFinalBill = 0, finalApprovalAmount = 0) => {
  let total = 0;
  for (const svc of billingServices) {
    if (!svc.isActive) continue;
    if (svc.billingType === 'fixed_onetime' || svc.billingType === 'fixed_monthly') continue;
    const validBases = ['hospital_final_bill', 'final_approval'];
    if (!validBases.includes(svc.calculationBasis)) continue;
    const basis = svc.calculationBasis === 'hospital_final_bill' ? hospitalFinalBill : finalApprovalAmount;
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
