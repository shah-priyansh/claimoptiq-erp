import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi';
import {
  getBillingServiceNamesAPI,
  getDirectPatientBillingServicesAPI,
  saveDirectPatientBillingServicesAPI,
} from '../../services/api';
import AmountInput from '../../components/AmountInput';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { formatINR } from '../../utils/format';

const BILLING_TYPE_OPTIONS = [
  { value: 'fixed_monthly',  label: 'Fixed Monthly' },
  { value: 'per_claim_slab', label: 'Per Claim Slab' },
  { value: 'fixed_onetime',  label: 'Fixed One-Time' },
  { value: 'percentage',     label: 'Percentage' },
];

const CALC_BASIS_OPTIONS = [
  { value: 'none',                label: 'None' },
  { value: 'hospital_final_bill', label: 'Hospital Final Bill' },
  { value: 'final_approval',      label: 'Final Approval Amount' },
];

const emptyService = {
  serviceName: '',
  billingType: 'fixed_monthly',
  fixedAmount: 0,
  claimLimit: 0,
  overLimitBehavior: 'per_claim',
  overLimitPerClaimAmount: 0,
  overLimitInsuranceWise: false,
  overLimitInsurerIds: [],
  overLimitTpaIds: [],
  calculationBasis: 'none',
  percentageRate: 0,
  slabMode: 'slab_wise',
  slabRangeStart: 0,
  slabRangeEnd: 50000,
  slabIncrementRange: 0,
  slabIncrementPrice: 0,
  slabs: [],
  isActive: true,
};

const emptySlab = { rangeStart: 0, rangeEnd: 0, price: 0 };

