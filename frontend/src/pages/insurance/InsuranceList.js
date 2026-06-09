import React, { useState, useEffect } from 'react';
import { getInsuranceAPI, createInsuranceAPI, updateInsuranceAPI, deleteInsuranceAPI, importInsuranceAPI } from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineUpload } from 'react-icons/hi';
import MasterContactFormModal from '../../components/common/MasterContactFormModal';
import MasterImportModal from '../../components/master/MasterImportModal';

const INSURANCE_IMPORT_CONFIG = {
  title: 'Import Insurance Companies',
  entityLabel: 'insurance company',
  templateName: 'insurance-import-template.xlsx',
  columns: [
    { key: 'name',          label: 'Name *',          width: 36, required: true, note: 'Insurance company name (required)' },
    { key: 'contactPerson', label: 'Contact Person',  width: 22 },
    { key: 'mobile',        label: 'Mobile',          width: 14 },
    { key: 'email',         label: 'Email',           width: 26 },
    { key: 'address',       label: 'Address',         width: 30 },
  ],
  sampleRow1: { name: 'Care Health Insurance Co. Ltd', contactPerson: 'Ravi Patel', mobile: '9876543210', email: 'support@carehealth.in', address: 'Mumbai' },
  sampleRow2: { name: 'HDFC ERGO General Insurance Co. Ltd', contactPerson: '', mobile: '', email: '', address: '' },
  uploadAPI:  importInsuranceAPI,
};

const InsuranceList = () => {
  const confirm = useConfirm();
  const { can } = useAuth();
  const canCreate = can('insurance', 'create');
  const canEdit = can('insurance', 'edit');
  const canDelete = can('insurance', 'delete');

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState({ open: false, item: null });
  const [importOpen, setImportOpen] = useState(false);

  const fetchItems = async () => {
    try {
      const { data } = await getInsuranceAPI();
      setItems(data);
    } catch { toast.error('Failed to fetch'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchItems(); }, []);

  const handleSave = async (form) => {
    try {
      if (modal.item) {
        await updateInsuranceAPI(modal.item._id, form);
        toast.success('Insurance company updated');
      } else {
        await createInsuranceAPI(form);
        toast.success('Insurance company added');
      }
      setModal({ open: false, item: null });
      fetchItems();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
      throw error;
    }
  };

  const handleDelete = async (id, name) => {
    if (!await confirm(`Delete "${name}"?`, { title: 'Delete Insurance Company', confirmLabel: 'Delete' })) return;
    try {
      await deleteInsuranceAPI(id);
      toast.success('Deleted');
      fetchItems();
    } catch { toast.error('Failed to delete'); }
  };

  return (
    <div>
      {canCreate && (
        <div className="flex justify-end mb-4 gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <HiOutlineUpload className="w-4 h-4" /> Import
          </button>
          <button
            onClick={() => setModal({ open: true, item: null })}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Insurance Company
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">#</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Company Name</th>
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
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">No insurance companies added yet</td></tr>
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
        entityLabel="Insurance Company"
      />

      <MasterImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={fetchItems}
        config={INSURANCE_IMPORT_CONFIG}
      />
    </div>
  );
};

export default InsuranceList;
