export const formatINR = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN').format(num);
};

export const formatCurrency = (amount) => `Rs ${formatINR(amount)}`;

export const formatCurrencyCompact = (amount) => {
  const num = Number(amount) || 0;
  if (num >= 1_00_00_000) return `Rs ${(num / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '')} Cr`;
  if (num >= 1_00_000) return `Rs ${(num / 1_00_000).toFixed(2).replace(/\.?0+$/, '')} L`;
  return `Rs ${formatINR(num)}`;
};

const _ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const _tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const _twoDigits = (n) => n < 20 ? _ones[n] : _tens[Math.floor(n / 10)] + (n % 10 ? ' ' + _ones[n % 10] : '');
const _threeDigits = (n) => n >= 100
  ? _ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + _twoDigits(n % 100) : '')
  : _twoDigits(n);

export const calculateFilePrice = (billingServices = [], hospitalFinalBill = 0, finalApprovalAmount = 0) => {
  let total = 0;
  for (const svc of billingServices) {
    if (!svc.isActive) continue;
    // fixed_onetime = one-time hospital charge (empanelment etc.), not per-claim
    // fixed_monthly = monthly flat fee, not per-claim
    if (svc.billingType === 'fixed_onetime' || svc.billingType === 'fixed_monthly') continue;
    // per_claim_slab and percentage require a valid calculationBasis
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
        // Amount exceeds last slab — use last slab's price + incremental above its rangeEnd
        const lastSlab = slabs[slabs.length - 1];
        if (lastSlab) {
          const above = Math.max(0, basis - lastSlab.rangeEnd);
          const increments = Math.floor(above / svc.slabIncrementRange);
          total += lastSlab.price + increments * svc.slabIncrementPrice;
        }
      }
    } else if (svc.billingType === 'percentage') {
      total += Math.round(basis * (svc.percentageRate || 0) / 100);
    }
  }
  return Math.round(total);
};

export const formatINRWords = (amount) => {
  const num = Math.floor(Number(amount) || 0);
  if (num === 0) return '';
  const parts = [];
  let rem = num;
  if (rem >= 1_00_00_000) { parts.push(_threeDigits(Math.floor(rem / 1_00_00_000)) + ' Crore'); rem %= 1_00_00_000; }
  if (rem >= 1_00_000)    { parts.push(_threeDigits(Math.floor(rem / 1_00_000))    + ' Lakh');  rem %= 1_00_000; }
  if (rem >= 1_000)       { parts.push(_threeDigits(Math.floor(rem / 1_000))       + ' Thousand'); rem %= 1_000; }
  if (rem > 0)            { parts.push(_threeDigits(rem)); }
  return parts.join(' ');
};
