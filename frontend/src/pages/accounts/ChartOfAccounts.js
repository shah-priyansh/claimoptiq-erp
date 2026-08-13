import React, { useEffect, useState } from 'react';
import Loader from '../../components/ui/Loader';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlineLibrary, HiOutlineCreditCard, HiOutlineCash,
  HiOutlineOfficeBuilding, HiOutlineChevronDown, HiOutlineChevronRight,
} from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { getChartOfAccountsAPI } from '../../services/api';
import AddAccountModal from './AddAccountModal';

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
