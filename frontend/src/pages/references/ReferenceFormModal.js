import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX } from 'react-icons/hi';

const COMMISSION_TYPE_OPTIONS = [
  { value: 'percentage', label: '%' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'per_claim', label: 'Per Claim' },
  { value: 'one_time', label: 'One-time' },
];

const VALUE_HINT = {
  percentage: '% of line amount',
  fixed: '₹ per invoice',
  per_claim: '₹ per claim',
  one_time: '₹ (once ever)',
};

const blank = { name: '', mobile: '', address: '', isActive: true, services: {} };

// services state shape: { [billingServiceNameId]: { enabled, commissionType, commissionValue } }

const ReferenceFormModal = ({ open, initial, services, onClose, onSave }) => {
  const [form, setForm] = useState(blank);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      const map = {};
      for (const s of initial.applicableServices || []) {
        const id = s.billingServiceName?._id || s.billingServiceNameId;
        if (!id) continue;
        map[id] = {
          enabled: true,
          commissionType: s.commissionType || 'percentage',
          commissionValue: s.commissionValue ?? 0,
        };
      }
      setForm({
        name: initial.name || '',
        mobile: initial.mobile || '',
        address: initial.address || '',
        isActive: initial.isActive !== false,
        services: map,
      });
    } else {
      setForm(blank);
    }
  }, [open, initial]);

  const enabledCount = useMemo(
    () => Object.values(form.services).filter((s) => s.enabled).length,
    [form.services],
  );

  if (!open) return null;

  const updateService = (id, patch) => {
    setForm((f) => ({
      ...f,
      services: {
        ...f.services,
        [id]: { commissionType: 'percentage', commissionValue: 0, ...(f.services[id] || {}), ...patch },
      },
    }));
  };

  const toggleService = (id) => {
    setForm((f) => {
      const current = f.services[id] || { enabled: false, commissionType: 'percentage', commissionValue: 0 };
      return {
        ...f,
        services: { ...f.services, [id]: { ...current, enabled: !current.enabled } },
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const applicableServices = Object.entries(form.services)
        .filter(([, v]) => v.enabled)
        .map(([id, v]) => ({
          billingServiceNameId: id,
          commissionType: v.commissionType || 'percentage',
          commissionValue: Math.max(0, Number(v.commissionValue) || 0),
        }));
      await onSave({
        name: form.name,
        mobile: form.mobile,
        address: form.address,
        isActive: form.isActive,
        applicableServices,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? 'Edit Reference' : 'Add Reference'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
            <HiOutlineX className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mobile</label>
              <input
                value={form.mobile}
                onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                inputMode="numeric"
                maxLength={10}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Applicable Services</label>
              {enabledCount > 0 && (
                <span className="text-xs text-gray-500">{enabledCount} selected</span>
              )}
            </div>
            {services.length === 0 ? (
              <p className="text-xs text-gray-400">No billing-service names exist yet. Create them in Settings → Billing Service Names first.</p>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {services.map((s) => {
                  const entry = form.services[s._id] || { enabled: false, commissionType: 'percentage', commissionValue: 0 };
                  return (
                    <div key={s._id} className={`flex items-center gap-3 px-3 py-2 ${entry.enabled ? 'bg-primary-50/40' : ''}`}>
                      <input
                        type="checkbox"
                        checked={entry.enabled}
                        onChange={() => toggleService(s._id)}
                        className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 flex-shrink-0"
                      />
                      <span className="text-sm text-gray-800 flex-1 truncate" title={s.name}>{s.name}</span>
                      <select
                        value={entry.commissionType}
                        disabled={!entry.enabled}
                        onChange={(e) => updateService(s._id, { commissionType: e.target.value })}
                        className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-28"
                      >
                        {COMMISSION_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0"
                        step={entry.commissionType === 'percentage' ? '0.01' : '1'}
                        value={entry.commissionValue}
                        disabled={!entry.enabled}
                        onChange={(e) => updateService(s._id, { commissionValue: e.target.value })}
                        placeholder="0"
                        title={VALUE_HINT[entry.commissionType]}
                        className="text-sm px-2 py-1 border border-gray-300 rounded-md w-24 tabular-nums text-right disabled:bg-gray-50 disabled:text-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-xs text-gray-400 mt-1.5">
              Commission is computed per service. <strong>%</strong>: percent of the line amount.{' '}
              <strong>Fixed</strong>: flat ₹ once per invoice. <strong>Per Claim</strong>: ₹ × number of claims.{' '}
              <strong>One-time</strong>: ₹ on the first invoice ever (skipped after).
            </p>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              Active
            </label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !form.name.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ReferenceFormModal;
