import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createHospitalAPI, updateHospitalAPI, getHospitalAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineUserCircle } from 'react-icons/hi';
import { isValidEmail, isValidPhone, isValidPincode, onPhoneInput, inputCls } from '../../utils/validators';

const emptyDoctor = { name: '', specialization: '', phone: '', email: '' };

const emptyService = {
  serviceName: '',
  billingType: 'fixed_monthly',
  fixedAmount: 0,
  claimLimit: 0,
  overLimitBehavior: 'no_charge',
  overLimitPerClaimAmount: 0,
  slabRangeStart: 0,
  slabRangeEnd: 50000,
  slabBasePrice: 2000,
  slabIncrementRange: 50000,
  slabIncrementPrice: 500,
  calculationBasis: 'none',
  percentageRate: 0,
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

  useEffect(() => {
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

  const addService = () => {
    setForm({ ...form, billingServices: [...form.billingServices, { ...emptyService }] });
  };

  const removeService = (idx) => {
    const services = form.billingServices.filter((_, i) => i !== idx);
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

          {form.billingServices.map((svc, idx) => (
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
                  <input value={svc.serviceName} onChange={(e) => handleServiceChange(idx, 'serviceName', e.target.value)}
                    placeholder="e.g. TPA Desk Services"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
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

                {(svc.billingType === 'fixed_monthly' || svc.billingType === 'fixed_onetime') && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fixed Amount (Rs)</label>
                    <input type="number" value={svc.fixedAmount}
                      onChange={(e) => handleServiceChange(idx, 'fixedAmount', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                )}

                {svc.billingType === 'fixed_monthly' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">
                      Claim Limit <span className="text-gray-400 font-normal">(0 = unlimited)</span>
                    </label>
                    <input type="number" value={svc.claimLimit}
                      onChange={(e) => handleServiceChange(idx, 'claimLimit', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                )}

                {svc.billingType === 'fixed_monthly' && svc.claimLimit > 0 && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">When Limit is Exceeded</label>
                    <select value={svc.overLimitBehavior}
                      onChange={(e) => handleServiceChange(idx, 'overLimitBehavior', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                      <option value="no_charge">Continue — No Extra Charge</option>
                      <option value="per_claim">Fixed Fee Per Extra Claim</option>
                      <option value="percentage">Percentage of Claim Amount</option>
                      <option value="per_claim_slab">Per Claim Slab</option>
                      <option value="stop">Stop — Do Not Accept New Claims</option>
                    </select>
                  </div>
                )}

                {/* Over-limit: flat fee */}
                {svc.billingType === 'fixed_monthly' && svc.claimLimit > 0 && svc.overLimitBehavior === 'per_claim' && (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fixed Fee Per Extra Claim (Rs)</label>
                    <input type="number" value={svc.overLimitPerClaimAmount}
                      onChange={(e) => handleServiceChange(idx, 'overLimitPerClaimAmount', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
                )}

                {/* Over-limit: percentage */}
                {svc.billingType === 'fixed_monthly' && svc.claimLimit > 0 && svc.overLimitBehavior === 'percentage' && (
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

                {/* Over-limit: per claim slab — reuses slab fields */}
                {svc.billingType === 'fixed_monthly' && svc.claimLimit > 0 && svc.overLimitBehavior === 'per_claim_slab' && (
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
                      <label className="block text-xs font-medium text-gray-600 mb-1">Slab Range (0 to Rs)</label>
                      <input type="number" value={svc.slabRangeEnd}
                        onChange={(e) => handleServiceChange(idx, 'slabRangeEnd', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Base Price (Rs)</label>
                      <input type="number" value={svc.slabBasePrice}
                        onChange={(e) => handleServiceChange(idx, 'slabBasePrice', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Extra Per (Rs)</label>
                      <input type="number" value={svc.slabIncrementRange}
                        onChange={(e) => handleServiceChange(idx, 'slabIncrementRange', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Extra Price (Rs)</label>
                      <input type="number" value={svc.slabIncrementPrice}
                        onChange={(e) => handleServiceChange(idx, 'slabIncrementPrice', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                  </>
                )}

                {svc.billingType === 'percentage' && (
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

                {svc.billingType === 'per_claim_slab' && (
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
                      <label className="block text-xs font-medium text-gray-600 mb-1">Slab Range (0 to Rs)</label>
                      <input type="number" value={svc.slabRangeEnd}
                        onChange={(e) => handleServiceChange(idx, 'slabRangeEnd', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Base Price (Rs)</label>
                      <input type="number" value={svc.slabBasePrice}
                        onChange={(e) => handleServiceChange(idx, 'slabBasePrice', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Extra Per (Rs)</label>
                      <input type="number" value={svc.slabIncrementRange}
                        onChange={(e) => handleServiceChange(idx, 'slabIncrementRange', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Extra Price (Rs)</label>
                      <input type="number" value={svc.slabIncrementPrice}
                        onChange={(e) => handleServiceChange(idx, 'slabIncrementPrice', Number(e.target.value))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
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
