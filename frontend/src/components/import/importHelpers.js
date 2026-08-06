// Shared helpers for the transactional bulk-import modal + entity configs.

export const norm = (s) => String(s || '').trim().toLowerCase();

// Parse a numeric cell, stripping thousands commas. Returns null for blank,
// NaN for non-numeric, else the number.
export const cleanNum = (v) => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// Loose date parse mirroring the backend importers so the preview is honest.
// Accepts YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, and Excel serials.
export const parseDateLoose = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== +m[2] - 1) ? null : d;
  }
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    let day = +a, month = +b;
    if (month > 12 && day <= 12) { const t = day; day = month; month = t; }
    if (!day || !month || day > 31 || month > 12) return null;
    const d = new Date(Date.UTC(+yy, month - 1, day));
    return (isNaN(d.getTime()) || d.getUTCMonth() !== month - 1) ? null : d;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

// Excel date-formatted cells arrive as JS Date objects (XLSX.read cellDates).
// Coerce to YYYY-MM-DD so the day the operator saw in Excel is preserved.
export const dateCellToIso = (v) => {
  if (v instanceof Date && !isNaN(v.getTime())) {
    const midnight = new Date(Math.round(v.getTime() / 86400000) * 86400000);
    const y = midnight.getUTCFullYear();
    const m = String(midnight.getUTCMonth() + 1).padStart(2, '0');
    const d = String(midnight.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v;
};

// Badge colors for the per-row issue chips, keyed by issue `type`.
export const ISSUE_COLORS = {
  date: 'bg-orange-100 text-orange-700',
  amount: 'bg-rose-100 text-rose-700',
  category: 'bg-emerald-100 text-emerald-700',
  reference: 'bg-indigo-100 text-indigo-700',
  direction: 'bg-amber-100 text-amber-700',
  mode: 'bg-blue-100 text-blue-700',
  bank: 'bg-indigo-100 text-indigo-700',
  type: 'bg-amber-100 text-amber-700',
  hospital: 'bg-emerald-100 text-emerald-700',
  month: 'bg-orange-100 text-orange-700',
  status: 'bg-cyan-100 text-cyan-700',
};
