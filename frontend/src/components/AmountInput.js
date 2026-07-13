import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatINRWords } from '../utils/format';

// Formats a raw numeric string with Indian digit grouping while preserving
// mid-entry states a number can't represent ("-", ".", "1.") so decimals /
// negatives feel natural to type.
const formatIndian = (raw) => {
  if (raw === '' || raw == null) return '';
  let s = String(raw);
  if (s === '-' || s === '.' || s === '-.') return s;
  const negative = s.startsWith('-');
  if (negative) s = s.slice(1);
  const hasDot = s.includes('.');
  const [intPart, decPart = ''] = s.split('.');
  const cleanInt = intPart.replace(/\D/g, '');
  const intFmt = cleanInt ? Number(cleanInt).toLocaleString('en-IN') : (hasDot ? '0' : '');
  const sign = negative ? '-' : '';
  return hasDot ? `${sign}${intFmt}.${decPart}` : `${sign}${intFmt}`;
};

const sanitize = (str, allowDecimal, allowNegative) => {
  if (!str) return '';
  const strip = allowDecimal
    ? (allowNegative ? /[^\d.-]/g : /[^\d.]/g)
    : (allowNegative ? /[^\d-]/g : /\D/g);
  let s = String(str).replace(strip, '');
  if (allowNegative) {
    const wasNeg = s.startsWith('-');
    s = s.replace(/-/g, '');
    if (wasNeg) s = '-' + s;
  }
  if (allowDecimal) {
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  }
  // "007" → "7" but keep "0" and "0.5"
  s = s.replace(/^(-?)0+(?=\d)/, '$1');
  return s;
};

const rawToNumber = (raw, allowDecimal) => {
  if (!raw || raw === '-' || raw === '.' || raw === '-.') return 0;
  const n = allowDecimal ? parseFloat(raw) : parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
};

// Convert a parent-provided value (number/string/null) back to the raw string
// used for display. Zero renders as empty so the placeholder shows through.
const valueToRaw = (val) => {
  if (val === '' || val == null) return '';
  const n = Number(val);
  if (!Number.isFinite(n) || n === 0) return '';
  return String(n);
};

const AmountInput = ({
  value,
  onChange,
  className = '',
  placeholder = '0',
  allowDecimal = false,
  allowNegative = false,
  showWords = true,
}) => {
  const inputRef = useRef(null);
  const caretFromRight = useRef(null);
  const [rawStr, setRawStr] = useState(() => valueToRaw(value));

  // Resync local text when the parent value diverges from our numeric
  // interpretation (e.g. an auto-computed field like Final Approval Amount
  // that changes in response to sibling fields). Comparing via numbers
  // means our own onChange won't wipe out mid-entry states like "1." or "-".
  useEffect(() => {
    const currentNum = rawToNumber(rawStr, allowDecimal);
    const propNum = Number(value) || 0;
    if (currentNum !== propNum) {
      setRawStr(valueToRaw(value));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const display = formatIndian(rawStr);

  // After React commits a new formatted value, put the caret back at the same
  // offset from the right. Typing at the end feels natural (caret stays put
  // when a comma is inserted); mid-string edits stay reasonably stable.
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
    const clean = sanitize(el.value, allowDecimal, allowNegative);
    setRawStr(clean);
    onChange(rawToNumber(clean, allowDecimal));
  };

  const num = Number(value) || 0;
  const words = showWords ? formatINRWords(Math.abs(num)) : '';

  return (
    <div>
      <input
        ref={inputRef}
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        value={display}
        placeholder={placeholder}
        className={className}
        onChange={handleChange}
      />
      {words && <p className="text-xs text-gray-400 mt-0.5">{num < 0 ? '−' : ''}{words}</p>}
    </div>
  );
};

export default AmountInput;
