import React, { useEffect, useMemo, useState } from 'react';
import Loader from '../../components/ui/Loader';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineCash, HiOutlineCreditCard,
  HiOutlineQrcode, HiOutlineUpload, HiOutlineSearch, HiOutlineCollection, HiOutlineExternalLink,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getCashBankAPI, getCashBankBalancesAPI, createCashBankAPI, createCashBankSplitAPI, updateCashBankAPI, deleteCashBankAPI,
  getInvoicesAPI, getExpensesAPI, getBankAccountsAPI,
} from '../../services/api';
import CashBankFormModal from './CashBankFormModal';
import TransactionImportModal from '../../components/import/TransactionImportModal';
import { cashBankImportConfig } from '../../components/import/transactionImportConfigs';
import { formatDateTime } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const MODE_ICONS = { cash: HiOutlineCash, bank: HiOutlineCreditCard, upi: HiOutlineQrcode };

// Left-column money buckets. `mode` drives the transactions filter ('' = All);
// `balanceKey` selects the figure from the /balances response.
const BUCKETS = [
  { key: 'all',  label: 'All',  mode: '',     balanceKey: 'total', icon: HiOutlineCollection },
  { key: 'cash', label: 'Cash', mode: 'cash', balanceKey: 'cash',  icon: HiOutlineCash },
  { key: 'bank', label: 'Bank', mode: 'bank', balanceKey: 'bank',  icon: HiOutlineCreditCard },
  { key: 'upi',  label: 'UPI',  mode: 'upi',  balanceKey: 'upi',   icon: HiOutlineQrcode },
];

// Human counterparty/label for a transaction row.
const txnName = (e) => {
  if (e.source === 'journal') return e.notes || e.accountName || `Journal ${e.refNumber || ''}`.trim();
  if (e.invoice) return e.invoice.hospital?.name || e.invoice.invoiceNumber || 'Invoice';
  if (e.expense) return e.expense.category?.label || 'Expense';
  return e.hospital?.name || e.notes || '—';
};

// The invoice/expense this entry is linked to, as a clickable chip.
const LinkedCell = ({ e }) => {
  if (e.source === 'journal') {
    return (
      <Link to="/account-entries" title={`Journal ${e.refNumber || ''}`}
        className="inline-flex items-center gap-1 max-w-[200px] text-xs font-medium text-purple-700 hover:text-purple-800 hover:underline">
        <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 shrink-0">Journal</span>
        <span className="truncate">{e.refNumber || 'Entry'}</span>
        <HiOutlineExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60" />
      </Link>
    );
  }
  if (e.invoice) {
    const label = e.invoice.invoiceNumber || e.invoice.hospital?.name || 'Invoice';
    return (
      <Link to={`/invoices/${e.invoice._id}`} title={`Invoice ${label}`}
        className="inline-flex items-center gap-1 max-w-[200px] text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline">
        <span className="px-1.5 py-0.5 rounded bg-primary-50 text-primary-700 shrink-0">Invoice</span>
        <span className="truncate">{label}</span>
        <HiOutlineExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60" />
      </Link>
    );
  }
  if (e.expense) {
    const label = e.expense.category?.label || 'Expense';
    return (
      <Link to="/expenses" title={`Expense · ${label}`}
        className="inline-flex items-center gap-1 max-w-[200px] text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline">
        <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">Expense</span>
        <span className="truncate">{label}</span>
        <HiOutlineExternalLink className="w-3.5 h-3.5 shrink-0 opacity-60" />
      </Link>
    );
  }
  return <span className="text-gray-300">—</span>;
};

