import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSwitchHorizontal } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getAccountEntriesAPI, getAccountEntrySummaryAPI,
  createAccountEntryAPI, updateAccountEntryAPI, deleteAccountEntryAPI,
} from '../../services/api';
import AccountEntryFormModal from './AccountEntryFormModal';
import { formatDate as _formatDate } from '../../utils/format';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const AccountEntryList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('account_entries', 'create');
  const canEdit = can('account_entries', 'edit');
  const canDelete = can('account_entries', 'delete');

  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({ generalDebit: 0, generalCredit: 0, contraCount: 0 });
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({ entryType: '', from: monthStart(), to: todayIso(), q: '' });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const params = useMemo(() => ({
    page, limit: pageSize,
    entryType: filters.entryType || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
    q: filters.q || undefined,
  }), [page, pageSize, filters]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        getAccountEntriesAPI(params),
        getAccountEntrySummaryAPI({ from: filters.from || undefined, to: filters.to || undefined }),
      ]);
      setItems(list.data.entries);
      setTotal(list.data.total);
      setSummary(sum.data);
    } catch {
      toast.error('Failed to load account entries');
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params]);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateAccountEntryAPI(modal.item._id, form);
        toast.success('Entry updated');
      } else {
        await createAccountEntryAPI(form);
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
    const label = item.entryType === 'contra'
      ? `${item.fromMode?.toUpperCase()} → ${item.toMode?.toUpperCase()} ${formatINR(item.amount)}`
      : `Dr ${formatINR(item.debit)} / Cr ${formatINR(item.credit)}`;
    if (!(await confirm(`Delete this ${item.entryType} entry (${label})?`, { title: 'Delete Entry', confirmLabel: 'Delete' }))) return;
    try {
      await deleteAccountEntryAPI(item._id);
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

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-white p-3 rounded-xl border border-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">General — Total Debit</p>
          <p className="text-lg font-semibold mt-1 text-gray-800">{formatINR(summary.generalDebit)}</p>
        </div>
        <div className="bg-white p-3 rounded-xl border border-gray-200">
          <p className="text-xs uppercase tracking-wide text-gray-500">General — Total Credit</p>
          <p className="text-lg font-semibold mt-1 text-gray-800">{formatINR(summary.generalCredit)}</p>
        </div>
        <div className="p-3 rounded-xl bg-primary-600 text-white">
          <p className="text-xs uppercase tracking-wide text-primary-100">Contra Entries</p>
          <p className="text-lg font-semibold mt-1">{summary.contraCount}</p>
          <p className="text-xs text-primary-100">Affects Cash/Bank balances</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
            <select value={filters.entryType}
              onChange={(e) => { setFilters((f) => ({ ...f, entryType: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">All</option>
              <option value="general">General</option>
              <option value="contra">Contra</option>
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Search remarks</label>
            <input value={filters.q}
              onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
              placeholder="Search…"
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
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Debit</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Credit</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Contra</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Remarks</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((e) => (
                  <tr key={e._id} className="hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                    <td className="py-3 px-4">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${e.entryType === 'contra' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-700'}`}>
                        {e.entryType.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.debit > 0 ? formatINR(e.debit) : <span className="text-gray-300">—</span>}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.credit > 0 ? formatINR(e.credit) : <span className="text-gray-300">—</span>}</td>
                    <td className="py-3 px-4 text-gray-700">
                      {e.entryType === 'contra' ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-medium">{e.fromMode?.toUpperCase()}</span>
                          <HiOutlineSwitchHorizontal className="w-3.5 h-3.5 text-gray-400" />
                          <span className="font-medium">{e.toMode?.toUpperCase()}</span>
                          <span className="ml-2 text-gray-500">{formatINR(e.amount)}</span>
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.remarks || <span className="text-gray-300">—</span>}</td>
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

      <AccountEntryFormModal
        open={modal.open}
        initial={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
      />
    </div>
  );
};

export default AccountEntryList;
