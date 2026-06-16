import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineCheck, HiOutlineStar, HiStar as HiStarSolid } from 'react-icons/hi';
import {
  getBankAccountsAPI, createBankAccountAPI, updateBankAccountAPI,
  deleteBankAccountAPI, setDefaultBankAccountAPI,
} from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const blankRow = () => ({
  _id: null,
  _draft: true,         // true until first save → no API id yet
  _dirty: true,
  bankName: '',
  accountHolder: '',
  accountNumber: '',
  ifsc: '',
  upiId: '',
  isDefault: false,
  isActive: true,
});

const BankAccountsSection = () => {
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await getBankAccountsAPI();
      setAccounts(data.map((a) => ({ ...a, _dirty: false, _draft: false })));
    } catch {
      toast.error('Failed to load bank accounts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const patchRow = (idx, patch) => {
    setAccounts((arr) => arr.map((a, i) => i === idx ? { ...a, ...patch, _dirty: true } : a));
  };

  const addRow = () => {
    // First row is automatically the default — the backend enforces "at least
    // one default" and the UI mirrors that so the operator isn't surprised.
    setAccounts((arr) => [...arr, { ...blankRow(), isDefault: arr.length === 0 }]);
  };

  const removeRow = async (idx) => {
    const row = accounts[idx];
    if (row._draft) {
      // Local-only row, just drop it from state.
      setAccounts((arr) => arr.filter((_, i) => i !== idx));
      return;
    }
    if (row.isDefault) {
      toast.error('Promote another account as default before deleting this one.');
      return;
    }
    if (!(await confirm(`Delete ${row.bankName || 'this bank account'}?`, { title: 'Delete bank account', confirmLabel: 'Delete', variant: 'danger' }))) return;
    setSavingId(row._id);
    try {
      const { data } = await deleteBankAccountAPI(row._id);
      if (data && data.softDeleted) {
        toast.info('Account marked inactive (it has linked cash/bank entries).');
        load();
      } else {
        toast.success('Bank account deleted');
        setAccounts((arr) => arr.filter((_, i) => i !== idx));
      }
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to delete');
    } finally {
      setSavingId(null);
    }
  };

  const saveRow = async (idx) => {
    const row = accounts[idx];
    if (!row.bankName.trim()) {
      toast.error('Bank name is required');
      return;
    }
    setSavingId(row._id || `new-${idx}`);
    try {
      const payload = {
        bankName: row.bankName,
        accountHolder: row.accountHolder,
        accountNumber: row.accountNumber,
        ifsc: row.ifsc,
        upiId: row.upiId,
        isActive: row.isActive,
      };
      if (row.isDefault) payload.isDefault = true;
      const { data } = row._draft
        ? await createBankAccountAPI(payload)
        : await updateBankAccountAPI(row._id, payload);
      toast.success('Bank account saved');
      // Re-load to reflect server-canonical default/order state across all rows.
      load();
      return data;
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
    } finally {
      setSavingId(null);
    }
  };

  const promoteDefault = async (idx) => {
    const row = accounts[idx];
    if (row.isDefault) return;
    if (row._draft) {
      // For an unsaved row, just toggle locally — saving will mark it default.
      setAccounts((arr) => arr.map((a, i) => ({ ...a, isDefault: i === idx, _dirty: i === idx ? true : a._dirty })));
      return;
    }
    setSavingId(row._id);
    try {
      await setDefaultBankAccountAPI(row._id);
      toast.success('Default bank account updated');
      load();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to set default');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-gray-700">Bank Accounts</h2>
          <p className="text-xs text-gray-500 mt-1">
            Add every account you receive payments into. The one marked Default appears on the
            invoice footer (with its UPI QR). All accounts are pickable in the Cash/Bank entry modal.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-white border border-primary-600 hover:bg-primary-50 rounded-lg whitespace-nowrap"
        >
          <HiOutlinePlus className="w-4 h-4" /> Add Account
        </button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-sm text-gray-400">Loading…</div>
      ) : accounts.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg">
          No bank accounts yet. Click "Add Account" to set one up.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a, idx) => (
            <div
              key={a._id || `draft-${idx}`}
              className={`border rounded-xl p-4 ${a.isDefault ? 'border-primary-200 bg-primary-50/30' : 'border-gray-200'}`}
            >
              <div className="flex items-center justify-between mb-3">
                <button
                  type="button"
                  onClick={() => promoteDefault(idx)}
                  disabled={a.isDefault || savingId !== null}
                  className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${
                    a.isDefault ? 'text-primary-700' : 'text-gray-500 hover:text-primary-600'
                  } disabled:opacity-80`}
                >
                  {a.isDefault ? <HiStarSolid className="w-4 h-4 text-primary-600" /> : <HiOutlineStar className="w-4 h-4" />}
                  {a.isDefault ? 'Default' : 'Make default'}
                </button>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={a.isActive}
                      onChange={(e) => patchRow(idx, { isActive: e.target.checked })}
                      className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    Active
                  </label>
                  <button
                    type="button"
                    onClick={() => saveRow(idx)}
                    disabled={!a._dirty || savingId !== null}
                    className="flex items-center gap-1 px-3 py-1 text-xs font-medium bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded"
                  >
                    <HiOutlineCheck className="w-3.5 h-3.5" /> Save
                  </button>
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={savingId !== null}
                    title="Delete account"
                    className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-40"
                  >
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Bank Name *</label>
                  <input value={a.bankName} onChange={(e) => patchRow(idx, { bankName: e.target.value })} className={inputCls} placeholder="e.g. HDFC Bank, Nanpura" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Holder</label>
                  <input value={a.accountHolder} onChange={(e) => patchRow(idx, { accountHolder: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Account Number</label>
                  <input value={a.accountNumber} onChange={(e) => patchRow(idx, { accountNumber: e.target.value })} className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">IFSC Code</label>
                  <input value={a.ifsc} onChange={(e) => patchRow(idx, { ifsc: e.target.value.toUpperCase() })} className={inputCls} />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">UPI ID</label>
                  <input value={a.upiId} onChange={(e) => patchRow(idx, { upiId: e.target.value })} className={inputCls} placeholder="e.g. company@hdfc — enables the QR on the invoice when this is the default account" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BankAccountsSection;
