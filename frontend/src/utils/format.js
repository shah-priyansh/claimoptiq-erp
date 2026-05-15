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

export const formatINRWords = (amount) => {
  const num = Number(amount) || 0;
  if (num === 0) return '';
  if (num >= 1_00_00_000) {
    const v = (num / 1_00_00_000).toFixed(2).replace(/\.?0+$/, '');
    return `${v} Crore`;
  }
  if (num >= 1_00_000) {
    const v = (num / 1_00_000).toFixed(2).replace(/\.?0+$/, '');
    return `${v} Lakh`;
  }
  if (num >= 1_000) {
    const v = (num / 1_000).toFixed(2).replace(/\.?0+$/, '');
    return `${v} Thousand`;
  }
  return '';
};
