import React, { useRef } from 'react';
import { HiOutlineCalendar } from 'react-icons/hi';

const DateInput = ({ value, onChange, name, required, min, max, type = 'date', className, ...props }) => {
  const ref = useRef(null);

  const open = () => {
    try { ref.current?.showPicker(); } catch {}
  };

  return (
    <div className="relative cursor-pointer" onClick={open}>
      <HiOutlineCalendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
      <input
        ref={ref}
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        min={min}
        max={max}
        className={`w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer ${className || ''}`}
        {...props}
      />
    </div>
  );
};

export default DateInput;
