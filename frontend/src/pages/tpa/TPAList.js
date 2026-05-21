import React, { useState, useEffect } from 'react';
import { getTPAAPI, createTPAAPI, updateTPAAPI, deleteTPAAPI } from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineCheck, HiOutlineX } from 'react-icons/hi';

const TPAList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('tpa', 'create');
  const canEdit = can('tpa', 'edit');
  const canDelete = can('tpa', 'delete');
  const [items, setItems] = useState([]);
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchItems = async () => {
    try {
      const { data } = await getTPAAPI();
      setItems(data);
    } catch { toast.error('Failed to fetch'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await createTPAAPI({ name: newName.trim() });
      setNewName('');
      toast.success('TPA added');
      fetchItems();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to add');
    }
  };

  const handleUpdate = async (id) => {
    if (!editName.trim()) return;
    try {
      await updateTPAAPI(id, { name: editName.trim() });
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
      await deleteTPAAPI(id);
      toast.success('Deleted');
      fetchItems();
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-1">TPA (Third Party Administrators)</h1>
      <p className="text-sm text-gray-500 mb-6">Manage TPA list for claim dropdowns</p>

      {canCreate && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex gap-3">
            <input value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Enter TPA name..."
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            <button type="submit"
              className="flex items-center gap-1 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <HiOutlinePlus className="w-4 h-4" /> Add
            </button>
          </div>
        </form>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">TPA Name</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={3} className="py-8 text-center text-gray-400">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={3} className="py-8 text-center text-gray-400">No TPAs added yet</td></tr>
            ) : items.map((item, idx) => (
              <tr key={item._id} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-sm text-gray-500">{idx + 1}</td>
                <td className="py-3 px-4 text-sm">
                  {editId === item._id ? (
                    <input value={editName} onChange={(e) => setEditName(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm w-full focus:ring-2 focus:ring-primary-500" autoFocus />
                  ) : (
                    <span className="font-medium text-gray-800">{item.name}</span>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
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
                          <button onClick={() => { setEditId(item._id); setEditName(item.name); }}
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

export default TPAList;