const DirectPatientBillingServices = () => {
  const [services, setServices] = useState([]);
  const [serviceNames, setServiceNames] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      getDirectPatientBillingServicesAPI(),
      getBillingServiceNamesAPI(),
    ])
      .then(([svcRes, nameRes]) => {
        setServices((svcRes.data || []).map((s) => ({ ...emptyService, ...s, slabs: s.slabs || [] })));
        setServiceNames(nameRes.data || []);
      })
      .catch(() => toast.error('Failed to load direct-patient billing services'))
      .finally(() => setLoading(false));
  }, []);

  const patchService = (idx, patch) => {
    setServices((arr) => arr.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addService = () => {
    setServices((arr) => [...arr, { ...emptyService }]);
  };

  const removeService = (idx) => {
    setServices((arr) => arr.filter((_, i) => i !== idx));
  };

  const addSlab = (idx) => {
    setServices((arr) => arr.map((s, i) => (i === idx ? { ...s, slabs: [...(s.slabs || []), { ...emptySlab }] } : s)));
  };

  const patchSlab = (svcIdx, slabIdx, patch) => {
    setServices((arr) => arr.map((s, i) => {
      if (i !== svcIdx) return s;
      const slabs = [...(s.slabs || [])];
      slabs[slabIdx] = { ...slabs[slabIdx], ...patch };
      return { ...s, slabs };
    }));
  };

  const removeSlab = (svcIdx, slabIdx) => {
    setServices((arr) => arr.map((s, i) => {
      if (i !== svcIdx) return s;
      return { ...s, slabs: (s.slabs || []).filter((_, j) => j !== slabIdx) };
    }));
  };

  const handleSave = async () => {
    for (let i = 0; i < services.length; i++) {
      const s = services[i];
      if (!s.serviceName || !String(s.serviceName).trim()) {
        toast.error(`Service #${i + 1}: pick a service name.`);
        return;
      }
    }
    setSaving(true);
    try {
      const { data } = await saveDirectPatientBillingServicesAPI(services);
      setServices((data || []).map((s) => ({ ...emptyService, ...s, slabs: s.slabs || [] })));
      toast.success('Direct-patient billing services saved');
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="py-16 text-center text-gray-500">Loading…</div>;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-800">Direct Patient Billing Services</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Global billing configuration applied to every direct-patient invoice — independent of the reference hospital.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Configured Services</h2>
            <p className="text-xs text-gray-400 mt-0.5">Add fixed / slab / percentage services that direct-patient invoices auto-apply.</p>
          </div>
          <button
            type="button"
            onClick={addService}
            className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Service
          </button>
        </div>

        {services.length === 0 && (
          <div className="border-2 border-dashed border-gray-200 rounded-xl py-10 text-center">
            <p className="text-sm text-gray-400">No services configured yet.</p>
            <button
              type="button"
              onClick={addService}
              className="mt-2 text-sm text-primary-600 hover:text-primary-700 font-medium"
            >
              + Add first service
            </button>
          </div>
        )}

        {services.map((svc, idx) => {
          const isFixedMonthly = svc.billingType === 'fixed_monthly';
          const isFixedOnetime = svc.billingType === 'fixed_onetime';
          const isSlab = svc.billingType === 'per_claim_slab';
          const isPercent = svc.billingType === 'percentage';
          const label =
            isFixedMonthly ? 'Fixed Monthly' :
            isFixedOnetime ? 'Fixed One-Time' :
            isSlab ? 'Per Claim Slab' : 'Percentage';
          return (
            <div key={idx} className="border border-gray-200 rounded-xl shadow-sm mb-4">
              <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 rounded-t-xl">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-semibold text-gray-800 truncate">
                    {svc.serviceName || `Service #${idx + 1}`}
                  </span>
                  <span className="text-xs bg-white border border-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">
                    {label}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeService(idx)}
                  className="ml-3 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                >
                  <HiOutlineTrash className="w-4 h-4" />
                </button>
              </div>

              <div className="px-4 py-3">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Service Name</label>
                    <SearchableSelect
                      options={serviceNames.map((s) => ({ value: s.name, label: s.name }))}
                      value={svc.serviceName}
                      onChange={(val) => patchService(idx, { serviceName: val })}
                      placeholder="— Select Service —"
                      searchPlaceholder="Search services..."
                      allowClear
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Billing Type</label>
                    <SearchableSelect
                      options={BILLING_TYPE_OPTIONS}
                      value={svc.billingType}
                      onChange={(val) => patchService(idx, { billingType: val })}
                      placeholder="Select type"
                    />
                  </div>

                  {(isFixedMonthly || isFixedOnetime) && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        {isFixedOnetime ? 'One-Time Amount (Rs)' : 'Fixed Amount (Rs)'}
                      </label>
                      <AmountInput
                        value={svc.fixedAmount}
                        onChange={(v) => patchService(idx, { fixedAmount: v })}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  )}

                  {(isSlab || isPercent) && (
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Calculation Basis</label>
                      <SearchableSelect
                        options={CALC_BASIS_OPTIONS}
                        value={svc.calculationBasis}
                        onChange={(val) => patchService(idx, { calculationBasis: val })}
                        placeholder="Select basis"
                      />
                    </div>
                  )}

                  {isPercent && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        value={svc.percentageRate}
                        onChange={(e) => patchService(idx, { percentageRate: Number(e.target.value) })}
                        placeholder="e.g. 2.5"
                        className="w-full px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      />
                    </div>
                  )}
                </div>

                {isSlab && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">Slabs</h3>
                        <p className="text-xs text-gray-400 mt-0.5">Ranges are inclusive. Use rangeEnd = 0 for open-ended.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => addSlab(idx)}
                        className="flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:bg-primary-50 px-2.5 py-1 rounded-lg transition-colors"
                      >
                        <HiOutlinePlus className="w-3.5 h-3.5" /> Add Slab
                      </button>
                    </div>
                    {(svc.slabs || []).length === 0 ? (
                      <p className="text-xs text-gray-400 py-3 text-center border border-dashed border-gray-200 rounded-lg">
                        No slabs yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {(svc.slabs || []).map((slab, slabIdx) => (
                          <div key={slabIdx} className="grid grid-cols-4 gap-2 items-end">
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500 mb-1">Range Start</label>
                              <AmountInput
                                value={slab.rangeStart}
                                onChange={(v) => patchSlab(idx, slabIdx, { rangeStart: v })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500 mb-1">Range End</label>
                              <AmountInput
                                value={slab.rangeEnd}
                                onChange={(v) => patchSlab(idx, slabIdx, { rangeEnd: v })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium text-gray-500 mb-1">Price</label>
                              <AmountInput
                                value={slab.price}
                                onChange={(v) => patchSlab(idx, slabIdx, { price: v })}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-xs focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => removeSlab(idx, slabIdx)}
                              className="h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded"
                            >
                              <HiOutlineTrash className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {(isFixedMonthly || isFixedOnetime) && (
                  <div className="mt-3 text-xs text-gray-500">
                    Preview: <span className="font-semibold text-gray-800">₹{formatINR(svc.fixedAmount || 0)}</span>
                    {isFixedOnetime && ' — charged once per direct-patient stream (across all invoices).'}
                    {isFixedMonthly && ' — charged on every direct-patient invoice.'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
        >
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
};

export default DirectPatientBillingServices;
