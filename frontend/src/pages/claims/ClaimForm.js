import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClaimAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI } from '../../services/api';
import { toast } from 'react-toastify';

const ClaimForm = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [insurances, setInsurances] = useState([]);
  const [tpas, setTPAs] = useState([]);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    hospital: '', month: new Date().toISOString().slice(0, 7),
    patientName: '', patientMobile: '', doctorName: '',
    claimType: 'cashless',
    insuranceCompany: '', tpa: '',
    policyNo: '', clientId: '', ccnNo: '',
    dateOfAdmit: new Date().toISOString().slice(0, 10),
    dateOfDischarge: '',
  });

  useEffect(() => {
    Promise.all([
      getHospitalsAPI({ active: 'true' }),
      getInsuranceAPI(),
      getTPAAPI()
    ]).then(([h, i, t]) => {
      setHospitals(h.data);
      setInsurances(i.data);
      setTPAs(t.data);
    });
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const submitData = { ...form };
      // Convert month string to date
      submitData.month = new Date(form.month + '-01');
      if (!submitData.tpa) delete submitData.tpa;
      if (!submitData.dateOfDischarge) delete submitData.dateOfDischarge;

      const { data } = await createClaimAPI(submitData);
      toast.success('Claim created successfully');
      navigate(`/claims/${data._id}`);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to create claim');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-800 mb-6">New Claim - Patient Admit</h1>

      <form onSubmit={handleSubmit}>
        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Patient & Admission Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
              <select name="hospital" value={form.hospital} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                <option value="">Select Hospital</option>
                {hospitals.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
              <input type="month" name="month" value={form.month} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Claim Type *</label>
              <select name="claimType" value={form.claimType} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                <option value="cashless">Cashless</option>
                <option value="reimbursement">Reimbursement</option>
                <option value="grievance">Grievance</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name *</label>
              <input name="patientName" value={form.patientName} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient Mobile</label>
              <input name="patientMobile" value={form.patientMobile} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Doctor Name</label>
              <input name="doctorName" value={form.doctorName} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Insurance & Policy Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Company *</label>
              <select name="insuranceCompany" value={form.insuranceCompany} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                <option value="">Select Insurance</option>
                {insurances.map(i => <option key={i._id} value={i._id}>{i.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TPA</label>
              <select name="tpa" value={form.tpa} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                <option value="">None / Direct</option>
                {tpas.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number</label>
              <input name="policyNo" value={form.policyNo} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
              <input name="clientId" value={form.clientId} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CCN Number</label>
              <input name="ccnNo" value={form.ccnNo} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Admission Dates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Admit *</label>
              <input type="date" name="dateOfAdmit" value={form.dateOfAdmit} onChange={handleChange} required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Discharge</label>
              <input type="date" name="dateOfDischarge" value={form.dateOfDischarge} onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Claim'}
          </button>
          <button type="button" onClick={() => navigate('/claims')}
            className="bg-white border border-gray-300 text-gray-700 px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClaimForm;
