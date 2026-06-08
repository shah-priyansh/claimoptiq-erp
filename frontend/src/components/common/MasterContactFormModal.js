import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { HiOutlineX } from 'react-icons/hi';

const blank = { name: '', address: '', contactPerson: '', mobile: '', email: '' };

const MasterContactFormModal = ({ open, item, onClose, onSave, entityLabel = 'Item' }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(item ? {
      name: item.name || '',
      address: item.address || '',
      contactPerson: item.contactPerson || '',
      mobile: item.mobile || '',
      email: item.email || '',
    } : blank);
  }, [open, item]);

  if (!open) return null;

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      // soft client validation — server still authoritative
      // eslint-disable-next-line no-alert
      alert('Please enter a valid email or leave blank');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: form.name.trim(),
        address: form.address.trim(),
        contactPerson: form.contactPerson.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim(),
      });
    } catch { /* handled by parent toast */ }
    finally { setSaving(false); }
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {item ? `Edit ${entityLabel}` : `Add ${entityLabel}`}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              {item ? 'Update details' : 'Fill in the details below'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              autoFocus
              value={form.name}
              onChange={(e) => update('name', e.target.value)}
              required
              placeholder={`${entityLabel} name`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Address</label>
            <textarea
              value={form.address}
              onChange={(e) => update('address', e.target.value)}
              rows={2}
              placeholder="Full address"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Contact Person</label>
              <input
                value={form.contactPerson}
                onChange={(e) => update('contactPerson', e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mobile Number</label>
              <input
                value={form.mobile}
                onChange={(e) => update('mobile', e.target.value)}
                inputMode="tel"
                placeholder="Optional"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50">
            Cancel
          </button>
          <button type="submit" disabled={saving || !form.name.trim()}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50">
            {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {item ? 'Save Changes' : 'Add'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
};

export default MasterContactFormModal;
