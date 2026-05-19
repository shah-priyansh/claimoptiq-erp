import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { HiChevronDown, HiSearch, HiCheck, HiX } from 'react-icons/hi';

const SearchableSelect = ({
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  required = false,
  disabled = false,
  isLoading = false,
  allowClear = false,
  noneLabel = null,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0, openUp: false });
  const triggerRef = useRef(null);
  const searchRef = useRef(null);
  const dropRef = useRef(null);

  const selected = options.find(o => o.value === value);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const open = () => {
    if (disabled) return;
    const r = triggerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < 280 && r.top > 280;
    setPos({ top: r.bottom + 4, left: r.left, width: r.width, openUp, bottom: window.innerHeight - r.top + 4 });
    setIsOpen(true);
    setSearch('');
    setTimeout(() => searchRef.current?.focus(), 30);
  };

  const select = (val) => {
    onChange(val);
    setIsOpen(false);
    setSearch('');
  };

  useEffect(() => {
    if (!isOpen) return;
    const onScroll = (e) => {
      if (dropRef.current && dropRef.current.contains(e.target)) return;
      setIsOpen(false);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [isOpen]);

  return (
    <>
      {required && (
        <select
          value={value || ''}
          onChange={() => {}}
          required
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', opacity: 0, width: 1, height: 1, overflow: 'hidden' }}
        >
          <option value="" />
          {options.map(o => <option key={o.value} value={o.value} />)}
        </select>
      )}

      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        disabled={disabled || isLoading}
        className={`w-full flex items-center gap-2 px-3 py-2.5 border rounded-lg text-sm bg-white text-left transition-all focus:outline-none ${
          isOpen
            ? 'border-primary-500 ring-2 ring-primary-100'
            : 'border-gray-300 hover:border-gray-400'
        } ${disabled || isLoading ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {isLoading ? (
          <>
            <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin flex-shrink-0" />
            <span className="flex-1 truncate text-gray-400">Loading...</span>
          </>
        ) : (
          <>
            {selected?.badgeClass ? (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold truncate ${selected.badgeClass}`}>{selected.label}</span>
            ) : (
              <span className={`flex-1 truncate ${selected ? 'text-gray-800' : 'text-gray-400'}`}>
                {selected ? selected.label : placeholder}
              </span>
            )}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {allowClear && selected && (
                <span
                  onClick={e => { e.stopPropagation(); onChange(''); }}
                  className="p-0.5 rounded text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-colors"
                >
                  <HiX className="w-3.5 h-3.5" />
                </span>
              )}
              <HiChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
            </div>
          </>
        )}
      </button>

      {isOpen && ReactDOM.createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
          <div
            ref={dropRef}
            style={
              pos.openUp
                ? { bottom: pos.bottom, left: pos.left, width: pos.width }
                : { top: pos.top, left: pos.left, width: pos.width }
            }
            className="fixed z-50 bg-white rounded-xl shadow-2xl shadow-black/10 border border-gray-100 overflow-hidden"
          >
            {/* Search bar */}
            <div className="p-2 border-b border-gray-100">
              <div className="relative">
                <HiSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="w-full pl-9 pr-3 py-2 text-sm bg-gray-50 border border-transparent rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Options list */}
            <div className="max-h-56 overflow-y-auto overscroll-contain">
              {noneLabel !== null && (
                <button
                  type="button"
                  onClick={() => select('')}
                  className={`w-full px-4 py-2.5 text-left text-sm flex items-center justify-between gap-2 transition-colors border-b border-gray-50 ${
                    !value ? 'text-primary-600 font-medium' : 'text-gray-400 hover:bg-gray-50'
                  }`}
                >
                  <span className="italic">{noneLabel}</span>
                  {!value && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                </button>
              )}

              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-gray-400">No results for "{search}"</p>
                </div>
              ) : (
                filtered.map(o => {
                  const isActive = o.value === value;
                  return (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => select(o.value)}
                      className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2 transition-colors ${
                        isActive ? 'bg-primary-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      {o.badgeClass ? (
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold truncate ${o.badgeClass}`}>{o.label}</span>
                      ) : (
                        <span className={`truncate ${isActive ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>{o.label}</span>
                      )}
                      {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>

            {filtered.length > 0 && (
              <div className="px-4 py-1.5 border-t border-gray-50 bg-gray-50/50">
                <p className="text-[10px] text-gray-400">{filtered.length} option{filtered.length !== 1 ? 's' : ''}</p>
              </div>
            )}
          </div>
        </>,
        document.body
      )}
    </>
  );
};

export default SearchableSelect;
