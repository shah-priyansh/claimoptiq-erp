import { useState } from 'react';

// State hook for list-page filters and pagination.
//
// Product decision: filter/pagination selections must NOT carry across
// navigation. Every list page (Claims, Invoices, Expenses, Cash/Bank, Account
// Entries, Hospitals, …) opens fresh with its default filters and page 1 each
// time it is visited — leaving a page and coming back always resets the
// filters (search, status, dates, hospital, page, page size, etc.).
//
// This used to mirror state into sessionStorage so selections survived a trip
// to a detail page and back; that persistence was intentionally removed. Kept
// as a thin wrapper with the same name/signature so the list pages don't need
// to change and persistence could be re-enabled in this one place if ever
// wanted. `key` is unused now but retained so call sites stay untouched.
//
// usage:
//   const [filters, setFilters] = usePersistedFilters('claims:filters', {
//     hospital: '', status: '', dateFrom: '', dateTo: '',
//   });
export default function usePersistedFilters(key, defaults) {
  return useState(defaults);
}

// Retained for call sites that clear a filter bucket. Since we no longer write
// to sessionStorage this is effectively a no-op, but it still wipes any stale
// key left over from before persistence was removed.
export function clearPersistedFilters(key) {
  try { sessionStorage.removeItem(key); } catch {}
}
