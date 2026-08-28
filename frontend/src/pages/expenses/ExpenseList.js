import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineDuplicate,
  HiOutlineSearch, HiChevronRight, HiChevronDown, HiOutlineDotsVertical,
  HiOutlineDownload, HiOutlineEye, HiOutlinePrinter, HiOutlineCash, HiOutlineX,
  HiOutlineUpload,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getExpensesAPI, getExpenseSummaryAPI, getExpenseCategoriesAPI, createExpenseAPI,
  updateExpenseAPI, deleteExpenseAPI, getReferencesAPI, getPartiesAPI, getBankAccountsAPI, createCashBankAPI,
  getPartyLedgerAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ExpenseFormModal from './ExpenseFormModal';
import TransactionImportModal from '../../components/import/TransactionImportModal';
import { expenseImportConfig } from '../../components/import/transactionImportConfigs';
import CashBankFormModal from '../cashbank/CashBankFormModal';
import { formatDate as _formatDate } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';
import Loader from '../../components/ui/Loader';

const buildExpenseVoucherHtml = (e) => {
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
  const amt = '₹' + Math.round(Number(e.amount) || 0).toLocaleString('en-IN');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  return `
    <div style="max-width:560px;margin:0 auto;padding:32px;font-family:'Helvetica Neue',Arial,sans-serif;color:#111827;">
      <div style="border-bottom:2px solid #1f2937;padding-bottom:12px;margin-bottom:24px;display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:22px;font-weight:700;letter-spacing:0.5px;">FCC</div>
          <div style="font-size:11px;color:#6b7280;">First Care Consultancy</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:13px;font-weight:600;color:#374151;">EXPENSE VOUCHER</div>
          <div style="font-size:11px;color:#6b7280;">Voucher #${esc((e._id || '').slice(-8).toUpperCase())}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <tbody>
          <tr><td style="padding:8px 0;color:#6b7280;width:35%;">Date</td><td style="padding:8px 0;font-weight:500;">${esc(fmtDate(e.date))}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Category</td><td style="padding:8px 0;font-weight:500;">${esc(e.category?.label || '-')}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Reference</td><td style="padding:8px 0;">${esc(e.reference?.name || '-')}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Paid To</td><td style="padding:8px 0;">${esc(e.partyName || '-')}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;vertical-align:top;">Notes</td><td style="padding:8px 0;white-space:pre-wrap;">${esc(e.notes || '-')}</td></tr>
        </tbody>
      </table>
      <div style="margin-top:24px;padding:14px 16px;background:#f3f4f6;border-radius:10px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:12px;font-weight:600;color:#6b7280;letter-spacing:0.5px;">TOTAL AMOUNT</span>
        <span style="font-size:20px;font-weight:700;color:${(e.amount || 0) < 0 ? '#b91c1c' : '#111827'};">${amt}</span>
      </div>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af;">
        <div>Prepared by _______________</div>
        <div>Authorised by _______________</div>
      </div>
    </div>`;
};

const printExpense = (e) => {
  const html = buildExpenseVoucherHtml(e);
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) { toast.error('Popup blocked — allow popups to print'); return; }
  w.document.write(`<!doctype html><html><head><title>Expense Voucher</title><meta charset="utf-8"/></head><body>${html}<script>window.onload=()=>{setTimeout(()=>{window.focus();window.print();},100);};</script></body></html>`);
  w.document.close();
};

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);

// Payment status badge styles (derived from each expense's linked payments).
const PAY_STATUS = {
  paid:    { label: 'Paid',         cls: 'bg-green-50 text-green-700' },
  partial: { label: 'Part Payment', cls: 'bg-amber-50 text-amber-700' },
  pending: { label: 'Pending',      cls: 'bg-gray-100 text-gray-600' },
};

