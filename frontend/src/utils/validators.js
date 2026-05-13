// Indian mobile: 10 digits, starts with 6-9
export const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());

// Standard email
export const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());

// Indian pincode: exactly 6 digits, starts with 1-9
export const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

// Login identifier: email OR Indian mobile
export const isValidIdentifier = (v) => isValidEmail(v) || isValidPhone(v);

// Restrict phone input to digits only, max 10
export const onPhoneInput = (val) => val.replace(/\D/g, '').slice(0, 10);

// Reusable input class with error state
export const inputCls = (hasError = false) =>
  `w-full px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:outline-none transition-colors ${
    hasError
      ? 'border-red-400 focus:ring-red-200 focus:border-red-400'
      : 'border-gray-300 focus:ring-primary-500 focus:border-primary-500'
  }`;
