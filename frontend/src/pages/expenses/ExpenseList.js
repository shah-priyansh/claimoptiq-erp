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
import ExpenseFormModal from './ExpenseFormModal';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';

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
  const [summary, setSummary] = useState({ rows: [], grandTotal: 0 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [sumAmount, setSumAmount] = useState(0);
  const [filters, setFilters] = useState({
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
    }).catch(() => {});
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

      {/* Totals strip — per-category cards + grand total */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        {summary.rows.map((r) => (
          <button
            key={r._id}
            onClick={() => { setFilters((f) => ({ ...f, categoryId: f.categoryId === r._id ? '' : r._id })); setPage(1); }}
            className={`text-left p-3 rounded-xl border transition-colors ${
              filters.categoryId === r._id
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-200 bg-white hover:bg-gray-50'
            }`}
          >
            <p className="text-xs uppercase tracking-wide text-gray-500">{r.label}</p>
            <p className="text-lg font-semibold text-gray-800 mt-1">{formatINR(r.amount)}</p>
            <p className="text-xs text-gray-400">{r.count} entries</p>
          </button>
        ))}
        <div className="p-3 rounded-xl bg-primary-600 text-white">
          <p className="text-xs uppercase tracking-wide text-primary-100">Total ({filters.from || 'all'} → {filters.to || 'all'})</p>
          <p className="text-lg font-semibold mt-1">{formatINR(summary.grandTotal)}</p>
          <p className="text-xs text-primary-100">{summary.rows.reduce((a, r) => a + r.count, 0)} entries</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-5 gap-3">
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
            <select value={filters.referenceId}
              onChange={(e) => { setFilters((f) => ({ ...f, referenceId: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All references</option>
              {references.map((r) => <option key={r._id} value={r._id}>{r.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
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
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Reference</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((e) => (
                  <tr key={e._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{e.category?.label}</span>
                        {e.sourceType && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-amber-50 text-amber-700 rounded" title={`Auto-created from ${e.sourceType}`}>AUTO</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-gray-600">{e.reference?.name || <span className="text-gray-300">—</span>}</td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.notes || <span className="text-gray-300">—</span>}</td>
                    <td className={`py-3 px-4 text-right font-medium ${e.amount < 0 ? 'text-red-600' : 'text-gray-800'}`}>
                      {formatINR(e.amount)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {canEdit && !e.sourceType && (
                          <button onClick={() => setModal({ open: true, item: e })}
                            className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded">
                            <HiOutlinePencil className="w-4 h-4" />
                          </button>
                        )}
                        {canDelete && !e.sourceType && (
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
                  <td colSpan={4} className="py-3 px-4 text-right text-xs uppercase text-gray-500 font-semibold">Filtered total</td>
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

      <ExpenseFormModal
        open={modal.open}
        initial={modal.item}
        categories={categories}
        references={references}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default ExpenseList;
