import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getExpensesAPI, getExpenseSummaryAPI, getExpenseCategoriesAPI, createExpenseAPI,
  updateExpenseAPI, deleteExpenseAPI, getReferencesAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import ExpenseFormModal from './ExpenseFormModal';
import { formatDate as _formatDate } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
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
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [summary, setSummary] = useState({ rows: [], grandTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [categorySearch, setCategorySearch] = useState('');
  const [page, setPage] = usePersistedFilters('expenses:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('expenses:pageSize', 25);
  const [total, setTotal] = useState(0);
  const [sumAmount, setSumAmount] = useState(0);
  const [filters, setFilters] = usePersistedFilters('expenses:filters', {
    categoryId: '',
    referenceId: '',
    from: monthStart(),
    to: todayIso(),
    q: '',
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const params = useMemo(() => ({
    page, limit: pageSize,
    categoryId: filters.categoryId || undefined,
    referenceId: filters.referenceId || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    q: filters.q || undefined,
  }), [page, pageSize, filters]);

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
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params]);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateExpenseAPI(modal.item._id, form);
        toast.success('Expense updated');
      } else {
        await createExpenseAPI(form);
        toast.success('Expense added');
      }
      setModal({ open: false, item: null });
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
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Expense
          </button>
        </div>
      )}

      {/* Top filters bar */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4 p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
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
            <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col">
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
              <div className="divide-y divide-gray-100 max-h-[calc(100vh-340px)] overflow-y-auto">
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
                  <div className="py-6 flex items-center justify-center gap-2 text-xs text-gray-400">
                    <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-primary-600 rounded-full animate-spin" />
                    <span>Loading categories…</span>
                  </div>
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
                </div>
              </div>

              {loading ? (
                <div className="py-8 text-center text-gray-400">Loading...</div>
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
                        <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {items.map((e) => (
                        <tr key={e._id} className="hover:bg-gray-50">
                          <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
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
                          <td className="py-3 px-4 text-gray-600 max-w-xs truncate" title={e.notes || ''}>{e.notes || <span className="text-gray-300">—</span>}</td>
                          <td className={`py-3 px-4 text-right font-medium ${e.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                            {formatINR(e.amount)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex justify-end gap-1">
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
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={filters.categoryId ? 4 : 5} className="py-3 px-4 text-right text-xs uppercase text-gray-500 font-semibold">Filtered total</td>
                        <td className="py-3 px-4 text-right font-semibold text-gray-800">{formatINR(sumAmount)}</td>
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
        categories={categories}
        references={references}
        loadingRefs={loadingRefs}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default ExpenseList;
