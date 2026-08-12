import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlineX, HiOutlineLibrary, HiOutlineCreditCard, HiOutlineCash,
  HiOutlineOfficeBuilding, HiOutlineChevronDown, HiOutlineChevronRight,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import {
  getChartOfAccountsAPI, createAccountAPI, createPartyAPI, createBankAccountAPI,
} from '../../services/api';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

const NATURE_CLS = {
  expense: 'bg-gray-100 text-gray-600', capital: 'bg-indigo-50 text-indigo-700', fixed_asset: 'bg-teal-50 text-teal-700',
};
const KIND_ICON = {
  bank: HiOutlineCreditCard, cash: HiOutlineCash, sundry_debtors: HiOutlineOfficeBuilding, sundry_creditors: HiOutlineOfficeBuilding,
};

// A single account row (name + code + nature badge + balance).
const AccountRow = ({ a }) => {
  const Icon = KIND_ICON[a.kind] || HiOutlineLibrary;
  return (
    <div className="flex items-center justify-between px-4 py-2.5 hover:bg-gray-50">
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="text-sm text-gray-700 truncate">{a.name}</span>
        {a.code && <span className="text-[11px] text-gray-400 font-mono">{a.code}</span>}
        {a.nature && a.nature !== 'expense' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${NATURE_CLS[a.nature] || ''}`}>
            {a.nature === 'fixed_asset' ? 'Fixed Asset' : 'Capital'}
          </span>
        )}
      </span>
      <span className={`text-sm font-medium whitespace-nowrap ${a.balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(a.balance)}</span>
    </div>
  );
};

// Cluster a group's accounts by subgroup. Honours a declared `subgroupOrder`
// (so empty sub-groups still render as structure), then appends any extras.
const subgroupsOf = (g) => {
  const map = new Map();
  const order = [];
  for (const a of g.accounts) {
    const key = a.subgroup || '';
    if (!map.has(key)) { map.set(key, []); order.push(key); }
    map.get(key).push(a);
  }
  const declared = g.subgroupOrder || [];
  const keys = [...declared, ...order.filter((k) => !declared.includes(k))];
  return keys.map((k) => [k, map.get(k) || []]);
};

// Account Type options for "Add Account" — each routes to the right create API.
const ACCOUNT_TYPES = [
  { value: 'fixed_asset',      label: 'Assets / Fixed Assets',                  route: 'account' },
  { value: 'current_asset',    label: 'Assets / Current Assets',                route: 'account' },
  { value: 'non_current_asset', label: 'Assets / Non-Current Assets',           route: 'account' },
  { value: 'bank',             label: 'Current Assets / Bank Accounts',         route: 'bank' },
  { value: 'sundry_debtor',    label: 'Current Assets / Sundry Debtors',        route: 'party', openingType: 'to_collect' },
  { value: 'sundry_creditor',  label: 'Current Liabilities / Sundry Creditors', route: 'party', openingType: 'to_pay' },
  { value: 'loan',             label: 'Liabilities / Loan Accounts',            route: 'account' },
  { value: 'capital',          label: 'Equity / Capital',                       route: 'account' },
  { value: 'income',           label: 'Income',                                 route: 'account', openingType: 'credit' },
  { value: 'other',            label: 'Other Account',                          route: 'account' },
];

const blank = { accountType: 'fixed_asset', name: '', accountCode: '', openingBalance: '', openingType: 'debit', asOfDate: '' };

const AddAccountModal = ({ open, onClose, onCreated }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(blank); }, [open]);
  if (!open) return null;

  const typeDef = ACCOUNT_TYPES.find((t) => t.value === form.accountType) || ACCOUNT_TYPES[0];
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error('Account name is required'); return; }
    setSaving(true);
    try {
      const opening = Number(form.openingBalance) || 0;
      if (typeDef.route === 'bank') {
        await createBankAccountAPI({ bankName: form.name });
      } else if (typeDef.route === 'party') {
        await createPartyAPI({ name: form.name, openingBalance: opening, openingType: typeDef.openingType });
      } else {
        await createAccountAPI({
          name: form.name, accountType: form.accountType, accountCode: form.accountCode,
          openingBalance: opening, openingType: form.openingType, asOfDate: form.asOfDate || null,
        });
      }
      toast.success('Account added');
      onCreated();
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
            <select value={form.accountType}
              onChange={(e) => { const v = e.target.value; setForm((f) => ({ ...f, accountType: v, openingType: v === 'income' ? 'credit' : 'debit' })); }}
              className={input}>
              {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Account Name *</label>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={input} placeholder="Enter account name" />
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
                    <select value={form.openingType} onChange={(e) => set('openingType', e.target.value)} className="px-2 py-2 border border-gray-300 rounded-lg text-sm">
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

const ChartOfAccounts = () => {
  const { can } = useAuth();
  const canCreate = can('chart_of_accounts', 'create');

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [collapsed, setCollapsed] = useState({});

  const load = () => {
    setLoading(true);
    getChartOfAccountsAPI()
      .then(({ data }) => setGroups(data.groups || []))
      .catch(() => toast.error('Failed to load chart of accounts'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const toggle = (key) => setCollapsed((c) => ({ ...c, [key]: !c[key] }));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Chart of Accounts</h1>
        {canCreate && (
          <button onClick={() => setAddOpen(true)}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors">
            <HiOutlinePlus className="w-4 h-4" /> Add Account
          </button>
        )}
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400">Loading...</div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const isCollapsed = collapsed[g.key];
            return (
              <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => toggle(g.key)} className="w-full flex items-center justify-between px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
                  <span className="flex items-center gap-2">
                    {isCollapsed ? <HiOutlineChevronRight className="w-4 h-4 text-gray-400" /> : <HiOutlineChevronDown className="w-4 h-4 text-gray-400" />}
                    <span className="text-sm font-semibold text-gray-700 uppercase tracking-wide">{g.label}</span>
                    <span className="text-xs text-gray-400">({g.accounts.length})</span>
                  </span>
                  <span className={`text-sm font-semibold ${g.total < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(g.total)}</span>
                </button>
                {!isCollapsed && (
                  (g.subgroupOrder?.length || g.accounts.some((a) => a.subgroup)) ? (
                    <div>
                      {subgroupsOf(g).map(([sub, accts]) => (
                        <div key={sub || 'none'}>
                          <div className="flex items-center justify-between px-4 py-1.5 bg-gray-50 border-y border-gray-100">
                            <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{sub || 'Other'}</span>
                            <span className="text-xs font-medium text-gray-500">{formatINR(accts.reduce((s, a) => s + a.balance, 0))}</span>
                          </div>
                          {accts.length === 0 ? (
                            <div className="px-4 py-2 text-xs text-gray-300">No accounts</div>
                          ) : (
                            <div className="divide-y divide-gray-50">
                              {accts.map((a) => <AccountRow key={`${a.kind}-${a.id}`} a={a} />)}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : g.accounts.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-gray-400">No accounts</div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {g.accounts.map((a) => <AccountRow key={`${a.kind}-${a.id}`} a={a} />)}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddAccountModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); load(); }} />
    </div>
  );
};

export default ChartOfAccounts;
