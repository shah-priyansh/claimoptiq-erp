import React, { useLayoutEffect, useRef } from 'react';

// Formats a numeric string with Indian digit grouping (e.g. "1000000" → "10,00,000")
// while preserving a trailing decimal point or fractional digits so users can
// continue typing decimals mid-entry.
const formatIndian = (raw) => {
  if (raw === '' || raw === null || raw === undefined) return '';
  let s = String(raw);
  if (s === '-' || s === '.') return s;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const hasDot = s.includes('.');
  const [intPart, decPart = ''] = s.split('.');
  const cleanInt = intPart.replace(/\D/g, '');
  const intFmt = cleanInt ? Number(cleanInt).toLocaleString('en-IN') : (hasDot ? '0' : '');
  const sign = negative ? '-' : '';
  return hasDot ? `${sign}${intFmt}.${decPart.replace(/\D/g, '')}` : `${sign}${intFmt}`;
};

// Strips formatting characters (commas, spaces, ₹) so the parent state holds a
// clean numeric string like "1000000" that `Number()` / `Math.round()` accept.
const stripFormatting = (v) => String(v ?? '').replace(/[^\d.-]/g, '');

// Line-item amount input with live Indian-numbering (lakh/crore) formatting.
// Displays "10,00,000" while typing so operators can visually verify large
// values (a raw <input type="number"> made it too easy to miscount zeros and
// confuse 1 lakh with 10 lakh). Emits the stripped numeric string via
// `onChange(value)` so callers can drop it into state directly.
const AmountInput = ({ value, onChange, className = '', ...props }) => {
  const inputRef = useRef(null);
  const caretFromRight = useRef(null);
  const display = formatIndian(value);

  // After React commits the new formatted value, restore the caret at the same
  // offset from the right. This keeps typing-at-end natural (caret stays at
  // the end even when a comma gets inserted) and mid-string edits reasonably
  // stable.
  useLayoutEffect(() => {
    if (caretFromRight.current == null || !inputRef.current) return;
    const el = inputRef.current;
    const pos = Math.max(0, el.value.length - caretFromRight.current);
    el.setSelectionRange(pos, pos);
    caretFromRight.current = null;
  });

  const handleChange = (e) => {
    const el = e.target;
    const caret = el.selectionStart ?? el.value.length;
    caretFromRight.current = el.value.length - caret;
    onChange(stripFormatting(el.value));
  };

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={display}
      onChange={handleChange}
      className={className}
      {...props}
    />
  );
};

export default AmountInput;
