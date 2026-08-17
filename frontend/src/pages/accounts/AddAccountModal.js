import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlineX, HiOutlineTrash } from 'react-icons/hi';
import {
  createAccountAPI, createPartyAPI, createBankAccountAPI,
  updateAccountAPI, deleteAccountAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import SearchableSelect from '../../components/ui/SearchableSelect';

// Account Type options for "Add Account" — each routes to the right create API.
// Grouped by top-level head (Assets / Liabilities / Equity / Incomes) to mirror
// the Vyapar-style account tree in the picker.
export const ACCOUNT_TYPES = [
  { value: 'fixed_asset',       label: 'Fixed Assets',       group: 'Assets',      route: 'account' },
  { value: 'current_asset',     label: 'Current Assets',     group: 'Assets',      route: 'account' },
  { value: 'non_current_asset', label: 'Non-Current Assets', group: 'Assets',      route: 'account' },
  { value: 'bank',              label: 'Bank Accounts',      group: 'Assets',      route: 'bank' },
  { value: 'sundry_debtor',     label: 'Sundry Debtors',     group: 'Assets',      route: 'party', openingType: 'to_collect' },
  { value: 'sundry_creditor',   label: 'Sundry Creditors',   group: 'Liabilities', route: 'party', openingType: 'to_pay' },
  { value: 'loan',              label: 'Loan Accounts',      group: 'Liabilities', route: 'account' },
  { value: 'capital',           label: 'Capital',            group: 'Equity',      route: 'account' },
  { value: 'income',            label: 'Income',             group: 'Incomes',     route: 'account', openingType: 'credit' },
  { value: 'other',             label: 'Other Account',      group: 'Other',       route: 'account' },
];

// Only ledger accounts (route 'account') can be edited here — Bank/Party rows in
// the chart come from their own tables and are managed elsewhere.
const EDIT_TYPES = ACCOUNT_TYPES.filter((t) => t.route === 'account');

const blank = { accountType: 'fixed_asset', name: '', accountCode: '', openingBalance: '', openingType: 'debit', asOfDate: '' };

// Add / edit a Chart-of-Accounts account.
// - Create mode (no `account` prop): `onCreated(ref)` fires after a successful
//   save; `ref` is the new account keyed for the Journal Entry picker
//   ({ kind, id, name }) so callers can auto-select it. `defaultType` seeds the
//   Account Type dropdown (e.g. 'fixed_asset').
// - Edit mode (`account` = a raw ledger Account row): prefills the form and
//   PATCHes on save; `onSaved()` fires after save/delete (falls back to onCreated).
const AddAccountModal = ({ open, onClose, onCreated, onSaved, account, defaultType }) => {
  const { can } = useAuth();
  const isEdit = !!account;
  const canDelete = can('chart_of_accounts', 'delete');
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (account) {
      setForm({
        accountType: account.accountType || account.kind || blank.accountType,
        name: account.name || '',
        accountCode: account.accountCode || account.code || '',
        openingBalance: account.openingBalance != null ? String(account.openingBalance) : '',
        openingType: account.openingType || 'debit',
        asOfDate: account.asOfDate ? String(account.asOfDate).slice(0, 10) : '',
      });
    } else {
      setForm({ ...blank, accountType: defaultType || blank.accountType });
    }
  }, [open, account, defaultType]);
  if (!open) return null;

  const typeOptions = isEdit ? EDIT_TYPES : ACCOUNT_TYPES;
  const typeDef = typeOptions.find((t) => t.value === form.accountType) || typeOptions[0];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const notify = onSaved || onCreated;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Account name is required'); return; }
    setSaving(true);
    try {
      const opening = Number(form.openingBalance) || 0;
      if (isEdit) {
        const { data } = await updateAccountAPI(account.id || account._id, {
          name: form.name, accountType: form.accountType, accountCode: form.accountCode,
          openingBalance: opening, openingType: form.openingType, asOfDate: form.asOfDate || null,
        });
        toast.success('Account updated');
        notify?.({ kind: 'ledger_account', id: data._id || data.id, name: data.name || form.name });
        return;
      }
      let ref;
      if (typeDef.route === 'bank') {
        const { data } = await createBankAccountAPI({ bankName: form.name });
        ref = { kind: 'bank', id: data._id || data.id, name: data.bankName || form.name };
      } else if (typeDef.route === 'party') {
        const { data } = await createPartyAPI({ name: form.name, openingBalance: opening, openingType: typeDef.openingType });
        ref = { kind: 'party', id: data._id || data.id, name: data.name || form.name };
      } else {
        const { data } = await createAccountAPI({
          name: form.name, accountType: form.accountType, accountCode: form.accountCode,
          openingBalance: opening, openingType: form.openingType, asOfDate: form.asOfDate || null,
        });
        ref = { kind: 'ledger_account', id: data._id || data.id, name: data.name || form.name };
      }
      toast.success('Account added');
      onCreated(ref);
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${isEdit ? 'update' : 'add'} account`);
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${account.name || form.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      await deleteAccountAPI(account.id || account._id);
      toast.success('Account deleted');
      notify?.(null);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete account');
    } finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const label = 'block text-xs font-medium text-gray-500 mb-1';
  const showCode = typeDef.route === 'account';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{isEdit ? 'Edit Account' : 'Add Account'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className={label}>Account Type *</label>
            <SearchableSelect
              options={typeOptions.map((t) => ({ value: t.value, label: t.label, group: t.group }))}
              value={form.accountType}
              onChange={(v) => setForm((f) => ({ ...f, accountType: v, openingType: v === 'income' ? 'credit' : 'debit' }))}
              placeholder="Select account type"
              searchPlaceholder="Search account type…"
              required
            />
          </div>
          <div>
            <label className={label}>Account Name *</label>
            <input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder="Enter account name" />
          </div>
          {showCode && (
            <div>
              <label className={label}>Account Code</label>
              <input value={form.accountCode} onChange={(e) => set('accountCode', e.target.value)} className={input} />
            </div>
          )}
          {typeDef.route !== 'bank' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={label}>Opening Balance</label>
                <div className="flex gap-2">
                  <input type="number" value={form.openingBalance} onChange={(e) => set('openingBalance', e.target.value)} placeholder="0" className={input} />
                  {typeDef.route === 'account' && (
                    <select value={form.openingType} onChange={(e) => set('openingType', e.target.value)}
                      className="flex-shrink-0 pl-2.5 pr-7 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                      <option value="debit">Dr</option>
                      <option value="credit">Cr</option>
                    </select>
                  )}
                </div>
              </div>
              {typeDef.route === 'account' && (
                <div>
                  <label className={label}>As of Date</label>
                  <input type="date" value={form.asOfDate} onChange={(e) => set('asOfDate', e.target.value)} className={input} />
                </div>
              )}
            </div>
          )}
          {typeDef.route === 'bank' && (
            <p className="text-xs text-gray-400">Bank account details (A/C no., IFSC, opening balance) can be set under Bank Accounts.</p>
          )}
          <div className="flex justify-between items-center gap-2 pt-2">
            <div>
              {isEdit && canDelete && (
                <button type="button" onClick={remove} disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 rounded-lg">
                  <HiOutlineTrash className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button type="submit" disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
                {saving ? 'Saving...' : (isEdit ? 'Update' : 'Save')}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAccountModal;
