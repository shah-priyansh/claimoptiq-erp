import React from 'react';

// Shared, theme-matching loader used for page/section data-loading states across
// the app so they all look identical. In-button action spinners (Saving…,
// Downloading…) stay local — they use `border-current` to match the button's
// own text colour and would look wrong forced to the primary theme.

const SIZES = {
  xs: 'w-4 h-4 border-2',
  sm: 'w-5 h-5 border-2',
  md: 'w-7 h-7 border-2',
  lg: 'w-10 h-10 border-[3px]',
};

// Raw themed ring: light primary track with a spinning primary-600 head.
export const Spinner = ({ size = 'md', className = '' }) => (
  <span
    role="status"
    aria-label="Loading"
    className={`inline-block flex-shrink-0 ${SIZES[size] || SIZES.md} border-primary-100 border-t-primary-600 rounded-full animate-spin ${className}`}
  />
);

// Centered loading block for page/section states. `inline` lays the spinner and
// label out side by side (for table rows); the default stacks them vertically.
const Loader = ({ label, size = 'md', inline = false, className = 'py-20' }) => (
  <div
    className={`flex text-gray-400 ${
      inline ? 'flex-row items-center gap-2' : 'flex-col items-center justify-center gap-3'
    } ${className}`}
  >
    <Spinner size={inline ? 'xs' : size} />
    {label && <p className="text-sm font-medium">{label}</p>}
  </div>
);

export default Loader;
