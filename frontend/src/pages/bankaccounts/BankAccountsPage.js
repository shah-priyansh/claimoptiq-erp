import React, { useEffect, useMemo, useState } from 'react';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineSearch,
  HiOutlineCreditCard, HiOutlineChevronDown, HiOutlineX,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import PaginationBar from '../../components/ui/PaginationBar';
import {
  getBankAccountsAPI, getBankAccountBalancesAPI, createBankAccountAPI,
  getCashBankAPI, createCashBankAPI, updateCashBankAPI, deleteCashBankAPI,
  getInvoicesAPI, getExpensesAPI,
} from '../../services/api';
import CashBankFormModal from '../cashbank/CashBankFormModal';
import { formatDateTime } from '../../utils/format';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Human label + counterparty for a cash/bank entry row.
const txnName = (e) => {
  if (e.invoice) return e.invoice.hospital?.name || e.invoice.invoiceNumber || 'Invoice';
  if (e.expense) return e.expense.category?.label || 'Expense';
  return e.hospital?.name || e.notes || '—';
};

// Small modal to create a new bank account (mirrors the Settings fields).
const AddBankModal = ({ open, onClose, onCreated }) => {
  const blank = { bankName: '', accountHolder: '', accountNumber: '', ifsc: '', upiId: '' };
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(blank); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.bankName.trim()) { toast.error('Bank name is required'); return; }
    setSaving(true);
    try {
      const { data } = await createBankAccountAPI(form);
      toast.success('Bank account added');
      onCreated(data);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to add bank');
    } finally { setSaving(false); }
  };

  const field = (label, key, extra = {}) => (
    <div className={extra.full ? 'md:col-span-2' : ''}>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{extra.required && ' *'}</label>
      <input value={form[key]}
        onChange={(ev) => setForm((f) => ({ ...f, [key]: extra.upper ? ev.target.value.toUpperCase() : ev.target.value }))}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">Add Bank Account</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {field('Bank Name', 'bankName', { required: true })}
            {field('Account Holder', 'accountHolder')}
            {field('Account Number', 'accountNumber')}
            {field('IFSC Code', 'ifsc', { upper: true })}
            {field('UPI ID', 'upiId', { full: true })}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.bankName.trim()}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Add Bank'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const BankAccountsPage = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('cash_bank', 'create');
  const canEdit = can('cash_bank', 'edit');
  const canDelete = can('cash_bank', 'delete');
  const canAddBank = can('settings', 'edit');

  const [accounts, setAccounts] = useState([]);
  const [balances, setBalances] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [accountSearch, setAccountSearch] = useState('');

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [txnSearch, setTxnSearch] = useState('');
  const [loadingTxns, setLoadingTxns] = useState(false);

  const [invoices, setInvoices] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [modal, setModal] = useState({ open: false, item: null, defaults: null, lockDirection: null });
  const [addBankOpen, setAddBankOpen] = useState(false);
  const [depositMenu, setDepositMenu] = useState(false);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const selected = accounts.find((a) => a._id === selectedId) || null;

  const loadAccounts = async (selectId) => {
    try {
      const [accRes, balRes] = await Promise.all([
        getBankAccountsAPI(),
        getBankAccountBalancesAPI(),
      ]);
      const list = accRes.data || [];
      setAccounts(list);
      setBalances(balRes.data || {});
      setSelectedId((cur) => selectId || cur || (list[0]?._id ?? null));
    } catch {
      toast.error('Failed to load bank accounts');
    }
  };

  useEffect(() => {
    loadAccounts();
    // Pickers for the Deposit/Withdraw modal's optional invoice/expense link.
    // '__open' = every still-owed invoice, so the picker can find any of them.
    getInvoicesAPI({ status: '__open', limit: 5000 }).then(({ data }) => setInvoices(data.invoices || [])).catch(() => {});
    getExpensesAPI({ limit: 200, unlinkedOnly: 'true' }).then(({ data }) => setExpenses(data.expenses || [])).catch(() => {});
  }, []);

  const txnParams = useMemo(() => ({
    bankAccountId: selectedId || undefined,
    page, limit: pageSize,
    q: txnSearch || undefined,
  }), [selectedId, page, pageSize, txnSearch]);

  const loadTxns = async () => {
    if (!selectedId) { setItems([]); setTotal(0); return; }
    setLoadingTxns(true);
    try {
      const { data } = await getCashBankAPI(txnParams);
      setItems(data.entries);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load transactions');
    } finally { setLoadingTxns(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadTxns(); }, [txnParams]);
  // Reset to first page whenever the selected account changes.
  useEffect(() => { setPage(1); }, [selectedId]);

  const openDeposit = (direction) => {
    setDepositMenu(false);
    setModal({
      open: true, item: null, lockDirection: direction,
      defaults: { direction, mode: 'bank', bankAccountId: selectedId },
    });
  };

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateCashBankAPI(modal.item._id, form);
        toast.success('Transaction updated');
      } else {
        await createCashBankAPI(form);
        toast.success('Transaction added');
      }
      setModal({ open: false, item: null, defaults: null, lockDirection: null });
      await Promise.all([loadTxns(), loadAccounts(selectedId)]);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
      throw e;
    }
  };

  const handleDelete = async (item) => {
    if (!(await confirm(`Delete this ${item.direction.toUpperCase()} entry of ${formatINR(item.amount)}?`, { title: 'Delete Transaction', confirmLabel: 'Delete' }))) return;
    try {
      await deleteCashBankAPI(item._id);
      toast.success('Deleted');
      await Promise.all([loadTxns(), loadAccounts(selectedId)]);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    }
  };

  const visibleAccounts = accounts.filter((a) => {
    if (!accountSearch.trim()) return true;
    const q = accountSearch.trim().toLowerCase();
    return (a.bankName || '').toLowerCase().includes(q)
      || (a.accountNumber || '').toLowerCase().includes(q)
      || String(balances[a._id] ?? '').includes(q);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Bank Accounts</h1>
        {canAddBank && (
          <button onClick={() => setAddBankOpen(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Bank
          </button>
        )}
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Left: account list */}
        <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)]">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={accountSearch} onChange={(e) => setAccountSearch(e.target.value)}
                placeholder="Search by account / amount"
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm" />
            </div>
          </div>
          <div className="divide-y divide-gray-100 flex-1 min-h-0 overflow-y-auto">
            {visibleAccounts.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-gray-400">No bank accounts</div>
            ) : visibleAccounts.map((a) => {
              const bal = balances[a._id] ?? 0;
              return (
                <button key={a._id} onClick={() => setSelectedId(a._id)}
                  className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
                    selectedId === a._id ? 'bg-primary-50 border-l-4 border-primary-500' : 'hover:bg-gray-50 border-l-4 border-transparent'
                  }`}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.bankName}</p>
                    {(a.accountNumber || a.isDefault) && (
                      <p className="text-[11px] text-gray-400 truncate">
                        {a.accountNumber ? `A/C ${a.accountNumber}` : ''}{a.isDefault ? `${a.accountNumber ? ' · ' : ''}Default` : ''}
                      </p>
                    )}
                  </div>
                  <span className={`text-sm font-semibold whitespace-nowrap ${bal < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {formatINR(bal)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: selected account detail + transactions */}
        <div className="col-span-12 md:col-span-8 lg:col-span-9 space-y-4">
          {!selected ? (
            <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
              <HiOutlineCreditCard className="w-10 h-10 mx-auto mb-2 text-gray-300" />
              Select a bank account to see its transactions.
            </div>
          ) : (
            <>
              {/* Account header + details */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-800">{selected.bankName}</h2>
                    <p className={`text-sm font-semibold mt-0.5 ${(balances[selected._id] ?? 0) < 0 ? 'text-red-600' : 'text-green-600'}`}>
                      Balance: {formatINR(balances[selected._id] ?? 0)}
                    </p>
                  </div>
                  {canCreate && (
                    <div className="relative">
                      <button onClick={() => setDepositMenu((v) => !v)}
                        className="flex items-center gap-2 border border-primary-300 text-primary-700 hover:bg-primary-50 px-4 py-2 rounded-lg text-sm font-medium">
                        Deposit / Withdraw <HiOutlineChevronDown className="w-4 h-4" />
                      </button>
                      {depositMenu && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setDepositMenu(false)} />
                          <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                            <button onClick={() => openDeposit('in')} className="w-full text-left px-3 py-2 text-sm text-green-700 hover:bg-green-50">Deposit (money in)</button>
                            <button onClick={() => openDeposit('out')} className="w-full text-left px-3 py-2 text-sm text-red-700 hover:bg-red-50">Withdraw (money out)</button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
                  {[
                    ['Account Holder', selected.accountHolder || '—'],
                    ['Account Number', selected.accountNumber || '—'],
                    ['IFSC Code', selected.ifsc || '—'],
                    ['UPI ID', selected.upiId || '—'],
                  ].map(([l, v]) => (
                    <div key={l}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{l}</p>
                      <p className="text-sm text-gray-700 mt-0.5 truncate">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transactions */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-700">Transactions</h3>
                  <div className="relative w-56 max-w-full">
                    <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input value={txnSearch} onChange={(e) => { setTxnSearch(e.target.value); setPage(1); }}
                      placeholder="Search notes / UTR / cheque"
                      className="w-full pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
                  </div>
                </div>

                {loadingTxns ? (
                  <Loader label="Loading…" className="py-8" />
                ) : items.length === 0 ? (
                  <div className="py-8 text-center text-gray-400">No transactions for this account</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Name</th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Amount</th>
                          <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((e) => (
                          <tr key={e._id} className="hover:bg-gray-50">
                            <td className="py-3 px-4 whitespace-nowrap">
                              <span className={`text-xs font-medium px-2 py-0.5 rounded ${e.direction === 'in' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                                {e.direction === 'in' ? 'Payment-In' : 'Payment-Out'}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-gray-700 max-w-xs truncate">{txnName(e)}</td>
                            <td className="py-3 px-4 text-gray-600 whitespace-nowrap">{formatDateTime(e.date)}</td>
                            <td className={`py-3 px-4 text-right font-medium whitespace-nowrap ${e.direction === 'in' ? 'text-green-700' : 'text-red-700'}`}>
                              {e.direction === 'in' ? '+' : '−'}{formatINR(e.amount)}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="flex justify-end gap-1">
                                {canEdit && (
                                  <button onClick={() => setModal({ open: true, item: e, defaults: null, lockDirection: null })}
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

                {!loadingTxns && total > 0 && (
                  <PaginationBar
                    page={page} pages={pages} total={total}
                    pageSize={pageSize} onPageChange={setPage} onPageSizeChange={setPageSize}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <CashBankFormModal
        open={modal.open}
        initial={modal.item}
        defaults={modal.defaults}
        lockDirection={modal.lockDirection}
        invoices={invoices}
        expenses={expenses}
        bankAccounts={accounts}
        onClose={() => setModal({ open: false, item: null, defaults: null, lockDirection: null })}
        onSave={handleSave}
      />

      <AddBankModal
        open={addBankOpen}
        onClose={() => setAddBankOpen(false)}
        onCreated={(created) => { setAddBankOpen(false); loadAccounts(created._id); }}
      />
    </div>
  );
};

export default BankAccountsPage;
