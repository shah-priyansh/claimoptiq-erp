import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineCash, HiOutlineCreditCard, HiOutlineQrcode } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getCashBankAPI, getCashBankBalancesAPI, createCashBankAPI, updateCashBankAPI, deleteCashBankAPI,
  getInvoicesAPI, getExpensesAPI, getBankAccountsAPI,
} from '../../services/api';
import CashBankFormModal from './CashBankFormModal';
import { formatDate as _formatDate } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const MODE_ICONS = { cash: HiOutlineCash, bank: HiOutlineCreditCard, upi: HiOutlineQrcode };

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
  const [page, setPage] = usePersistedFilters('cashbank:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('cashbank:pageSize', 25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = usePersistedFilters('cashbank:filters', { direction: '', mode: '', from: monthStart(), to: todayIso(), q: '' });

  const pages = Math.max(1, Math.ceil(total / pageSize));

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
    // Load invoice/expense pickers (best-effort)
    getInvoicesAPI({ limit: 200 }).then(({ data }) => setInvoices((data.invoices || []).filter((i) => i.status === 'issued' || i.status === 'partially_paid'))).catch(() => {}).finally(() => setLoadingInvoices(false));
    getExpensesAPI({ limit: 200 }).then(({ data }) => setExpenses(data.expenses || [])).catch(() => {}).finally(() => setLoadingExpenses(false));
    getBankAccountsAPI({ active: 'true' }).then(({ data }) => setBankAccounts(data || [])).catch(() => setBankAccounts([])).finally(() => setLoadingBankAccounts(false));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params]);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateCashBankAPI(modal.item._id, form);
        toast.success('Entry updated');
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
      {canCreate && (
        <div className="flex justify-end mb-4 gap-2">
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Entry
          </button>
        </div>
      )}

      {/* Balances strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { key: 'cash', label: 'Cash', icon: HiOutlineCash },
          { key: 'bank', label: 'Bank', icon: HiOutlineCreditCard },
          { key: 'upi',  label: 'UPI',  icon: HiOutlineQrcode },
        ].map((b) => (
          <div key={b.key} className="bg-white p-3 rounded-xl border border-gray-200">
            <div className="flex items-center gap-2">
              <b.icon className="w-4 h-4 text-primary-600" />
              <p className="text-xs uppercase tracking-wide text-gray-500">{b.label}</p>
            </div>
            <p className={`text-lg font-semibold mt-1 ${balances[b.key] < 0 ? 'text-red-600' : 'text-gray-800'}`}>
              {formatINR(balances[b.key])}
            </p>
          </div>
        ))}
        <div className="p-3 rounded-xl bg-primary-600 text-white">
          <p className="text-xs uppercase tracking-wide text-primary-100">Total on hand</p>
          <p className="text-lg font-semibold mt-1">{formatINR(balances.total)}</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Direction</label>
            <select value={filters.direction}
              onChange={(e) => { setFilters((f) => ({ ...f, direction: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All</option>
              <option value="in">IN</option>
              <option value="out">OUT</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mode</label>
            <select value={filters.mode}
              onChange={(e) => { setFilters((f) => ({ ...f, mode: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All</option>
              <option value="cash">Cash</option>
              <option value="bank">Bank</option>
              <option value="upi">UPI</option>
            </select>
          </div>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
            <input value={filters.q}
              onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
              placeholder="UTR / cheque / notes"
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
        </div>

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : items.length === 0 ? (
          <div className="py-8 text-center text-gray-400">No entries in this range</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Direction</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Mode</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Link</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">UTR / Cheque</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Notes</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((e) => {
                  const Icon = MODE_ICONS[e.mode] || HiOutlineCash;
                  return (
                    <tr key={e._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${e.direction === 'in' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                          {e.direction.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-700">
                          <Icon className="w-3.5 h-3.5" /> {e.mode.toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {e.invoice && <span>{e.invoice.invoiceNumber || 'Invoice'} · {e.invoice.hospital?.name}</span>}
                        {e.expense && <span>Expense · {e.expense.category?.label}</span>}
                        {!e.invoice && !e.expense && <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-500 text-xs font-mono">
                        {e.utrNumber || e.chequeNumber || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.notes || <span className="text-gray-300">—</span>}</td>
                      <td className={`py-3 px-4 text-right font-medium ${e.direction === 'in' ? 'text-green-700' : 'text-red-700'}`}>
                        {e.direction === 'in' ? '+' : '−'}{formatINR(e.amount)}
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

      <CashBankFormModal
        open={modal.open}
        initial={modal.item}
        invoices={invoices}
        expenses={expenses}
        bankAccounts={bankAccounts}
        loadingInvoices={loadingInvoices}
        loadingExpenses={loadingExpenses}
        loadingBankAccounts={loadingBankAccounts}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default CashBankList;