const CashBankList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('cash_bank', 'create');
  const canEdit = can('cash_bank', 'edit');
  const canDelete = can('cash_bank', 'delete');

  const [items, setItems] = useState([]);
  const [balances, setBalances] = useState({ cash: 0, bank: 0, upi: 0, total: 0 });
  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(true);
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [loadingBankAccounts, setLoadingBankAccounts] = useState(true);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = usePersistedFilters('cashbank:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('cashbank:pageSize', 25);
  const [total, setTotal] = useState(0);
  // Drill-down from the Chart of Accounts: ?mode=bank|cash preselects that
  // bucket. Seed it into the INITIAL filter so the very first fetch is already
  // filtered. (Applying it in a post-mount effect instead fired a second fetch
  // that raced with the default unfiltered mount fetch — the unfiltered one
  // could resolve last and overwrite the filtered list.)
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = searchParams.get('mode');
  const [filters, setFilters] = usePersistedFilters('cashbank:filters', {
    direction: '', mode: BUCKETS.some((b) => b.mode === initialMode) ? initialMode : '', from: '', to: '', q: '',
  });
  // Tidy the URL after seeding (doesn't touch filters, so no refetch).
  useEffect(() => {
    if (searchParams.get('mode')) setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const activeBucket = BUCKETS.find((b) => b.mode === filters.mode) || BUCKETS[0];

  const importConfig = useMemo(() => cashBankImportConfig({ bankAccounts }), [bankAccounts]);

  const params = useMemo(() => ({
    page, limit: pageSize,
    direction: filters.direction || undefined,
    mode: filters.mode || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    q: filters.q || undefined,
  }), [page, pageSize, filters]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, bal] = await Promise.all([getCashBankAPI(params), getCashBankBalancesAPI()]);
      setItems(list.data.entries);
      setTotal(list.data.total);
      setBalances(bal.data);
    } catch {
      toast.error('Failed to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Load invoice/expense pickers (best-effort). Fetch EVERY still-owed invoice
    // ('__open' = issued/partially_paid with a pending balance) — the picker's
    // search filters client-side, so an unfetched invoice can never be found.
    getInvoicesAPI({ status: '__open', limit: 5000 }).then(({ data }) => setInvoices(data.invoices || [])).catch(() => {}).finally(() => setLoadingInvoices(false));
    // Only offer expenses not already paid by a cash/bank entry (avoids linking
    // the same expense twice). The entry being edited re-adds its own linked
    // expense on the client (see CashBankFormModal) so it stays selectable.
    getExpensesAPI({ limit: 200, unlinkedOnly: 'true' }).then(({ data }) => setExpenses(data.expenses || [])).catch(() => {}).finally(() => setLoadingExpenses(false));
    getBankAccountsAPI({ active: 'true' }).then(({ data }) => setBankAccounts(data || [])).catch(() => setBankAccounts([])).finally(() => setLoadingBankAccounts(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params]);

  const selectBucket = (mode) => { setFilters((f) => ({ ...f, mode })); setPage(1); };

  const handleSave = async (form) => {
    try {
      if (modal.item && Array.isArray(form.allocations)) {
        // Multi-link while editing: the edited entry takes the first bill, the
        // rest become new sibling entries.
        const { allocations, ...shared } = form;
        const [primary, ...extras] = allocations;
        await updateCashBankAPI(modal.item._id, {
          ...shared,
          amount: primary.amount,
          invoiceId: primary.invoiceId || null,
          expenseId: primary.expenseId || null,
        });
        if (extras.length) await createCashBankSplitAPI({ ...shared, allocations: extras });
        toast.success(extras.length ? `Entry updated + ${extras.length} added` : 'Entry updated');
      } else if (modal.item) {
        await updateCashBankAPI(modal.item._id, form);
        toast.success('Entry updated');
      } else if (Array.isArray(form.allocations)) {
        // Multi-link: one payment split into one entry per linked bill.
        const { entries } = (await createCashBankSplitAPI(form)).data;
        toast.success(`${entries?.length || form.allocations.length} entries added`);
      } else {
        await createCashBankAPI(form);
        toast.success('Entry added');
      }
      setModal({ open: false, item: null });
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
      throw e;
    }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete this ${item.direction.toUpperCase()} entry of ${formatINR(item.amount)}?`, { title: 'Delete Entry', confirmLabel: 'Delete' }))) return;
    try {
      await deleteCashBankAPI(item._id);
      toast.success('Deleted');
      fetchAll();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Cash / Bank</h1>
        {canCreate && (
          <div className="flex gap-2">
            <button onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlineUpload className="w-4 h-4" /> Import
            </button>
            <button onClick={() => setModal({ open: true, item: null })}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
              <HiOutlinePlus className="w-4 h-4" /> Add Entry
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: money buckets */}
        <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)]">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Account</span>
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">Balance</span>
          </div>
          <div className="divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto">
            {BUCKETS.map((b) => {
              const bal = balances[b.balanceKey] ?? 0;
              const Icon = b.icon;
              return (
                <button key={b.key} onClick={() => selectBucket(b.mode)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-3 text-left transition-colors ${
                    activeBucket.key === b.key ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}>
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-4 h-4 flex-shrink-0 ${activeBucket.key === b.key ? 'text-primary-600' : 'text-gray-400'}`} />
                    <span className="text-sm font-medium text-gray-800 truncate">{b.label}</span>
                  </span>
                  <span className={`text-sm font-semibold whitespace-nowrap ${bal < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                    {formatINR(bal)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: selected bucket detail + transactions */}
        <div className="col-span-12 md:col-span-8 lg:col-span-9 bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Bucket header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">{activeBucket.key === 'all' ? 'Total on hand' : `${activeBucket.label} balance`}</p>
              <p className={`text-lg font-semibold ${(balances[activeBucket.balanceKey] ?? 0) < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                {formatINR(balances[activeBucket.balanceKey] ?? 0)}
              </p>
            </div>
            <div className="relative w-56 max-w-full">
              <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={filters.q}
                onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
                placeholder="Search notes / UTR / cheque"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>

          {/* Filters */}
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
              <select value={filters.direction}
                onChange={(e) => { setFilters((f) => ({ ...f, direction: e.target.value })); setPage(1); }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm">
                <option value="">All</option>
                <option value="in">IN</option>
                <option value="out">OUT</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
              <input type="date" value={filters.from}
                onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
              <input type="date" value={filters.to}
                onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
            <button
              onClick={() => { setFilters((f) => ({ ...f, direction: '', from: '', to: '', q: '' })); setPage(1); }}
              className="ml-auto text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline pb-2">
              Reset filters
            </button>
          </div>

          {loading ? (
            <Loader label="Loading…" className="py-8" />
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-gray-400">No entries in this range</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Linked To</th>
                    <th className="text-left py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                    <th className="text-right py-3 px-3 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((e) => {
                    const Icon = MODE_ICONS[e.mode] || HiOutlineCash;
                    const sub = e.utrNumber || e.chequeNumber || null;
                    const isJournal = e.source === 'journal';
                    return (
                      <tr key={e._id} className="hover:bg-gray-50">
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            {isJournal ? (
                              <span className="text-xs font-medium px-2 py-0.5 rounded bg-purple-50 text-purple-700">
                                Journal-{e.direction === 'in' ? 'In' : 'Out'}
                              </span>
                            ) : (
                              <span className={`text-xs font-medium px-2 py-0.5 rounded ${e.direction === 'in' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {e.direction === 'in' ? 'Payment-In' : 'Payment-Out'}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[11px] text-gray-400" title={e.mode.toUpperCase()}>
                              <Icon className="w-3.5 h-3.5" />{e.mode.toUpperCase()}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3 max-w-[220px]">
                          <div className="text-gray-700 truncate">{txnName(e)}</div>
                          {sub && <div className="text-[11px] text-gray-400 font-mono truncate">{sub}</div>}
                        </td>
                        <td className="py-3 px-3"><LinkedCell e={e} /></td>
                        <td className="py-3 px-3 text-gray-600 whitespace-nowrap">{formatDateTime(e.date)}</td>
                        <td className={`py-3 px-3 text-right font-medium whitespace-nowrap ${e.direction === 'in' ? 'text-green-700' : 'text-red-700'}`}>
                          {e.direction === 'in' ? '+' : '−'}{formatINR(e.amount)}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex justify-end gap-1">
                            {isJournal ? (
                              <Link to="/account-entries" title="Edit in Account Entries"
                                className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded">
                                <HiOutlineExternalLink className="w-4 h-4" />
                              </Link>
                            ) : (
                              <>
                                {canEdit && (
                                  <button onClick={() => setModal({ open: true, item: e })}
                                    className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                                    <HiOutlinePencil className="w-4 h-4" />
                                  </button>
                                )}
                                {canDelete && (
                                  <button onClick={() => handleDelete(e)}
                                    className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded">
                                    <HiOutlineTrash className="w-4 h-4" />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
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

      <CashBankFormModal
        open={modal.open}
        initial={modal.item}
        invoices={invoices}
        expenses={expenses}
        bankAccounts={bankAccounts}
        loadingInvoices={loadingInvoices}
        loadingExpenses={loadingExpenses}
        loadingBankAccounts={loadingBankAccounts}
        allowMultiLink
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />

      <TransactionImportModal
        open={importOpen}
        config={importConfig}
        onClose={() => setImportOpen(false)}
        onImported={fetchAll}
      />
    </div>
  );
};

export default CashBankList;
