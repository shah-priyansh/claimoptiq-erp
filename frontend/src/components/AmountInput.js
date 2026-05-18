import React, { useState } from 'react';
import { formatINR, formatINRWords } from '../utils/format';

const AmountInput = ({ value, onChange, className, placeholder, allowDecimal = false, allowNegative = false }) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');

  const handleFocus = () => {
    setFocused(true);
    setRaw(value === 0 ? '' : String(value));
  };

  const handleChange = (e) => {
    let v = e.target.value;
    if (allowNegative) {
      // allow leading minus, then digits (and dot if decimal)
      v = v.replace(allowDecimal ? /[^0-9.\-]/g : /[^0-9\-]/g, '');
      // only one minus, only at start
      v = v.replace(/(?!^)-/g, '');
    } else {
      v = v.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, '');
    }
    setRaw(v);
  };

  const handleBlur = () => {
    setFocused(false);
    const parsed = allowDecimal ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0;
    onChange(parsed);
  };

  const words = formatINRWords(Math.abs(Number(value)));
  const displayValue = focused ? raw : (value < 0 ? `−${formatINR(Math.abs(value))}` : formatINR(value));

  return (
    <div>
      <input
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        value={displayValue}
        placeholder={placeholder || '0'}
        className={className}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {words && <p className="text-xs text-gray-400 mt-0.5">{value < 0 ? '−' : ''}{words}</p>}
    </div>
  );
};

export default AmountInput;
