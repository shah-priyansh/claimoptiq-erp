import React, { useState, useEffect } from 'react';
import {
  getClaimDocumentTypesAPI,
  createClaimDocumentTypeAPI,
  updateClaimDocumentTypeAPI,
  deleteClaimDocumentTypeAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash,
  HiOutlineLockClosed, HiOutlineX, HiOutlineDocumentText,
} from 'react-icons/hi';

const emptyForm = { name: '', description: '', isRequired: false, order: '' };

const Modal = ({ title, form, setForm, onSave, onClose, saving }) => (
  <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
    <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
      <div className="sticky top-0 bg-white rounded-t-2xl sm:rounded-t-xl flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-800">{title}</h2>
        <button onClick={onClose} className="p-2.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <HiOutlineX className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Document Name *</label>
          <input
            value={form.name}
            onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Discharge Summary"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            placeholder="Brief description of when this document is needed"
            rows={2}
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
          <input
            type="number"
            value={form.order}
            onChange={(e) => setForm(f => ({ ...f, order: e.target.value }))}
            placeholder="e.g. 1"
            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
          />
        </div>

        <div className="flex items-center gap-3 py-1">
          <button
            type="button"
            onClick={() => setForm(f => ({ ...f, isRequired: !f.isRequired }))}
            className={`w-10 h-6 rounded-full transition-colors relative flex-shrink-0 ${form.isRequired ? 'bg-primary-600' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.isRequired ? 'translate-x-5' : 'translate-x-1'}`} />
          </button>
          <div>
            <p className="text-sm font-medium text-gray-700">Mandatory Document</p>
            <p className="text-xs text-gray-400">Mark if this document is required for every claim</p>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving || !form.name.trim()}
          className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  </div>
);

const ClaimDocumentTypeMaster = () => {
  const { can } = useAuth();
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetchAll = async () => {
    try {
      const { data } = await getClaimDocumentTypesAPI();
      setDocTypes(data);
    } catch {
      toast.error('Failed to fetch document types');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const openCreate = () => { setForm(emptyForm); setModal('create'); };
  const openEdit = (d) => { setForm({ ...d, order: d.order ?? '' }); setModal('edit'); };
  const closeModal = () => { setModal(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Name is required');
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        description: form.description,
        isRequired: form.isRequired,
        order: form.order || undefined,
      };
      if (modal === 'create') {
        await createClaimDocumentTypeAPI(payload);
        toast.success('Document type created');
      } else {
        await updateClaimDocumentTypeAPI(form._id, payload);
        toast.success('Document type updated');
      }
      closeModal();
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (d) => {
    try {
      await updateClaimDocumentTypeAPI(d._id, { isActive: !d.isActive });
      toast.success(`Document type ${d.isActive ? 'deactivated' : 'activated'}`);
      fetchAll();
    } catch {
      toast.error('Failed to update');
    }
  };

  const handleDelete = async (d) => {
    if (!window.confirm(`Delete document type "${d.name}"?`)) return;
    try {
      await deleteClaimDocumentTypeAPI(d._id);
      toast.success('Document type deleted');
      fetchAll();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Claim Document Types</h1>
          <p className="text-sm text-gray-500 mt-1">Define documents required for claim processing</p>
        </div>
        {can('claim_document_types', 'create') && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Document Type
          </button>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">Loading...</div>
        ) : docTypes.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 py-12 text-center text-gray-400">No document types found.</div>
        ) : docTypes.map((d) => (
          <div key={d._id} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <HiOutlineDocumentText className="w-4 h-4 text-primary-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">{d.name}</p>
                  {d.description && <p className="text-xs text-gray-400 truncate mt-0.5">{d.description}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {d.isRequired && (
                  <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">Required</span>
                )}
                {d.isSystem && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs rounded-full flex items-center gap-1">
                    <HiOutlineLockClosed className="w-3 h-3" /> System
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
              <button
                onClick={() => handleToggleActive(d)}
                className={`w-8 h-5 rounded-full transition-colors relative ${d.isActive ? 'bg-primary-600' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${d.isActive ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
              </button>
              <div className="flex items-center gap-1">
                {can('claim_document_types', 'edit') && (
                  <button onClick={() => openEdit(d)}
                    className="p-2 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                    <HiOutlinePencil className="w-4 h-4" />
                  </button>
                )}
                {can('claim_document_types', 'delete') && !d.isSystem && (
                  <button onClick={() => handleDelete(d)}
                    className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-12">Order</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Document Name</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Description</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Required</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Active</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400">Loading...</td></tr>
            ) : docTypes.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-gray-400">No document types found.</td></tr>
            ) : docTypes.map((d) => (
              <tr key={d._id} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-sm text-gray-400 font-mono">{d.order}</td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 bg-primary-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <HiOutlineDocumentText className="w-3.5 h-3.5 text-primary-600" />
                    </div>
                    <span className="text-sm font-medium text-gray-800">{d.name}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-sm text-gray-500 max-w-xs truncate">{d.description || <span className="text-gray-300">—</span>}</td>
                <td className="py-3 px-4 text-center">
                  {d.isRequired ? (
                    <span className="px-2.5 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">Required</span>
                  ) : (
                    <span className="px-2.5 py-0.5 bg-gray-100 text-gray-400 text-xs rounded-full">Optional</span>
                  )}
                </td>
                <td className="py-3 px-4 text-center">
                  <button
                    onClick={() => handleToggleActive(d)}
                    className={`w-8 h-5 rounded-full transition-colors relative ${d.isActive ? 'bg-primary-600' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${d.isActive ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                  </button>
                </td>
                <td className="py-3 px-4 text-center">
                  {d.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <HiOutlineLockClosed className="w-3.5 h-3.5" /> System
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Custom</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-1">
                    {can('claim_document_types', 'edit') && (
                      <button onClick={() => openEdit(d)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                    )}
                    {can('claim_document_types', 'delete') && !d.isSystem && (
                      <button onClick={() => handleDelete(d)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
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

      {modal && (
        <Modal
          title={modal === 'create' ? 'Add Document Type' : 'Edit Document Type'}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
};

export default ClaimDocumentTypeMaster;
