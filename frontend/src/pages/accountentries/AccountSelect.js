import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HiOutlineSearch, HiCheck, HiSelector } from 'react-icons/hi';

const formatINR = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const optValue = (a) => `${a.kind}:${a.id ?? ''}`;

// Searchable, grouped account picker for Journal Entry lines. Renders the
// dropdown panel in a body portal (fixed positioning) so the modal's
// overflow-hidden table doesn't clip it. Each row shows the account's Cur Bal.
const AccountSelect = ({ groups = [], value, onChange, placeholder = 'Select A/C' }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(() => {
    if (!value) return null;
    for (const g of groups) for (const a of g.accounts) if (optValue(a) === value) return a;
    return null;
  }, [groups, value]);

  const position = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const spaceAbove = r.top;
    const openUp = spaceBelow < 260 && spaceAbove > spaceBelow;
    const avail = (openUp ? spaceAbove : spaceBelow) - 16;
    setCoords({
      left: r.left,
      width: r.width,
      top: openUp ? undefined : r.bottom + 4,
      bottom: openUp ? window.innerHeight - r.top + 4 : undefined,
      listMax: Math.max(140, Math.min(300, avail - 56)),
    });
  };

  useLayoutEffect(() => { if (open) position(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    const inside = (target) => panelRef.current?.contains(target) || triggerRef.current?.contains(target);
    const onDown = (e) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = (e) => { if (!panelRef.current?.contains(e.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return groups
      .map((g) => ({ ...g, accounts: q ? g.accounts.filter((a) => a.name.toLowerCase().includes(q)) : g.accounts }))
      .filter((g) => g.accounts.length);
  }, [groups, query]);

  const pick = (a) => { onChange(optValue(a)); setOpen(false); setQuery(''); };

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 px-2.5 py-1.5 border rounded-lg text-sm bg-white text-left transition-colors ${open ? 'border-primary-500 ring-2 ring-primary-500/30' : 'border-gray-300 hover:border-gray-400'}`}
      >
        <span className={`truncate ${selected ? 'text-gray-800' : 'text-gray-400'}`}>{selected ? selected.name : placeholder}</span>
        <HiSelector className="w-4 h-4 text-gray-400 shrink-0" />
      </button>

      {open && coords && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', left: coords.left, width: coords.width, top: coords.top, bottom: coords.bottom, zIndex: 60 }}
          className="bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col"
        >
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <HiOutlineSearch className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search account…"
                className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: coords.listMax }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">No matching account</p>
            ) : filtered.map((g) => (
              <div key={g.key}>
                <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 bg-gray-50 sticky top-0">{g.label}</p>
                {g.accounts.map((a) => {
                  const v = optValue(a);
                  const isSel = v === value;
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => pick(a)}
                      className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${isSel ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <HiCheck className={`w-4 h-4 shrink-0 ${isSel ? 'text-primary-600' : 'text-transparent'}`} />
                        <span className={`truncate text-sm ${isSel ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>{a.name}</span>
                      </span>
                      <span className="text-xs text-gray-400 whitespace-nowrap shrink-0">{formatINR(a.balance)} {a.side}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default AccountSelect;
