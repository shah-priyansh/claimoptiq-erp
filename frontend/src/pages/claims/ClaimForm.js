import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createClaimAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI } from '../../services/api';
import { toast } from 'react-toastify';
import { isValidPhone, onPhoneInput, inputCls } from '../../utils/validators';
import SearchableSelect from '../../components/ui/SearchableSelect';

const claimTypeCls = (active) =>
  `flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
    active
      ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
  }`;

const ClaimForm = () => {
  const navigate = useNavigate();
  const [hospitals, setHospitals] = useState([]);
  const [insurances, setInsurances] = useState([]);
  const [tpas, setTPAs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [mobileError, setMobileError] = useState('');

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

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleChange = (e) => set(e.target.name, e.target.value);

  const handleMobileChange = (e) => {
    const val = onPhoneInput(e.target.value);
    set('patientMobile', val);
    setMobileError(val && !isValidPhone(val) ? 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' : '');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.patientMobile && !isValidPhone(form.patientMobile)) {
      setMobileError('Enter a valid 10-digit Indian mobile number (starts with 6-9)');
      return;
    }
    setLoading(true);
    try {
      const submitData = { ...form };
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

  const hospitalOptions   = hospitals.map(h => ({ value: h._id, label: h.name }));
  const insuranceOptions  = insurances.map(i => ({ value: i._id, label: i.name }));
  const tpaOptions        = tpas.map(t => ({ value: t._id, label: t.name }));

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">New Claim — Patient Admit</h1>

      <form onSubmit={handleSubmit}>
        {/* Patient & Admission */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Patient & Admission Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
              <SearchableSelect
                options={hospitalOptions}
                value={form.hospital}
                onChange={val => set('hospital', val)}
                placeholder="Select Hospital"
                searchPlaceholder="Search hospitals..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Month *</label>
              <input type="month" name="month" value={form.month} onChange={handleChange} required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Claim Type *</label>
              <div className="flex gap-2">
                {['cashless', 'reimbursement', 'grievance'].map(t => (
                  <button key={t} type="button" onClick={() => set('claimType', t)}
                    className={claimTypeCls(form.claimType === t)}>
                    {t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Patient Name *</label>
              <input name="patientName" value={form.patientName} onChange={handleChange} required
                placeholder="Full name"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Patient Mobile <span className="text-gray-400 font-normal">(10 digits)</span>
              </label>
              <input name="patientMobile" value={form.patientMobile} onChange={handleMobileChange}
                inputMode="numeric" maxLength={10}
                className={inputCls(!!mobileError)} placeholder="e.g. 9876543210" />
              {form.patientMobile && <p className="text-xs text-gray-400 mt-1">{form.patientMobile.length}/10 digits</p>}
              {mobileError && <p className="text-xs text-red-500 mt-0.5">{mobileError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Doctor Name</label>
              <input name="doctorName" value={form.doctorName} onChange={handleChange}
                placeholder="Attending doctor"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        {/* Insurance & Policy */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Insurance & Policy Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Insurance Company *</label>
              <SearchableSelect
                options={insuranceOptions}
                value={form.insuranceCompany}
                onChange={val => set('insuranceCompany', val)}
                placeholder="Select Insurance"
                searchPlaceholder="Search insurance companies..."
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TPA</label>
              <SearchableSelect
                options={tpaOptions}
                value={form.tpa}
                onChange={val => set('tpa', val)}
                placeholder="None / Direct"
                searchPlaceholder="Search TPA..."
                noneLabel="None / Direct"
                allowClear
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Policy Number</label>
              <input name="policyNo" value={form.policyNo} onChange={handleChange}
                placeholder="e.g. POL123456"
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client ID</label>
              <input name="clientId" value={form.clientId} onChange={handleChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CCN Number</label>
              <input name="ccnNo" value={form.ccnNo} onChange={handleChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Admission Dates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Admit *</label>
              <input type="date" name="dateOfAdmit" value={form.dateOfAdmit} onChange={handleChange} required
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date of Discharge</label>
              <input type="date" name="dateOfDischarge" value={form.dateOfDischarge} onChange={handleChange}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg text-sm font-medium disabled:opacity-50">
            {loading ? 'Creating...' : 'Create Claim'}
          </button>
          <button type="button" onClick={() => navigate('/claims')}
            className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default ClaimForm;
