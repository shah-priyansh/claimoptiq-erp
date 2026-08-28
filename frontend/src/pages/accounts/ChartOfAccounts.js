import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlineLibrary, HiOutlineCreditCard, HiOutlineCash,
  HiOutlineOfficeBuilding, HiOutlineChevronDown, HiOutlineChevronRight, HiOutlinePencil,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { getChartOfAccountsAPI, getAccountsAPI } from '../../services/api';
import AddAccountModal from './AddAccountModal';

const formatINR = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Chart rows whose `kind` is one of these are backed by an editable ledger
// Account (row.id === Account uuid). Bank/cash/party/expense rows are not.
const EDITABLE_KINDS = new Set(['fixed_asset', 'current_asset', 'non_current_asset', 'capital', 'owner_equity', 'owner_withdrawal', 'loan', 'income', 'other']);

// Drill-down target for a chart row: click-through to the existing list that
// backs the account's balance, pre-filtered. Ledger accounts (EDITABLE_KINDS)
// have no list of their own here — they keep the inline edit pencil instead.
const drillPath = (a) => {
  switch (a.kind) {
    case 'sundry_creditors': return '/parties?balance=payable';    // parties you owe
    case 'sundry_debtors':   return '/parties?balance=receivable';  // parties who owe you
    case 'expense_category': return `/expenses?categoryId=${a.id}`;
    case 'bank':             return '/cash-bank?mode=bank';
    case 'cash':             return '/cash-bank?mode=cash';
    default:                 return null;
  }
};

const NATURE_CLS = {
  expense: 'bg-gray-100 text-gray-600', capital: 'bg-indigo-50 text-indigo-700', fixed_asset: 'bg-teal-50 text-teal-700',
};
const KIND_ICON = {
  bank: HiOutlineCreditCard, cash: HiOutlineCash, sundry_debtors: HiOutlineOfficeBuilding, sundry_creditors: HiOutlineOfficeBuilding,
};

// A single account row (name + code + nature badge + balance). When `onEdit` is
// provided, a hover-revealed pencil surfaces the edit action.
const AccountRow = ({ a, onEdit, onOpen }) => {
  const Icon = KIND_ICON[a.kind] || HiOutlineLibrary;
  return (
    <div
      onClick={onOpen}
      title={onOpen ? 'View details' : undefined}
      className={`group flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 ${onOpen ? 'cursor-pointer' : ''}`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Icon className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className={`text-sm truncate ${onOpen ? 'text-gray-700 group-hover:text-primary-700' : 'text-gray-700'}`}>{a.name}</span>
        {a.code && <span className="text-[11px] text-gray-400 font-mono">{a.code}</span>}
        {a.nature && a.nature !== 'expense' && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded ${NATURE_CLS[a.nature] || ''}`}>
            {a.nature === 'fixed_asset' ? 'Fixed Asset' : 'Capital'}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2 flex-shrink-0">
        <span className={`text-sm font-medium whitespace-nowrap ${a.balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>{formatINR(a.balance)}</span>
        {onEdit && (
          <button onClick={(e) => { e.stopPropagation(); onEdit(); }} title="Edit account"
            className="p-1 rounded text-gray-400 hover:text-primary-600 hover:bg-gray-200 transition-colors">
            <HiOutlinePencil className="w-4 h-4" />
          </button>
        )}
        {onOpen && (
          <HiOutlineChevronRight className="w-4 h-4 text-gray-300 group-hover:text-primary-500 flex-shrink-0" />
        )}
      </span>
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

const ChartOfAccounts = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const canCreate = can('chart_of_accounts', 'create');
  const canEdit = can('chart_of_accounts', 'edit');

  const [groups, setGroups] = useState([]);
  const [accountsById, setAccountsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editAccount, setEditAccount] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  const load = () => {
    setLoading(true);
    Promise.all([getChartOfAccountsAPI(), getAccountsAPI()])
      .then(([chartRes, acctRes]) => {
        setGroups(chartRes.data.groups || []);
        const map = {};
        for (const a of (acctRes.data || [])) map[a.id] = a;
        setAccountsById(map);
      })
      .catch(() => toast.error('Failed to load chart of accounts'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Only rows backed by an editable ledger Account (present in accountsById) get
  // an edit affordance; returns the raw account to prefill, or null.
  const editableAccount = (a) => (canEdit && EDITABLE_KINDS.has(a.kind) ? accountsById[a.id] : null);

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
        <Loader label="Loading…" className="py-16" />
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
                              {accts.map((a) => {
                                const acct = editableAccount(a);
                                const path = drillPath(a);
                                return <AccountRow key={`${a.kind}-${a.id}`} a={a} onEdit={acct ? () => setEditAccount(acct) : undefined} onOpen={path ? () => navigate(path) : undefined} />;
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : g.accounts.length === 0 ? (
                    <div className="px-4 py-4 text-sm text-gray-400">No accounts</div>
                  ) : (
                    <div className="divide-y divide-gray-50">
                      {g.accounts.map((a) => {
                        const acct = editableAccount(a);
                        const path = drillPath(a);
                        return <AccountRow key={`${a.kind}-${a.id}`} a={a} onEdit={acct ? () => setEditAccount(acct) : undefined} onOpen={path ? () => navigate(path) : undefined} />;
                      })}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      <AddAccountModal
        open={addOpen || !!editAccount}
        account={editAccount}
        onClose={() => { setAddOpen(false); setEditAccount(null); }}
        onCreated={() => { setAddOpen(false); load(); }}
        onSaved={() => { setEditAccount(null); load(); }}
      />
    </div>
  );
};

export default ChartOfAccounts;