const ExpenseList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('expenses', 'create');
  const canEdit = can('expenses', 'edit');
  const canDelete = can('expenses', 'delete');

  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [references, setReferences] = useState([]);
  const [parties, setParties] = useState([]);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [summary, setSummary] = useState({ rows: [], grandTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null, mode: 'create' });
  const [importOpen, setImportOpen] = useState(false);
  const [categorySearch, setCategorySearch] = useState('');
  const [actionMenu, setActionMenu] = useState(null); // { id, top?, bottom?, left, item }
  const actionMenuRef = useRef(null);
  const [previewExpense, setPreviewExpense] = useState(null);
  const [paymentExpense, setPaymentExpense] = useState(null);
  // The party's open expenses, so any amount beyond this expense's pending can be
  // linked/split across the party's other open expenses.
  const [payOpenExpenses, setPayOpenExpenses] = useState([]);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);

  const openActionMenu = (evt, item) => {
    evt.stopPropagation();
    const r = evt.currentTarget.getBoundingClientRect();
    const menuWidth = 210;
    const estH = 300;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < estH && r.top > spaceBelow;
    const left = Math.max(8, Math.min(r.right - menuWidth, window.innerWidth - menuWidth - 8));
    setActionMenu(openUp
      ? { id: item._id, item, bottom: window.innerHeight - r.top + 4, left }
      : { id: item._id, item, top: r.bottom + 4, left });
  };

  useEffect(() => {
    if (!actionMenu) return;
    const close = (evt) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(evt.target)) setActionMenu(null);
    };
    const onScroll = () => setActionMenu(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [actionMenu]);

  // Open the payment modal; if the expense has a party, load its other open
  // expenses so an over-payment can be split across them.
  const payExpense = async (e) => {
    const pending = Math.max(0, Math.round(e.amountPending != null ? e.amountPending : (e.amount || 0) - (e.amountPaid || 0)));
    let openList = [{ _id: e._id, category: e.category, amount: pending, amountPending: pending, date: e.date }];
    if (e.partyId) {
      try {
        const { data } = await getPartyLedgerAPI(e.partyId);
        const rows = (data?.transactions || [])
          .filter((t) => t.type === 'expense' && t.balance > 0)
          .map((t) => ({ _id: t.refId, category: { label: t.name }, amount: t.balance, amountPending: t.balance, date: t.date }));
        if (rows.some((r) => r._id === e._id)) openList = rows;
      } catch { /* fall back to single-expense list */ }
    }
    setPayOpenExpenses(openList);
    setPaymentExpense(e);
  };

  const handlePaymentSave = async (form) => {
    if (!paymentExpense) return;
    setPaymentSaving(true);
    try {
      // Split payment → one payout per linked expense; otherwise a single one.
      const entries = form.allocations?.length
        ? form.allocations
        : [{ expenseId: paymentExpense._id, amount: form.amount }];
      for (const a of entries) {
        await createCashBankAPI({
          date: form.date, mode: form.mode, notes: form.notes,
          bankAccountId: form.bankAccountId, utrNumber: form.utrNumber, chequeNumber: form.chequeNumber,
          direction: 'out',
          expenseId: a.expenseId,
          amount: a.amount,
        });
      }
      toast.success('Payment recorded');
      setPaymentExpense(null);
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to record payment');
    } finally {
      setPaymentSaving(false);
    }
  };
  // Per-merged-row breakdown cache. Lazy-loaded the first time the operator
  // expands a roll-up so we don't fetch every breakdown upfront.
  const [expanded, setExpanded] = useState({}); // { [mergedRowId]: { loading, items } }

  const toggleExpand = async (mergedRow) => {
    setExpanded((prev) => {
      const next = { ...prev };
      if (next[mergedRow._id]?.open) {
        next[mergedRow._id] = { ...next[mergedRow._id], open: false };
        return next;
      }
      next[mergedRow._id] = { open: true, loading: !next[mergedRow._id]?.items, items: next[mergedRow._id]?.items || [] };
      return next;
    });
    if (expanded[mergedRow._id]?.items) return; // already fetched
    try {
      const d = new Date(mergedRow.date);
      const monthFrom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
      const monthTo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
      const { data } = await getExpensesAPI({
        categoryId: mergedRow.categoryId,
        referenceId: mergedRow.referenceId || undefined,
        from: monthFrom,
        to: monthTo,
        limit: 200,
      });
      setExpanded((prev) => ({
        ...prev,
        [mergedRow._id]: { open: true, loading: false, items: data.expenses || [] },
      }));
    } catch {
      toast.error('Failed to load breakdown');
      setExpanded((prev) => ({
        ...prev,
        [mergedRow._id]: { open: true, loading: false, items: [] },
      }));
    }
  };
  const [page, setPage] = usePersistedFilters('expenses:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('expenses:pageSize', 25);
  const [total, setTotal] = useState(0);
  const [sumAmount, setSumAmount] = useState(0);
  const [sumPaid, setSumPaid] = useState(0);
  const [sumPending, setSumPending] = useState(0);
  const [filters, setFilters] = usePersistedFilters('expenses:filters', {
    categoryId: '',
    referenceId: '',
    from: '',
    to: '',
    q: '',
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const importConfig = useMemo(() => expenseImportConfig({ categories, references }), [categories, references]);

  // Reference Commission is auto-generated per invoice, which dumps dozens of
  // rows for the same reference each month. Auto-roll those into one row per
  // (reference, month) so the operator sees a clean monthly total instead.
  const refCommissionCategoryId = useMemo(
    () => categories.find((c) => c.slug === 'reference_commission')?._id || '',
    [categories],
  );
  const isMergedView = !!filters.categoryId && filters.categoryId === refCommissionCategoryId;

  const params = useMemo(() => ({
    page, limit: pageSize,
    categoryId: filters.categoryId || undefined,
    referenceId: filters.referenceId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    q: filters.q || undefined,
    merge: isMergedView ? 'monthly' : undefined,
  }), [page, pageSize, filters, isMergedView]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        getExpensesAPI(params),
        getExpenseSummaryAPI({ from: filters.from || undefined, to: filters.to || undefined }),
      ]);
      setItems(list.data.expenses);
      setTotal(list.data.total);
      setSumAmount(list.data.sumAmount);
      setSumPaid(list.data.sumPaid || 0);
      setSumPending(list.data.sumPending || 0);
      setSummary(sum.data);
    } catch {
      toast.error('Failed to load expenses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([
      getExpenseCategoriesAPI(),
      getReferencesAPI({ active: 'true' }),
    ]).then(([cats, refs]) => {
      setCategories(cats.data || []);
      setReferences(refs.data || []);
    }).catch(() => {}).finally(() => setLoadingRefs(false));

    getBankAccountsAPI({ active: 'true' })
      .then(({ data }) => setBankAccounts(data || []))
      .catch(() => setBankAccounts([]))
      .finally(() => setLoadingBankAccounts(false));

    getPartiesAPI({ active: 'true' }).then(({ data }) => setParties(data || [])).catch(() => {});
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params]);

  const handleSave = async (form) => {
    try {
      if (modal.mode === 'edit' && modal.item) {
        await updateExpenseAPI(modal.item._id, form);
        toast.success('Expense updated');
      } else {
        await createExpenseAPI(form);
        toast.success(modal.mode === 'duplicate' ? 'Expense duplicated' : 'Expense added');
      }
      setModal({ open: false, item: null, mode: 'create' });
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
      throw e;
    }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete this ${item.category?.label} expense of ${formatINR(item.amount)}?`, { title: 'Delete Expense', confirmLabel: 'Delete' }))) return;
    try {
      await deleteExpenseAPI(item._id);
      toast.success('Deleted');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div>
      {canCreate && (
        <div className="flex justify-end mb-4 gap-2">
          <button onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlineUpload className="w-4 h-4" /> Import
          </button>
          <button onClick={() => setModal({ open: true, item: null, mode: 'create' })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      )}

      {/* Top filters bar */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Filters</span>
          <button
            onClick={() => { setFilters((f) => ({ ...f, from: '', to: '', referenceId: '', q: '', categoryId: '' })); setPage(1); }}
            className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline">
            Reset filters
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
          <input type="date" value={filters.from}
            onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
          <input type="date" value={filters.to}
            onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Reference</label>
          <SearchableSelect
            isLoading={loadingRefs}
            value={filters.referenceId}
            onChange={(v) => { setFilters((f) => ({ ...f, referenceId: v })); setPage(1); }}
            placeholder="All references"
            searchPlaceholder="Search references..."
            noneLabel="All references"
            allowClear
            options={references.map((r) => ({ value: r._id, label: r.name }))}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Search notes</label>
          <div className="relative">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={filters.q}
              onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
              placeholder="Search…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>
        </div>
      </div>

      {/* Two-column layout: categories sidebar + entries table */}
      {(() => {
        const totalEntries = summary.rows.reduce((a, r) => a + r.count, 0);
        const visibleRows = summary.rows.filter((r) =>
          !categorySearch.trim() || (r.label || '').toLowerCase().includes(categorySearch.trim().toLowerCase())
        );
        const activeRow = filters.categoryId ? summary.rows.find((r) => r._id === filters.categoryId) : null;
        const activeLabel = activeRow ? activeRow.label : 'All Categories';
        return (
          <div className="grid grid-cols-12 gap-4">
            {/* Left: Category list */}
            <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)]">
              <div className="p-3 border-b border-gray-100">
                <div className="relative">
                  <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    value={categorySearch}
                    onChange={(e) => setCategorySearch(e.target.value)}
                    placeholder="Search category…"
                    className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between px-3 pt-2 pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Category</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Amount</span>
              </div>
              <div className="divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto">
                {!(loading && summary.rows.length === 0) && (
                  <button
                    onClick={() => { setFilters((f) => ({ ...f, categoryId: '' })); setPage(1); }}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                      filters.categoryId === '' ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className={`text-sm font-semibold truncate ${filters.categoryId === '' ? 'text-primary-700' : 'text-gray-800'}`}>All Categories</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{totalEntries} entries</p>
                    </div>
                    <p className="text-sm font-semibold text-gray-800 ml-2 flex-shrink-0">{formatINR(summary.grandTotal)}</p>
                  </button>
                )}
                {loading && summary.rows.length === 0 ? (
                  <Loader inline label="Loading categories…" className="justify-center py-6" />
                ) : visibleRows.length === 0 ? (
                  <div className="py-6 text-center text-xs text-gray-400">
                    {categorySearch.trim() ? 'No categories match' : 'No categories with expenses in this range'}
                  </div>
                ) : (
                  visibleRows.map((r) => (
                    <button
                      key={r._id}
                      onClick={() => { setFilters((f) => ({ ...f, categoryId: r._id })); setPage(1); }}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors ${
                        filters.categoryId === r._id ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${filters.categoryId === r._id ? 'text-primary-700' : 'text-gray-800'}`}>{r.label}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">{r.count} {r.count === 1 ? 'entry' : 'entries'}</p>
                      </div>
                      <p className={`text-sm font-medium ml-2 flex-shrink-0 ${r.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(r.amount)}</p>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: Entries for selected category */}
            <div className="col-span-12 md:col-span-8 lg:col-span-9 bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Showing</p>
                  <h3 className="text-base font-semibold text-gray-900 truncate">{activeLabel}</h3>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">{total} {total === 1 ? 'entry' : 'entries'}</p>
                  <p className={`text-base font-semibold ${sumAmount < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(sumAmount)}</p>
                  {!isMergedView && (
                    <p className="text-[11px] text-gray-400">
                      Paid {formatINR(sumPaid)} · Balance <span className={sumPending > 0 ? 'text-amber-600 font-medium' : ''}>{formatINR(sumPending)}</span>
                    </p>
                  )}
                </div>
              </div>

              {loading ? (
                <Loader label="Loading…" className="py-8" />
              ) : items.length === 0 ? (
                <div className="py-8 text-center text-gray-400">No expenses found in this range</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                        {!filters.categoryId && (
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Category</th>
                        )}
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reference</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Party</th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Paid</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Balance</th>
                        <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((e) => {
                        const merged = isMergedView;
                        const dateLabel = merged
                          ? new Date(e.date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric', timeZone: 'UTC' }).replace(' ', '-')
                          : formatDate(e.date);
                        const expState = expanded[e._id];
                        const isOpen = !!expState?.open;
                        const breakdown = expState?.items || [];
                        return (
                          <React.Fragment key={e._id}>
                            <tr className={`hover:bg-gray-50 ${merged && isOpen ? 'bg-primary-50/40' : ''}`}>
                              <td className="py-3 px-4 text-gray-600 whitespace-nowrap">
                                <div className="flex items-center gap-2">
                                  {merged && (
                                    <button
                                      onClick={() => toggleExpand(e)}
                                      title={isOpen ? 'Collapse' : 'Show breakdown'}
                                      className="p-0.5 text-gray-500 hover:text-primary-600 hover:bg-primary-100 rounded transition-colors"
                                    >
                                      {isOpen ? <HiChevronDown className="w-4 h-4" /> : <HiChevronRight className="w-4 h-4" />}
                                    </button>
                                  )}
                                  <span>{dateLabel}</span>
                                </div>
                              </td>
                              {!filters.categoryId && (
                                <td className="py-3 px-4">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-gray-800">{e.category?.label}</span>
                                    {e.sourceType && (
                                      <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded" title={`Auto-created from ${e.sourceType}`}>AUTO</span>
                                    )}
                                  </div>
                                </td>
                              )}
                              <td className="py-3 px-4 text-gray-600">{e.reference?.name || <span className="text-gray-300">—</span>}</td>
                              <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{e.partyName || <span className="text-gray-300">—</span>}</td>
                              <td className="py-3 px-4 text-gray-600 max-w-xs truncate" title={e.notes || ''}>
                                {merged
                                  ? <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-[11px] font-medium">{e.notes}</span>
                                  : (e.notes || <span className="text-gray-300">—</span>)}
                              </td>
                              <td className={`py-3 px-4 text-right font-medium ${e.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                                {formatINR(e.amount)}
                              </td>
                              <td className="py-3 px-4 text-right text-gray-600">
                                {merged ? <span className="text-gray-300">—</span> : formatINR(e.amountPaid || 0)}
                              </td>
                              <td className="py-3 px-4 text-right text-gray-600">
                                {merged ? <span className="text-gray-300">—</span> : formatINR(e.amountPending || 0)}
                              </td>
                              <td className="py-3 px-4 text-center">
                                {merged ? (
                                  <span className="text-gray-300">—</span>
                                ) : (
                                  <span className={`text-xs px-2 py-0.5 rounded ${(PAY_STATUS[e.paymentStatus] || PAY_STATUS.pending).cls}`}>
                                    {(PAY_STATUS[e.paymentStatus] || PAY_STATUS.pending).label}
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-4 text-right">
                                <div className="flex justify-end">
                                  {merged ? (
                                    <span className="text-[10px] text-gray-400 italic">monthly roll-up</span>
                                  ) : (
                                    <button
                                      onClick={(evt) => openActionMenu(evt, e)}
                                      title="More actions"
                                      className="p-1.5 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-lg">
                                      <HiOutlineDotsVertical className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {merged && isOpen && (
                              <tr className="bg-gray-50/70">
                                <td colSpan={filters.categoryId ? 9 : 10} className="px-4 py-3">
                                  {expState?.loading ? (
                                    <Loader inline label="Loading breakdown…" className="" />
                                  ) : breakdown.length === 0 ? (
                                    <p className="text-xs text-gray-400">No entries in this bucket.</p>
                                  ) : (
                                    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                                      <table className="w-full text-xs">
                                        <thead className="bg-gray-50 text-[10px] uppercase text-gray-500">
                                          <tr>
                                            <th className="text-left py-2 px-3 font-semibold">Date</th>
                                            <th className="text-left py-2 px-3 font-semibold">Party</th>
                                            <th className="text-left py-2 px-3 font-semibold">Notes</th>
                                            <th className="text-right py-2 px-3 font-semibold">Amount</th>
                                            <th className="text-right py-2 px-3 font-semibold">Actions</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100">
                                          {breakdown.map((row) => (
                                            <tr key={row._id} className="hover:bg-gray-50">
                                              <td className="py-1.5 px-3 text-gray-600 whitespace-nowrap">{formatDate(row.date)}</td>
                                              <td className="py-1.5 px-3 text-gray-600 whitespace-nowrap">{row.partyName || <span className="text-gray-300">—</span>}</td>
                                              <td className="py-1.5 px-3 text-gray-600 max-w-md truncate" title={row.notes || ''}>{row.notes || <span className="text-gray-300">—</span>}</td>
                                              <td className={`py-1.5 px-3 text-right font-medium ${row.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(row.amount)}</td>
                                              <td className="py-1.5 px-3 text-right">
                                                <div className="flex justify-end">
                                                  <button
                                                    onClick={(evt) => openActionMenu(evt, row)}
                                                    title="More actions"
                                                    className="p-1 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded">
                                                    <HiOutlineDotsVertical className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={filters.categoryId ? 4 : 5} className="py-3 px-4 text-right text-xs uppercase text-gray-500 font-semibold">Filtered total</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800">{formatINR(sumAmount)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800">{isMergedView ? '' : formatINR(sumPaid)}</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800">{isMergedView ? '' : formatINR(sumPending)}</td>
                        <td />
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              {!loading && total > 0 && (
                <PaginationBar
                  page={page} pages={pages} total={total}
                  pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
                />
              )}
            </div>
          </div>
        );
      })()}

      <ExpenseFormModal
        open={modal.open}
        initial={modal.item}
        mode={modal.mode}
        categories={categories}
        references={references}
        parties={parties}
        loadingRefs={loadingRefs}
        onClose={() => setModal({ open: false, item: null, mode: 'create' })}
        onSave={handleSave}
      />

      <TransactionImportModal
        open={importOpen}
        config={importConfig}
        onClose={() => setImportOpen(false)}
        onImported={fetchAll}
      />

      {actionMenu && ReactDOM.createPortal(
        (() => {
          const e = actionMenu.item;
          if (!e) return null;
          return (
            <div
              ref={actionMenuRef}
              style={{
                position: 'fixed',
                left: actionMenu.left,
                width: 210,
                ...(actionMenu.top !== undefined ? { top: actionMenu.top } : { bottom: actionMenu.bottom }),
              }}
              className="bg-white border border-gray-200 rounded-lg shadow-lg z-[60] py-1">
              {canEdit && (
                <button
                  onClick={() => { setActionMenu(null); setModal({ open: true, item: e, mode: 'edit' }); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <HiOutlinePencil className="w-4 h-4 text-primary-600" /> View/Edit
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => { setActionMenu(null); handleDelete(e); }}
                  className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2">
                  <HiOutlineTrash className="w-4 h-4" /> Delete
                </button>
              )}
              {canCreate && (
                <button
                  onClick={() => { setActionMenu(null); setModal({ open: true, item: e, mode: 'duplicate' }); }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                  <HiOutlineDuplicate className="w-4 h-4 text-emerald-600" /> Duplicate
                </button>
              )}
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={() => { setActionMenu(null); printExpense(e); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlineDownload className="w-4 h-4 text-primary-600" /> Open PDF
              </button>
              <button
                onClick={() => { setActionMenu(null); setPreviewExpense(e); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlineEye className="w-4 h-4 text-primary-600" /> Preview
              </button>
              <button
                onClick={() => { setActionMenu(null); printExpense(e); }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2">
                <HiOutlinePrinter className="w-4 h-4 text-primary-600" /> Print
              </button>
              <div className="my-1 border-t border-gray-100" />
              <button
                onClick={() => { setActionMenu(null); payExpense(e); }}
                className="w-full text-left px-3 py-2 text-sm text-green-700 hover:bg-green-50 flex items-center gap-2">
                <HiOutlineCash className="w-4 h-4" /> Make Payment
              </button>
            </div>
          );
        })(),
        document.body,
      )}

      {previewExpense && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
             onClick={() => setPreviewExpense(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
               onClick={(evt) => evt.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800">Preview</h3>
              <div className="flex items-center gap-1">
                <button onClick={() => printExpense(previewExpense)}
                  title="Print"
                  className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                  <HiOutlinePrinter className="w-4 h-4" />
                </button>
                <button onClick={() => setPreviewExpense(null)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded">
                  <HiOutlineX className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto bg-gray-50 p-4">
              <div className="bg-white rounded-lg shadow-sm"
                   dangerouslySetInnerHTML={{ __html: buildExpenseVoucherHtml(previewExpense) }} />
            </div>
          </div>
        </div>,
        document.body,
      )}

      <CashBankFormModal
        open={!!paymentExpense}
        initial={paymentExpense ? {
          direction: 'out',
          mode: 'cash',
          amount: Math.max(0, Math.round(paymentExpense.amountPending != null ? paymentExpense.amountPending : (paymentExpense.amount || 0) - (paymentExpense.amountPaid || 0))),
          expense: { _id: paymentExpense._id },
          notes: paymentExpense.notes || '',
        } : null}
        invoices={[]}
        expenses={payOpenExpenses}
        bankAccounts={bankAccounts}
        loadingBankAccounts={loadingBankAccounts}
        lockDirection="out"
        allowSplit
        onClose={() => !paymentSaving && setPaymentExpense(null)}
        onSave={handlePaymentSave}
      />
    </div>
  );
};

export default ExpenseList;
