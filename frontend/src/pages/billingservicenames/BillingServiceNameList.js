import React, { useState, useEffect } from 'react';
import Loader from '../../components/ui/Loader';
import { getBillingServiceNamesAPI, createBillingServiceNameAPI, updateBillingServiceNameAPI, deleteBillingServiceNameAPI } from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineCheck, HiOutlineX } from 'react-icons/hi';

const CLAIM_TYPE_OPTIONS = [
  { value: 'cashless', label: 'Cashless' },
  { value: 'cashless_anywhere', label: 'Cashless Anywhere' },
  { value: 'reimbursement', label: 'Reimbursement' },
  { value: 'grievance', label: 'Grievance' },
];
const CLAIM_TYPE_LABEL = Object.fromEntries(CLAIM_TYPE_OPTIONS.map((o) => [o.value, o.label]));

// Toggle-pill selector for claim types. Backend accepts `[]` to mean "no
// restriction" (applies to any claim type as a universal fallback).
const ClaimTypeSelector = ({ value, onChange }) => {
  const list = Array.isArray(value) ? value : [];
  const toggle = (v) => {
    if (list.includes(v)) onChange(list.filter((x) => x !== v));
    else onChange([...list, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLAIM_TYPE_OPTIONS.map((o) => {
        const active = list.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400 hover:text-primary-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const BillingServiceNameList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('billing_service_names', 'create');
  const canEdit = can('billing_service_names', 'edit');
  const canDelete = can('billing_service_names', 'delete');
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState('');
  const [newClaimTypes, setNewClaimTypes] = useState([]);
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editClaimTypes, setEditClaimTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    try {
      const { data } = await getBillingServiceNamesAPI();
      setItems(data);
    } catch { toast.error('Failed to fetch'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createBillingServiceNameAPI({ name: newName.trim(), claimTypes: newClaimTypes });
      setNewName('');
      setNewClaimTypes([]);
      toast.success('Service name added');
      fetchItems();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add');
    }
  };

  const beginEdit = (item) => {
    setEditId(item._id);
    setEditName(item.name);
    setEditClaimTypes(Array.isArray(item.claimTypes) ? item.claimTypes : []);
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await updateBillingServiceNameAPI(id, { name: editName.trim(), claimTypes: editClaimTypes });
      setEditId(null);
      toast.success('Updated');
      fetchItems();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update');
    }
  };

  const handleDelete = async (id, name) => {
    if (!await confirm(`Delete "${name}"?`, { title: 'Delete', confirmLabel: 'Delete' })) return;
    try {
      await deleteBillingServiceNameAPI(id);
      toast.success('Deleted');
      fetchItems();
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      {canCreate && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex gap-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter service name (e.g. TPA Desk Services)..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
            <button type="submit"
              className="flex items-center gap-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <HiOutlinePlus className="w-4 h-4" /> Add
            </button>
          </div>
          <div className="mt-3">
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Applies to Claim Types
              <span className="ml-1 text-gray-400 normal-case font-normal">(leave empty for universal fallback)</span>
            </label>
            <ClaimTypeSelector value={newClaimTypes} onChange={setNewClaimTypes} />
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Service Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Applies to Claim Types</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={4} className="py-8"><Loader label="Loading…" /></td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={4} className="py-8 text-center text-gray-400">No service names added yet</td></tr>
              ) : items.map((item, idx) => (
                <tr key={item._id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-500 align-top">{idx + 1}</td>
                  <td className="py-3 px-4 text-sm align-top">
                    {editId === item._id ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm w-full focus:ring-2 focus:ring-primary-500" autoFocus />
                    ) : (
                      <span className="font-medium text-gray-800">{item.name}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-sm align-top">
                    {editId === item._id ? (
                      <ClaimTypeSelector value={editClaimTypes} onChange={setEditClaimTypes} />
                    ) : (
                      (() => {
                        const list = Array.isArray(item.claimTypes) ? item.claimTypes : [];
                        if (!list.length) {
                          return <span className="text-xs text-gray-400 italic">Universal fallback</span>;
                        }
                        return (
                          <div className="flex flex-wrap gap-1">
                            {list.map((c) => (
                              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-medium">
                                {CLAIM_TYPE_LABEL[c] || c}
                              </span>
                            ))}
                          </div>
                        );
                      })()
                    )}
                  </td>
                  <td className="py-3 px-4 text-right align-top">
                    <div className="flex items-center justify-end gap-1">
                      {editId === item._id ? (
                        <>
                          <button onClick={() => handleUpdate(item._id)}
                            className="p-2.5 text-green-600 hover:bg-green-50 rounded-lg">
                            <HiOutlineCheck className="w-4 h-4" />
                          </button>
                          <button onClick={() => setEditId(null)}
                            className="p-2.5 text-gray-500 hover:bg-gray-100 rounded-lg">
                            <HiOutlineX className="w-4 h-4" />
                          </button>
                        </>
                      ) : (
                        <>
                          {canEdit && (
                            <button onClick={() => beginEdit(item)}
                              className="p-2.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                              <HiOutlinePencil className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button onClick={() => handleDelete(item._id, item.name)}
                              className="p-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
                              <HiOutlineTrash className="w-4 h-4" />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default BillingServiceNameList;
