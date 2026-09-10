// Indian numbering: lakhs, crores. Pure utility, no deps.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const twoDigit = (n) => {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return TENS[t] + (o ? ' ' + ONES[o] : '');
};

const threeDigit = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts = [];
  if (h) parts.push(ONES[h] + ' Hundred');
  if (rest) parts.push(twoDigit(rest));
  return parts.join(' ');
};

const amountInWords = (amount) => {
  const val = Number(amount) || 0;
  const negative = val < 0;
  const abs = Math.abs(val);
  let n = Math.floor(abs);
  let paise = Math.round((abs - n) * 100);
  if (paise === 100) { n += 1; paise = 0; } // rounding carried into rupees
  if (n === 0 && paise === 0) return 'Zero Rupees only';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000);    n %= 100000;
  const thousand = Math.floor(n / 1000);  n %= 1000;
  const rest = n;
  const parts = [];
  if (crore)    parts.push(threeDigit(crore) + ' Crore');
  if (lakh)     parts.push(threeDigit(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigit(thousand) + ' Thousand');
  if (rest)     parts.push(threeDigit(rest));
  const rupeeWords = parts.join(' ').trim();
  let out = negative ? 'Minus ' : '';
  if (rupeeWords) out += rupeeWords + ' Rupees';
  if (paise > 0) out += (rupeeWords ? ' and ' : '') + twoDigit(paise) + ' Paise';
  return out + ' only';
};

module.exports = amountInWords;
