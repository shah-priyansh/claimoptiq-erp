import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { createHospitalAPI, updateHospitalAPI, getHospitalAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi';

const emptyService = {
  serviceName: '',
  billingType: 'fixed_monthly',
  fixedAmount: 0,
  claimLimit: 0,
  slabRangeStart: 0,
  slabRangeEnd: 50000,
  slabBasePrice: 2000,
  slabIncrementRange: 50000,
  slabIncrementPrice: 500,
  calculationBasis: 'none',
  isActive: true,
};

const HospitalForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [form, setForm] = useState({
    name: '', contact: '', email: '', phone: '', address: '',
    city: '', state: '', pincode: '', referenceBy: '',
    billingServices: [],
  });
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

  const handleSubmit = async (e) => {
    e.preventDefault();
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
    <div className="max-w-4xl mx-auto">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input name="phone" value={form.phone} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input name="email" type="email" value={form.email} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Pincode</label>
              <input name="pincode" value={form.pincode} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">Claim Limit</label>
                    <input type="number" value={svc.claimLimit}
                      onChange={(e) => handleServiceChange(idx, 'claimLimit', Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  </div>
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
