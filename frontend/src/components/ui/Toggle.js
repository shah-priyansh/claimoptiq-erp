import React from 'react';

const Toggle = ({ checked, onChange, disabled = false, loading = false, size = 'md' }) => {
  const sizes = {
    sm: { track: 'w-9 h-5',  dot: 'w-3.5 h-3.5', spinner: 'w-2 h-2',     on: 'translate-x-4', off: 'translate-x-0.5' },
    md: { track: 'w-11 h-6', dot: 'w-5 h-5',      spinner: 'w-2.5 h-2.5', on: 'translate-x-5', off: 'translate-x-0'   },
  };
  const s = sizes[size] || sizes.md;
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={loading}
      onClick={() => !isDisabled && onChange(!checked)}
      disabled={isDisabled}
      className={`
        relative inline-flex flex-shrink-0 ${s.track} rounded-full border-2 border-transparent
        transition-all duration-200 ease-in-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2
        ${checked ? 'bg-primary-600' : 'bg-gray-300'}
        ${loading ? 'opacity-75 cursor-wait' : disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:opacity-90 active:scale-95'}
      `}
    >
      <span
        className={`
          pointer-events-none inline-flex items-center justify-center ${s.dot} rounded-full bg-white
          shadow-[0_2px_4px_rgba(0,0,0,0.25),0_1px_2px_rgba(0,0,0,0.12)]
          transition-transform duration-200 ease-in-out
          ${checked ? s.on : s.off}
        `}
      >
        {loading && (
          <span className={`${s.spinner} rounded-full border-2 border-gray-200 border-t-gray-500 animate-spin`} />
        )}
      </span>
    </button>
  );
};

export default Toggle;
