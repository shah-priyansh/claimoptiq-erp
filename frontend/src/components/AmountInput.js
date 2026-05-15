import React, { useState } from 'react';
import { formatINR, formatINRWords } from '../utils/format';

const AmountInput = ({ value, onChange, className, placeholder, allowDecimal = false }) => {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState('');

  const handleFocus = () => {
    setFocused(true);
    setRaw(value === 0 ? '' : String(value));
  };

  const handleChange = (e) => {
    const pattern = allowDecimal ? /[^0-9.]/g : /[^0-9]/g;
    const v = e.target.value.replace(pattern, '');
    setRaw(v);
  };

  const handleBlur = () => {
    setFocused(false);
    const parsed = allowDecimal ? parseFloat(raw) || 0 : parseInt(raw, 10) || 0;
    onChange(parsed);
  };

  const words = formatINRWords(value);

  return (
    <div>
      <input
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        value={focused ? raw : formatINR(value)}
        placeholder={placeholder || '0'}
        className={className}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleBlur}
      />
      {words && <p className="text-xs text-gray-400 mt-0.5">{words}</p>}
    </div>
  );
};

export default AmountInput;
