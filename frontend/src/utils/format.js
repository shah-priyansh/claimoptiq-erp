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
