import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlineX } from 'react-icons/hi';
import { createAccountAPI, createPartyAPI, createBankAccountAPI } from '../../services/api';
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

const blank = { accountType: 'fixed_asset', name: '', accountCode: '', openingBalance: '', openingType: 'debit', asOfDate: '' };

// Add a Chart-of-Accounts account. `onCreated(ref)` fires after a successful
// save; `ref` is the new account keyed for the Journal Entry picker
// ({ kind, id, name }) so callers can auto-select it. `defaultType` seeds the
// Account Type dropdown (e.g. 'fixed_asset').
const AddAccountModal = ({ open, onClose, onCreated, defaultType }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) setForm({ ...blank, accountType: defaultType || blank.accountType });
  }, [open, defaultType]);
  if (!open) return null;

  const typeDef = ACCOUNT_TYPES.find((t) => t.value === form.accountType) || ACCOUNT_TYPES[0];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Account name is required'); return; }
    setSaving(true);
    try {
      const opening = Number(form.openingBalance) || 0;
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
      toast.error(err.response?.data?.message || 'Failed to add account');
    } finally { setSaving(false); }
  };

  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const label = 'block text-xs font-medium text-gray-500 mb-1';
  const showCode = typeDef.route === 'account';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">Add Account</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className={label}>Account Type *</label>
            <SearchableSelect
              options={ACCOUNT_TYPES.map((t) => ({ value: t.value, label: t.label, group: t.group }))}
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
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving || !form.name.trim()} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAccountModal;
