import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createHospitalAPI, updateHospitalAPI, getHospitalAPI, getInsuranceAPI, getBillingServiceNamesAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineUserCircle } from 'react-icons/hi';
import { isValidEmail, isValidPhone, isValidPincode, onPhoneInput, inputCls } from '../../utils/validators';
import { formatINR } from '../../utils/format';
import AmountInput from '../../components/AmountInput';

const emptyDoctor = { name: '', specialization: '', phone: '', email: '' };
const emptySlab = { rangeStart: 0, rangeEnd: 0, price: 0 };

const emptyService = {
  serviceName: '',
  billingType: 'fixed_monthly',
  fixedAmount: 0,
  claimLimit: 0,
  overLimitBehavior: 'per_claim',
  overLimitPerClaimAmount: 0,
  overLimitInsuranceWise: false,
  overLimitInsurerIds: [],
  calculationBasis: 'none',
  percentageRate: 0,
  slabs: [],
  isActive: true,
};

const HospitalForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({
    name: '', contact: '', email: '', phone: '', address: '',
    city: '', state: '', pincode: '', referenceBy: '',
    doctors: [],
    billingServices: [],
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [insurers, setInsurers] = useState([]);
  const [serviceNames, setServiceNames] = useState([]);
  const [insurerSearch, setInsurerSearch] = useState('');
  const [insurerDropdownOpen, setInsurerDropdownOpen] = useState(null);

  useEffect(() => {
    getInsuranceAPI().then(({ data }) => setInsurers((data || []).filter(i => i.isActive !== false))).catch(() => {});
    getBillingServiceNamesAPI().then(({ data }) => setServiceNames(data || [])).catch(() => {});
    if (isEdit) {
      getHospitalAPI(id).then(({ data }) => setForm(data)).catch(() => {
        toast.error('Hospital not found');
        navigate('/hospitals');
      });
    }
  }, [id, isEdit, navigate]);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setErrors(prev => ({ ...prev, [e.target.name]: '' }));
  };

  const handleServiceChange = (idx, field, value) => {
    const services = [...form.billingServices];
    services[idx] = { ...services[idx], [field]: value };
    setForm({ ...form, billingServices: services });
  };

  const addSlab = (svcIdx) => {
    const services = [...form.billingServices];
    services[svcIdx] = { ...services[svcIdx], slabs: [...(services[svcIdx].slabs || []), { ...emptySlab }] };
    setForm({ ...form, billingServices: services });
  };

  const removeSlab = (svcIdx, slabIdx) => {
    const services = [...form.billingServices];
    services[svcIdx] = { ...services[svcIdx], slabs: services[svcIdx].slabs.filter((_, i) => i !== slabIdx) };
    setForm({ ...form, billingServices: services });
  };

  const handleSlabChange = (svcIdx, slabIdx, field, value) => {
    const services = [...form.billingServices];
    const slabs = [...(services[svcIdx].slabs || [])];
    slabs[slabIdx] = { ...slabs[slabIdx], [field]: value };
    services[svcIdx] = { ...services[svcIdx], slabs };
    setForm({ ...form, billingServices: services });
  };

  const addService = () => {
    setForm({ ...form, billingServices: [...form.billingServices, { ...emptyService }] });
  };

  const removeService = (idx) => {
    const services = form.billingServices.filter((_, i) => i !== idx);
    setForm({ ...form, billingServices: services });
  };

  const toggleInsurer = (svcIdx, insurerId) => {
    const services = [...form.billingServices];
    const current = services[svcIdx].overLimitInsurerIds || [];
    const updated = current.includes(insurerId) ? current.filter(id => id !== insurerId) : [...current, insurerId];
    services[svcIdx] = { ...services[svcIdx], overLimitInsurerIds: updated };
    setForm({ ...form, billingServices: services });
  };

  const addDoctor = () => {
    setForm(f => ({ ...f, doctors: [...f.doctors, { ...emptyDoctor }] }));
  };

  const removeDoctor = (idx) => {
    setForm(f => ({ ...f, doctors: f.doctors.filter((_, i) => i !== idx) }));
  };

  const handleDoctorChange = (idx, field, value) => {
    const doctors = [...form.doctors];
    doctors[idx] = { ...doctors[idx], [field]: value };
    setForm({ ...form, doctors });
    // clear doctor-level error
    setErrors(prev => ({ ...prev, [`doctor_${idx}_${field}`]: '' }));
  };

  const handleDoctorPhone = (idx, value) => {
    handleDoctorChange(idx, 'phone', onPhoneInput(value));
  };

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Hospital name is required';
    if (form.email && !isValidEmail(form.email)) e.email = 'Enter a valid email address';
    if (form.phone && !isValidPhone(form.phone)) e.phone = 'Enter a valid 10-digit Indian mobile number (starts with 6-9)';
    if (form.pincode && !isValidPincode(form.pincode)) e.pincode = 'Enter a valid 6-digit Indian pincode';
    form.doctors.forEach((d, i) => {
      if (!d.name.trim()) e[`doctor_${i}_name`] = 'Doctor name is required';
      if (d.phone && !isValidPhone(d.phone)) e[`doctor_${i}_phone`] = 'Enter a valid 10-digit mobile number';
      if (d.email && !isValidEmail(d.email)) e[`doctor_${i}_email`] = 'Enter a valid email address';
    });
    return e;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const e_ = validate();
    if (Object.keys(e_).length) { setErrors(e_); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await updateHospitalAPI(id, form);
        toast.success('Hospital updated');
      } else {
        await createHospitalAPI(form);
        toast.success('Hospital created');
      }
      navigate('/hospitals');
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save hospital');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {isEdit ? 'Edit Hospital' : 'Add New Hospital'}
      </h1>

      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Basic Information</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Hospital Name *</label>
              <input name="name" value={form.name} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
              <input name="contact" value={form.contact} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone <span className="text-gray-400 font-normal">(10 digits)</span></label>
              <input name="phone" value={form.phone}
                onChange={(e) => { setErrors(p => ({...p, phone:''})); setForm(f => ({...f, phone: onPhoneInput(e.target.value)})); }}
                inputMode="numeric" maxLength={10}
                className={inputCls(!!errors.phone)} placeholder="e.g. 9876543210" />
              {form.phone && <p className="text-xs text-gray-400 mt-1">{form.phone.length}/10 digits</p>}
              {errors.phone && <p className="text-xs text-red-500 mt-1">{errors.phone}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange}
                className={inputCls(!!errors.email)} placeholder="hospital@example.com" />
              {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Reference By</label>
              <input name="referenceBy" value={form.referenceBy} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
              <input name="address" value={form.address} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
              <input name="city" value={form.city} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
              <input name="state" value={form.state} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Pincode <span className="text-gray-400 font-normal">(6 digits)</span></label>
              <input name="pincode" value={form.pincode}
                onChange={(e) => { setErrors(p=>({...p,pincode:''})); setForm(f=>({...f,pincode:e.target.value.replace(/\D/g,'').slice(0,6)})); }}
                inputMode="numeric" maxLength={6}
                className={inputCls(!!errors.pincode)} placeholder="e.g. 395001" />
              {errors.pincode && <p className="text-xs text-red-500 mt-1">{errors.pincode}</p>}
            </div>
          </div>
        </div>

        {/* Doctors */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-gray-800">Doctors</h2>
              <p className="text-xs text-gray-400 mt-0.5">Panel doctors associated with this hospital</p>
            </div>
            <button type="button" onClick={addDoctor}
              className="flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:bg-primary-50 px-3 py-1.5 rounded-lg transition-colors">
              <HiOutlinePlus className="w-4 h-4" /> Add Doctor
            </button>
          </div>

          {form.doctors.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 rounded-xl py-8 text-center">
              <HiOutlineUserCircle className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No doctors added yet</p>
              <button type="button" onClick={addDoctor}
                className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium">
                + Add first doctor
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {form.doctors.map((doc, idx) => (
                <div key={idx} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
                        {idx + 1}
                      </div>
                      <span className="text-sm font-semibold text-gray-700">
                        {doc.name || `Doctor #${idx + 1}`}
                      </span>
                    </div>
                    <button type="button" onClick={() => removeDoctor(idx)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <HiOutlineTrash className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Doctor Name *</label>
                      <input
                        value={doc.name}
                        onChange={(e) => handleDoctorChange(idx, 'name', e.target.value)}
                        placeholder="e.g. Dr. Rajesh Patel"
                        className={inputCls(!!errors[`doctor_${idx}_name`])}
                      />
                      {errors[`doctor_${idx}_name`] && (
                        <p className="text-xs text-red-500 mt-1">{errors[`doctor_${idx}_name`]}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Specialization</label>
                      <input
                        value={doc.specialization}
                        onChange={(e) => handleDoctorChange(idx, 'specialization', e.target.value)}
                        placeholder="e.g. Cardiologist, Orthopaedic"
                        className={inputCls(false)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Mobile <span className="text-gray-400 font-normal">(10 digits)</span></label>
                      <input
                        value={doc.phone}
                        onChange={(e) => handleDoctorPhone(idx, e.target.value)}
                        inputMode="numeric"
                        maxLength={10}
                        placeholder="e.g. 9876543210"
                        className={inputCls(!!errors[`doctor_${idx}_phone`])}
                      />
                      {doc.phone && <p className="text-xs text-gray-400 mt-0.5">{doc.phone.length}/10 digits</p>}
                      {errors[`doctor_${idx}_phone`] && (
                        <p className="text-xs text-red-500 mt-1">{errors[`doctor_${idx}_phone`]}</p>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                      <input
                        type="email"
                        value={doc.email}
                        onChange={(e) => handleDoctorChange(idx, 'email', e.target.value)}
                        placeholder="doctor@example.com"
                        className={inputCls(!!errors[`doctor_${idx}_email`])}
                      />
                      {errors[`doctor_${idx}_email`] && (
                        <p className="text-xs text-red-500 mt-1">{errors[`doctor_${idx}_email`]}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Billing Services */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Billing Services</h2>
            <button type="button" onClick={addService}
              className="flex items-center gap-1 text-sm text-primary-600 hover:text-primary-700 font-medium">
              <HiOutlinePlus className="w-4 h-4" /> Add Service
            </button>
          </div>

          {form.billingServices.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No billing services configured. Click "Add Service" to add one.</p>
          )}

          {form.billingServices.map((svc, idx) => {
            const showSlabs = svc.billingType === 'per_claim_slab' ||
              (svc.billingType === 'fixed_monthly' && svc.overLimitBehavior === 'per_claim_slab');
            const svcSlabs = svc.slabs || [];
            return (
              <div key={idx} className="border border-gray-200 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">Service #{idx + 1}</h3>
                  <button type="button" onClick={() => removeService(idx)}
                    className="text-red-500 hover:text-red-700">
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Service Name</label>
                    <select value={svc.serviceName} onChange={(e) => handleServiceChange(idx, 'serviceName', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                      <option value="">— Select service name —</option>
                      {serviceNames.map(s => (
                        <option key={s._id} value={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Billing Type</label>
                    <select value={svc.billingType} onChange={(e) => handleServiceChange(idx, 'billingType', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                      <option value="fixed_monthly">Fixed Monthly</option>
                      <option value="per_claim_slab">Per Claim Slab</option>
                      <option value="fixed_onetime">Fixed One-Time</option>
                      <option value="percentage">Percentage</option>
                    </select>
                  </div>

                  {svc.billingType === 'fixed_monthly' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Fixed Amount (Rs)</label>
                      <AmountInput value={svc.fixedAmount}
                        onChange={(v) => handleServiceChange(idx, 'fixedAmount', v)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                  )}

                  {svc.billingType === 'fixed_onetime' && (() => {
                    const selectedIds = svc.overLimitInsurerIds || [];
                    const isInsWise = Boolean(svc.overLimitInsuranceWise);
                    const filtered = insurers.filter(i =>
                      (i.name || '').toLowerCase().includes((insurerDropdownOpen === idx ? insurerSearch : '').toLowerCase())
                    );
                    return (
                      <>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            {isInsWise ? 'Per Claim (Rs)' : 'Fixed Amount (Rs)'}
                          </label>
                          <AmountInput value={svc.fixedAmount}
                            onChange={(v) => handleServiceChange(idx, 'fixedAmount', v)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                        </div>
                        <div className="flex items-center gap-2 pt-5">
                          <input
                            type="checkbox"
                            id={`ins-wise-bt-${idx}`}
                            checked={isInsWise}
                            onChange={(e) => {
                              const services = [...form.billingServices];
                              services[idx] = {
                                ...services[idx],
                                overLimitInsuranceWise: e.target.checked,
                                overLimitInsurerIds: e.target.checked ? (services[idx].overLimitInsurerIds || []) : [],
                              };
                              setForm(f => ({ ...f, billingServices: services }));
                            }}
                            className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-500 cursor-pointer"
                          />
                          <label htmlFor={`ins-wise-bt-${idx}`} className="text-xs font-medium text-gray-600 cursor-pointer select-none">
                            Insurance Wise
                          </label>
                        </div>

                        {isInsWise && (
                          <div className="md:col-span-3">
                            {/* Selected chips */}
                            {selectedIds.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {selectedIds.map(id => {
                                  const ins = insurers.find(i => (i.id || i._id) === id);
                                  return (
                                    <span key={id} className="inline-flex items-center gap-1 bg-primary-100 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-full">
                                      {ins?.name || id}
                                      <button type="button" onClick={() => toggleInsurer(idx, id)}
                                        className="ml-0.5 hover:text-primary-900 leading-none">&times;</button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* Searchable dropdown */}
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search and select insurance company..."
                                value={insurerDropdownOpen === idx ? insurerSearch : ''}
                                onFocus={() => { setInsurerDropdownOpen(idx); setInsurerSearch(''); }}
                                onChange={(e) => setInsurerSearch(e.target.value)}
                                onBlur={() => setTimeout(() => setInsurerDropdownOpen(null), 150)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                              {insurerDropdownOpen === idx && (
                                <div className="absolute top-full mt-1 left-0 right-0 z-30 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                  {filtered.length === 0 ? (
                                    <p className="text-xs text-gray-400 px-3 py-3">No results</p>
                                  ) : filtered.map(ins => {
                                    const insId = ins.id || ins._id;
                                    const isSelected = selectedIds.includes(insId);
                                    return (
                                      <button key={insId} type="button"
                                        onMouseDown={(e) => { e.preventDefault(); toggleInsurer(idx, insId); }}
                                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                        <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs ${isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300'}`}>
                                          {isSelected && '✓'}
                                        </span>
                                        {ins.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>

                            {/* Total bar */}
                            {selectedIds.length > 0 && (
                              <div className="mt-2 bg-primary-50 border border-primary-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                                <span className="text-xs text-gray-600">
                                  {selectedIds.length} insurer{selectedIds.length > 1 ? 's' : ''} &times; Rs {formatINR(svc.fixedAmount || 0)} per claim
                                </span>
                                <span className="text-sm font-semibold text-primary-700">
                                  Total: Rs {formatINR(selectedIds.length * (svc.fixedAmount || 0))}
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {svc.billingType === 'fixed_monthly' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">
                        Claim Limit <span className="text-gray-400 font-normal">(0 = unlimited)</span>
                      </label>
                      <AmountInput value={svc.claimLimit}
                        onChange={(v) => handleServiceChange(idx, 'claimLimit', v)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                  )}

                  {svc.billingType === 'fixed_monthly' && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">When Claim Limit is Exceeded</label>
                      <select value={svc.overLimitBehavior}
                        onChange={(e) => handleServiceChange(idx, 'overLimitBehavior', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                        <option value="per_claim">Fixed One-Time</option>
                        <option value="percentage">Percentage</option>
                        <option value="per_claim_slab">Per Claim Slab</option>
                      </select>
                    </div>
                  )}

                  {svc.billingType === 'fixed_monthly' && svc.overLimitBehavior === 'per_claim' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Per Claim (Rs)</label>
                        <AmountInput value={svc.overLimitPerClaimAmount}
                          onChange={(v) => handleServiceChange(idx, 'overLimitPerClaimAmount', v)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </div>
                      <div className="md:col-span-2 flex items-center gap-2 pt-5">
                        <input
                          type="checkbox"
                          id={`ins-wise-${idx}`}
                          checked={Boolean(svc.overLimitInsuranceWise)}
                          onChange={(e) => handleServiceChange(idx, 'overLimitInsuranceWise', e.target.checked)}
                          className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-500 cursor-pointer"
                        />
                        <label htmlFor={`ins-wise-${idx}`} className="text-xs font-medium text-gray-600 cursor-pointer select-none">
                          Insurance Wise
                        </label>
                      </div>

                      {svc.overLimitInsuranceWise && (() => {
                        const selectedIds = svc.overLimitInsurerIds || [];
                        const olKey = `ol-${idx}`;
                        const filtered = insurers.filter(i =>
                          (i.name || '').toLowerCase().includes((insurerDropdownOpen === olKey ? insurerSearch : '').toLowerCase())
                        );
                        return (
                          <div className="md:col-span-3">
                            {selectedIds.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mb-2">
                                {selectedIds.map(id => {
                                  const ins = insurers.find(i => (i.id || i._id) === id);
                                  return (
                                    <span key={id} className="inline-flex items-center gap-1 bg-primary-100 text-primary-700 text-xs font-medium px-2.5 py-1 rounded-full">
                                      {ins?.name || id}
                                      <button type="button" onClick={() => toggleInsurer(idx, id)}
                                        className="ml-0.5 hover:text-primary-900 leading-none">&times;</button>
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="Search and select insurance company..."
                                value={insurerDropdownOpen === olKey ? insurerSearch : ''}
                                onFocus={() => { setInsurerDropdownOpen(olKey); setInsurerSearch(''); }}
                                onChange={(e) => setInsurerSearch(e.target.value)}
                                onBlur={() => setTimeout(() => setInsurerDropdownOpen(null), 150)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                              />
                              {insurerDropdownOpen === olKey && (
                                <div className="absolute top-full mt-1 left-0 right-0 z-30 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                                  {filtered.length === 0 ? (
                                    <p className="text-xs text-gray-400 px-3 py-3">No results</p>
                                  ) : filtered.map(ins => {
                                    const insId = ins.id || ins._id;
                                    const isSelected = selectedIds.includes(insId);
                                    return (
                                      <button key={insId} type="button"
                                        onMouseDown={(e) => { e.preventDefault(); toggleInsurer(idx, insId); }}
                                        className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 ${isSelected ? 'text-primary-700 font-medium' : 'text-gray-700'}`}>
                                        <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-xs ${isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'border-gray-300'}`}>
                                          {isSelected && '✓'}
                                        </span>
                                        {ins.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            {selectedIds.length > 0 && (
                              <div className="mt-2 bg-primary-50 border border-primary-100 rounded-lg px-4 py-2.5 flex items-center justify-between">
                                <span className="text-xs text-gray-600">
                                  {selectedIds.length} insurer{selectedIds.length > 1 ? 's' : ''} &times; Rs {formatINR(svc.overLimitPerClaimAmount || 0)} per claim
                                </span>
                                <span className="text-sm font-semibold text-primary-700">
                                  Total: Rs {formatINR(selectedIds.length * (svc.overLimitPerClaimAmount || 0))}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {(svc.billingType === 'percentage' ||
                    (svc.billingType === 'fixed_monthly' && svc.overLimitBehavior === 'percentage')) && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Calculation Basis</label>
                        <select value={svc.calculationBasis}
                          onChange={(e) => handleServiceChange(idx, 'calculationBasis', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                          <option value="hospital_final_bill">Hospital Final Bill</option>
                          <option value="final_approval">Final Approval Amount</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">Percentage Rate (%)</label>
                        <input type="number" step="0.01" min="0" max="100" value={svc.percentageRate}
                          onChange={(e) => handleServiceChange(idx, 'percentageRate', Number(e.target.value))}
                          placeholder="e.g. 2.5"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                      </div>
                    </>
                  )}

                  {showSlabs && (
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Calculation Basis</label>
                      <select value={svc.calculationBasis}
                        onChange={(e) => handleServiceChange(idx, 'calculationBasis', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                        <option value="hospital_final_bill">Hospital Final Bill</option>
                        <option value="final_approval">Final Approval Amount</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Slab tiers — dynamic multi-row table */}
                {showSlabs && (
                  <div className="mt-4 border-t border-gray-100 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Slab Tiers</span>
                      <button type="button" onClick={() => addSlab(idx)}
                        className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium border border-primary-200 hover:bg-primary-50 px-2.5 py-1 rounded-lg transition-colors">
                        <HiOutlinePlus className="w-3 h-3" /> Add Tier
                      </button>
                    </div>

                    {svcSlabs.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-3 border border-dashed border-gray-200 rounded-lg">
                        No slab tiers defined. Click "+ Add Tier" to add one.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <div className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2 px-1">
                          <span className="text-xs font-medium text-gray-500">From (Rs)</span>
                          <span className="text-xs font-medium text-gray-500">To (Rs)</span>
                          <span className="text-xs font-medium text-gray-500">Price (Rs)</span>
                          <span></span>
                        </div>
                        {svcSlabs.map((slab, slabIdx) => (
                          <div key={slabIdx} className="grid grid-cols-[1fr_1fr_1fr_2rem] gap-2 items-center">
                            <AmountInput
                              value={slab.rangeStart}
                              onChange={(v) => handleSlabChange(idx, slabIdx, 'rangeStart', v)}
                              placeholder="0"
                              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            <AmountInput
                              value={slab.rangeEnd}
                              onChange={(v) => handleSlabChange(idx, slabIdx, 'rangeEnd', v)}
                              placeholder="50,000"
                              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            <AmountInput
                              value={slab.price}
                              onChange={(v) => handleSlabChange(idx, slabIdx, 'price', v)}
                              placeholder="2,000"
                              className="w-full px-2.5 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                            />
                            <button type="button" onClick={() => removeSlab(idx, slabIdx)}
                              className="flex items-center justify-center p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                              <HiOutlineTrash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50">
            {loading ? 'Saving...' : isEdit ? 'Update Hospital' : 'Create Hospital'}
          </button>
          <button type="button" onClick={() => navigate('/hospitals')}
            className="bg-white border border-gray-300 text-gray-700 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default HospitalForm;
