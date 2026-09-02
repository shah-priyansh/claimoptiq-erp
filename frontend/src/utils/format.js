export const formatINR = (amount) => {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
};

// All timestamps in the app render in IST regardless of the browser's
// timezone. FCC operates entirely from Surat, so a claim created at
// "12:32 IST" must read "12:32" for every user — a rep opening the app
// on a laptop set to UTC / EST would otherwise see a shifted time.
const IST_TZ = 'Asia/Kolkata';
const _istParts = (dt) => {
  // Intl parts give us the wall-clock values in the target zone without
  // manually adding a 5:30 offset (which breaks around DST boundaries in
  // other zones and around date rollovers).
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(dt);
  const out = {};
  for (const p of parts) if (p.type !== 'literal') out[p.type] = p.value;
  return out;
};

// Always returns DD/MM/YYYY (zero-padded) in IST. Locale-independent so
// machines with a non-Indian default locale still render the project
// standard. `dash` is shown for null/undefined/invalid input.
export const formatDate = (input, dash = '-') => {
  if (!input) return dash;
  const dt = input instanceof Date ? input : new Date(input);
  if (isNaN(dt.getTime())) return dash;
  const { day, month, year } = _istParts(dt);
  return `${day}/${month}/${year}`;
};

// DD/MM/YYYY HH:MM in IST — for timestamps where the time matters
// (audit rows etc.). Renders IST regardless of the browser's timezone.
export const formatDateTime = (input, dash = '-') => {
  if (!input) return dash;
  const dt = input instanceof Date ? input : new Date(input);
  if (isNaN(dt.getTime())) return dash;
  const { day, month, year, hour, minute } = _istParts(dt);
  // Intl's en-GB `hour: '2-digit', hour12: false` can render midnight as
  // "24" instead of "00" on some ICU builds — normalise defensively.
  const hh = hour === '24' ? '00' : hour;
  return `${day}/${month}/${year} ${hh}:${minute}`;
};

// Month label: `MMM-YYYY` (e.g. `Dec-2025`) — used by invoice month columns,
// summary headers, and Excel exports. Hardcoded abbreviations so output stays
// identical across locales / ICU builds (`toLocaleDateString` was returning
// the full date string on some setups).
const _monthAbbr = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const formatMonthLabel = (input, dash = '-') => {
  if (!input) return dash;
  const dt = input instanceof Date ? input : new Date(input);
  if (isNaN(dt.getTime())) return dash;
  return `${_monthAbbr[dt.getUTCMonth()]}-${dt.getUTCFullYear()}`;
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

// `claimType` (optional) restricts which services apply — each service carries
// `claimTypes` (from the billing-service-name master). A service only counts
// when its claimTypes is empty (universal) or includes the claim's type.
// Without a claimType argument, no filtering happens (legacy callers unchanged).
export const calculateFilePrice = (billingServices = [], hospitalFinalBill = 0, finalApprovalAmount = 0, claimType = null) => {
  let total = 0;
  for (const svc of billingServices) {
    if (!svc.isActive) continue;
    // fixed_onetime = one-time hospital charge (empanelment etc.), not per-claim
    // fixed_monthly = monthly flat fee, not per-claim
    if (svc.billingType === 'fixed_onetime' || svc.billingType === 'fixed_monthly') continue;
    // Skip services that don't apply to this claim's type (empty = universal).
    const svcClaimTypes = Array.isArray(svc.claimTypes) ? svc.claimTypes : [];
    if (claimType && svcClaimTypes.length && !svcClaimTypes.includes(claimType)) continue;
    // per_claim_slab and percentage require a valid calculationBasis
    const validBases = ['hospital_final_bill', 'final_approval'];
    if (!validBases.includes(svc.calculationBasis)) continue;
    const basis = svc.calculationBasis === 'hospital_final_bill' ? hospitalFinalBill : finalApprovalAmount;
    // Skip when the basis is unset / zero, matching backend calculateFilePrice.
    // Otherwise a 0 basis matches the first `rangeStart: 0` slab and auto-fills
    // a price (e.g. ₹1,000) for rejected / no-bill claims. Operator overrides
    // manually in that case.
    if (!basis || basis <= 0) continue;
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
