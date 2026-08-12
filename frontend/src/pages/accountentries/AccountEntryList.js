import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSwitchHorizontal } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getJournalEntriesAPI, createJournalEntryAPI, updateJournalEntryAPI, deleteJournalEntryAPI,
  getAccountEntriesAPI,
} from '../../services/api';
import JournalEntryModal from './JournalEntryModal';
import { formatDate as _formatDate } from '../../utils/format';
import usePersistedFilters from '../../hooks/usePersistedFilters';

const formatINR = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const formatDate = (d) => _formatDate(d);

const lineSummary = (lines = []) => lines.map((l) =>
  `${l.accountName} ${l.debit > 0 ? 'Dr ' + formatINR(l.debit) : 'Cr ' + formatINR(l.credit)}`).join('  →  ');

const AccountEntryList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('account_entries', 'create');
  const canEdit = can('account_entries', 'edit');
  const canDelete = can('account_entries', 'delete');

  const [tab, setTab] = usePersistedFilters('journal:tab', 'journal');
  const [items, setItems] = useState([]);
  const [legacy, setLegacy] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [page, setPage] = usePersistedFilters('journal:page', 1);
  const [pageSize, setPageSize] = usePersistedFilters('journal:pageSize', 25);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = usePersistedFilters('journal:filters', { from: '', to: '', q: '' });

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const params = useMemo(() => ({
    page, limit: pageSize, from: filters.from || undefined, to: filters.to || undefined, q: filters.q || undefined,
  }), [page, pageSize, filters]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      if (tab === 'journal') {
        const r = await getJournalEntriesAPI(params);
        setItems(r.data.entries); setTotal(r.data.total);
      } else {
        const r = await getAccountEntriesAPI({ from: filters.from || undefined, to: filters.to || undefined, limit: 200 });
        setLegacy(r.data.entries); setTotal(r.data.total);
      }
    } catch { toast.error('Failed to load entries'); } finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, [params, tab]);

  const handleSave = async (form) => {
    try {
      if (modal.item) { await updateJournalEntryAPI(modal.item._id, form); toast.success('Journal updated'); }
      else { await createJournalEntryAPI(form); toast.success('Journal added'); }
      setModal({ open: false, item: null }); fetchAll();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to save'); throw e; }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete ${item.refNumber}?`, { title: 'Delete Journal', confirmLabel: 'Delete' }))) return;
    try { await deleteJournalEntryAPI(item._id); toast.success('Deleted'); fetchAll(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete'); }
  };

  const Tab = ({ id, label }) => (
    <button onClick={() => { setTab(id); setPage(1); }}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2 border-b border-gray-100">
          <Tab id="journal" label="Journal Entries" />
          <Tab id="legacy" label="Legacy" />
        </div>
        {tab === 'journal' && canCreate && (
          <button onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-4 h-4" /> Add Entry
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(1); }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
          </div>
          {tab === 'journal' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Search</label>
              <input value={filters.q} onChange={(e) => { setFilters((f) => ({ ...f, q: e.target.value })); setPage(1); }}
                placeholder="Ref / description / account…" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          )}
        </div>

        {tab === 'legacy' && (
          <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
            Legacy account entries (read-only). New entries use Journal Entries.
          </p>
        )}

        {loading ? (
          <div className="py-8 text-center text-gray-400">Loading...</div>
        ) : tab === 'journal' ? (
          items.length === 0 ? <div className="py-8 text-center text-gray-400">No journal entries in this range</div> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Ref</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Entry</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((e) => (
                    <tr key={e._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="py-3 px-4 font-medium text-gray-700 whitespace-nowrap">{e.refNumber}</td>
                      <td className="py-3 px-4 text-gray-700 text-sm">{lineSummary(e.lines)}</td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.description || <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          {canEdit && <button onClick={() => setModal({ open: true, item: e })} className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded"><HiOutlinePencil className="w-4 h-4" /></button>}
                          {canDelete && <button onClick={() => handleDelete(e)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"><HiOutlineTrash className="w-4 h-4" /></button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          legacy.length === 0 ? <div className="py-8 text-center text-gray-400">No legacy entries in this range</div> : (
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
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {legacy.map((e) => (
                    <tr key={e._id} className="hover:bg-gray-50">
                      <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                      <td className="py-3 px-4"><span className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-700">{e.entryType?.toUpperCase()}</span></td>
                      <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.debit > 0 ? formatINR(e.debit) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-right text-gray-700">{e.entryType === 'general' && e.credit > 0 ? formatINR(e.credit) : <span className="text-gray-300">—</span>}</td>
                      <td className="py-3 px-4 text-gray-700">
                        {e.entryType === 'contra' ? (
                          <span className="inline-flex items-center gap-1"><span className="font-medium">{e.fromMode?.toUpperCase()}</span><HiOutlineSwitchHorizontal className="w-3.5 h-3.5 text-gray-400" /><span className="font-medium">{e.toMode?.toUpperCase()}</span><span className="ml-2 text-gray-500">{formatINR(e.amount)}</span></span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-gray-600 max-w-xs truncate">{e.remarks || <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {!loading && tab === 'journal' && total > 0 && (
          <PaginationBar page={page} pages={pages} total={total} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      <JournalEntryModal open={modal.open} initial={modal.item}
        onClose={() => setModal({ open: false, item: null })} onSave={handleSave} />
    </div>
  );
};

export default AccountEntryList;
