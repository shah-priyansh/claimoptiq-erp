import React, { useState, useEffect } from 'react';
import { getTPAAPI, createTPAAPI, updateTPAAPI, deleteTPAAPI } from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash } from 'react-icons/hi';
import MasterContactFormModal from '../../components/common/MasterContactFormModal';

const TPAList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('tpa', 'create');
  const canEdit = can('tpa', 'edit');
  const canDelete = can('tpa', 'delete');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });

  const fetchItems = async () => {
    try {
      const { data } = await getTPAAPI();
      setItems(data);
    } catch { toast.error('Failed to fetch'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateTPAAPI(modal.item._id, form);
        toast.success('TPA updated');
      } else {
        await createTPAAPI(form);
        toast.success('TPA added');
      }
      setModal({ open: false, item: null });
      fetchItems();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
      throw error;
    }
  };

  const handleDelete = async (id, name) => {
    if (!await confirm(`Delete "${name}"?`, { title: 'Delete TPA', confirmLabel: 'Delete' })) return;
    try {
      await deleteTPAAPI(id);
      toast.success('Deleted');
      fetchItems();
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      {canCreate && (
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add TPA
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">TPA Name</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Contact Person</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Mobile</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Email</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Address</th>
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">No TPAs added yet</td></tr>
              ) : items.map((item, idx) => (
                <tr key={item._id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-sm text-gray-500">{idx + 1}</td>
                  <td className="py-3 px-4 text-sm font-medium text-gray-800">{item.name}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{item.contactPerson || '-'}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{item.mobile || '-'}</td>
                  <td className="py-3 px-4 text-sm text-gray-600">{item.email || '-'}</td>
                  <td className="py-3 px-4 text-sm text-gray-600 max-w-xs truncate" title={item.address || ''}>{item.address || '-'}</td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <button onClick={() => setModal({ open: true, item })}
                          className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                          <HiOutlinePencil className="w-4 h-4" />
                        </button>
                      )}
                      {canDelete && (
                        <button onClick={() => handleDelete(item._id, item.name)}
                          className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
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
      </div>

      <MasterContactFormModal
        open={modal.open}
        item={modal.item}
        onClose={() => setModal({ open: false, item: null })}
        onSave={handleSave}
        entityLabel="TPA"
      />
    </div>
  );
};

export default TPAList;
