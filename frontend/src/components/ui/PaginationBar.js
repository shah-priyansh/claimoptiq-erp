import React from 'react';
import { HiOutlineChevronLeft, HiOutlineChevronRight } from 'react-icons/hi';

const getPageItems = (current, total, siblings = 1) => {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const showLeftDots = current - siblings > 2;
  const showRightDots = current + siblings < total - 1;

  if (!showLeftDots && showRightDots) return [1, 2, 3, 4, 5, '…', total];
  if (showLeftDots && !showRightDots) return [1, '…', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '…', current - 1, current, current + 1, '…', total];
};

const PaginationBar = ({
  page,
  pages,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  label = 'items',
  pageSizeOptions = [10, 25, 50, 100],
}) => {
  if (!total) return null;
  const items = getPageItems(page, pages);

  const numBtn = (n, isActive) =>
    `min-w-[2rem] h-8 px-2.5 inline-flex items-center justify-center rounded-lg text-sm font-medium border transition-colors ${
      isActive
        ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300'
    }`;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t border-gray-200 bg-gray-50/50">
      <div className="flex items-center gap-4">
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-800">Page {page}</span>
          <span className="text-gray-400"> of {pages}</span>
          <span className="hidden sm:inline text-gray-400"> · {total.toLocaleString()} {label}</span>
        </p>
        <label className="flex items-center gap-2 text-sm text-gray-500">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="pl-3 pr-8 py-1.5 border border-gray-200 bg-white rounded-lg text-sm text-gray-700 font-medium focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
          >
            {pageSizeOptions.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex items-center justify-center w-8 h-8 border border-gray-200 bg-white rounded-lg text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 hover:border-gray-300 transition-colors"
          aria-label="Previous page"
        >
          <HiOutlineChevronLeft className="w-4 h-4" />
        </button>

        {items.map((it, i) =>
          it === '…'
            ? <span key={`dots-${i}`} className="px-1 text-sm text-gray-400 select-none">…</span>
            : (
              <button
                key={it}
                onClick={() => onPageChange(it)}
                disabled={it === page}
                className={numBtn(it, it === page)}
              >
                {it}
              </button>
            )
        )}

        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
          className="inline-flex items-center justify-center w-8 h-8 border border-gray-200 bg-white rounded-lg text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 hover:border-gray-300 transition-colors"
          aria-label="Next page"
        >
          <HiOutlineChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

export default PaginationBar;
