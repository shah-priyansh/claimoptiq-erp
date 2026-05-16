import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  createClaimAPI, updateClaimAPI, getClaimAPI,
  getHospitalsAPI, getInsuranceAPI, getTPAAPI,
  updateSubmissionAPI, uploadDocumentsAPI, deleteDocumentAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { isValidPhone, onPhoneInput, inputCls } from '../../utils/validators';
import SearchableSelect from '../../components/ui/SearchableSelect';
import {
  HiOutlineDocumentText, HiOutlineX, HiOutlineUpload,
  HiOutlineTrash, HiOutlineDownload,
} from 'react-icons/hi';

const isImage = (name) => /\.(jpe?g|png)$/i.test(name || '');

const baseUrl = process.env.REACT_APP_API_URL === '/api'
  ? ''
  : (process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001');

const claimTypeCls = (active) =>
  `flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all ${
    active
      ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
      : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
  }`;

const ClaimForm = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const fromSubmissionId = searchParams.get('submissionId') || '';
  const fromPatientName  = searchParams.get('patientName')  || '';

  const isHospitalUser = !!user?.hospital;

  const [hospitals, setHospitals] = useState([]);
  const [insurances, setInsurances] = useState([]);
  const [tpas, setTPAs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [mobileError, setMobileError] = useState('');

  // Admission document states
  const [pendingAdmissionFiles, setPendingAdmissionFiles] = useState([]);
  const [existingAdmissionDocs, setExistingAdmissionDocs] = useState([]);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [pendingPreview, setPendingPreview] = useState(null);

  const [form, setForm] = useState({
    hospital: user?.hospital?._id || '', month: new Date().toISOString().slice(0, 7),
    patientName: fromPatientName, patientMobile: '', doctorName: '',
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
      getTPAAPI(),
    ]).then(([h, i, t]) => {
      setHospitals(h.data);
      setInsurances(i.data);
      setTPAs(t.data);
    }).finally(() => setDataLoading(false));

    if (isEdit) {
      getClaimAPI(id).then(({ data }) => {
        setForm({
          hospital: data.hospital?._id || data.hospital || '',
          month: data.month ? new Date(data.month).toISOString().slice(0, 7) : '',
          patientName: data.patientName || '',
          patientMobile: data.patientMobile || '',
          doctorName: data.doctorName || '',
          claimType: data.claimType || 'cashless',
          insuranceCompany: data.insuranceCompany?._id || data.insuranceCompany || '',
          tpa: data.tpa?._id || data.tpa || '',
          policyNo: data.policyNo || '',
          clientId: data.clientId || '',
          ccnNo: data.ccnNo || '',
          dateOfAdmit: data.dateOfAdmit ? new Date(data.dateOfAdmit).toISOString().slice(0, 10) : '',
          dateOfDischarge: data.dateOfDischarge ? new Date(data.dateOfDischarge).toISOString().slice(0, 10) : '',
        });
        setExistingAdmissionDocs(
          (data.documents || []).filter(d => d.category === 'admission')
        );
      }).catch(() => {
        toast.error('Claim not found');
        navigate('/claims');
      });
    }
  }, [id, isEdit, navigate]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));
  const handleChange = (e) => set(e.target.name, e.target.value);

  const handleMobileChange = (e) => {
    const val = onPhoneInput(e.target.value);
    set('patientMobile', val);
    setMobileError(val && !isValidPhone(val) ? 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' : '');
  };

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const entries = files.map(f => ({ file: f, previewUrl: URL.createObjectURL(f) }));
    setPendingAdmissionFiles(p => [...p, ...entries]);
    e.target.value = '';
  };

  const removePendingFile = (idx) => {
    setPendingAdmissionFiles(p => {
      const arr = [...p];
      URL.revokeObjectURL(arr[idx].previewUrl);
      arr.splice(idx, 1);
      return arr;
    });
  };

  const handleDeleteExistingDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    setDeletingDocId(docId);
    try {
      await deleteDocumentAPI(id, docId);
      setExistingAdmissionDocs(prev => prev.filter(d => d._id !== docId));
      toast.success('Document deleted');
    } catch {
      toast.error('Failed to delete');
    } finally {
      setDeletingDocId(null);
    }
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

      let claimId;
      if (isEdit) {
        await updateClaimAPI(id, submitData);
        claimId = id;
        toast.success('Claim updated successfully');
      } else {
        const { data } = await createClaimAPI(submitData);
        claimId = data._id;
        if (fromSubmissionId) {
          try { await updateSubmissionAPI(fromSubmissionId, { status: 'claimed', claim: data._id }); } catch { }
        }
        toast.success('Claim created successfully');
      }

      // Upload pending admission documents
      if (pendingAdmissionFiles.length) {
        const fd = new FormData();
        pendingAdmissionFiles.forEach(f => fd.append('files', f.file));
        fd.append('category', 'admission');
        await uploadDocumentsAPI(claimId, fd);
        pendingAdmissionFiles.forEach(f => URL.revokeObjectURL(f.previewUrl));
      }

      navigate(`/claims/${claimId}`);
    } catch (error) {
      toast.error(error.response?.data?.message || (isEdit ? 'Failed to update claim' : 'Failed to create claim'));
    } finally {
      setLoading(false);
    }
  };

  const hospitalOptions  = hospitals.map(h => ({ value: h._id, label: h.name }));
  const insuranceOptions = insurances.map(i => ({ value: i._id, label: i.name }));
  const tpaOptions       = tpas.map(t => ({ value: t._id, label: t.name }));

  const hasDocs = existingAdmissionDocs.length > 0 || pendingAdmissionFiles.length > 0;

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-800 mb-6">
        {isEdit ? 'Edit Claim' : 'New Claim — Patient Admit'}
      </h1>

      {fromSubmissionId && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
          <HiOutlineDocumentText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-blue-800">Creating claim from document submission</p>
            <p className="text-xs text-blue-600 mt-0.5">Patient name is pre-filled. The submission will be marked as <strong>Claimed</strong> automatically on submit.</p>
          </div>
          <button type="button" onClick={() => navigate('/documents/inbox')}
            className="text-blue-400 hover:text-blue-600 flex-shrink-0 p-0.5">
            <HiOutlineX className="w-4 h-4" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Patient & Admission */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Patient & Admission Details</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {!isHospitalUser && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hospital *</label>
                <SearchableSelect options={hospitalOptions} value={form.hospital}
                  onChange={val => set('hospital', val)} placeholder="Select Hospital"
                  searchPlaceholder="Search hospitals..." isLoading={dataLoading} required />
              </div>
            )}
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
              <SearchableSelect options={insuranceOptions} value={form.insuranceCompany}
                onChange={val => set('insuranceCompany', val)} placeholder="Select Insurance"
                searchPlaceholder="Search insurance companies..." isLoading={dataLoading} required />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">TPA</label>
              <SearchableSelect options={tpaOptions} value={form.tpa}
                onChange={val => set('tpa', val)} placeholder="None / Direct"
                searchPlaceholder="Search TPA..." isLoading={dataLoading}
                noneLabel="None / Direct" allowClear />
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
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
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

        {/* Admission Documents */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-semibold text-gray-800">Admission Documents</h2>
              <p className="text-xs text-gray-400 mt-0.5">Insurance cards, auth letters, prescription, ID proof, etc.</p>
            </div>
            <label className="inline-flex items-center gap-2 border border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50/30 text-gray-500 hover:text-primary-600 px-3 py-2 rounded-xl text-sm font-medium cursor-pointer transition-all flex-shrink-0">
              <HiOutlineUpload className="w-4 h-4" />
              <span>Select Files</span>
              <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                onChange={handleFileSelect} />
            </label>
          </div>

          {!hasDocs && (
            <div className="border-2 border-dashed border-gray-200 rounded-xl py-8 text-center">
              <HiOutlineDocumentText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-sm text-gray-400">No documents added yet</p>
              <p className="text-xs text-gray-300 mt-0.5">Select files above to attach admission documents</p>
            </div>
          )}

          {hasDocs && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {/* Existing saved docs (edit mode) */}
              {existingAdmissionDocs.map(doc => {
                const url = `${baseUrl}/uploads/${doc.fileName}`;
                const img = isImage(doc.fileName);
                const isDeleting = deletingDocId === doc._id;
                return (
                  <div key={doc._id}
                    className={`border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-all group ${isDeleting ? 'opacity-50' : ''}`}>
                    <button type="button" onClick={() => setPendingPreview({ url, name: doc.originalName })}
                      className="w-full h-28 bg-gray-50 flex items-center justify-center overflow-hidden focus:outline-none">
                      {img ? (
                        <img src={url} alt={doc.originalName}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      ) : (
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="bg-red-50 rounded-xl p-3">
                            <HiOutlineDocumentText className="w-7 h-7 text-red-400" />
                          </div>
                          <span className="text-[10px] font-bold text-red-400 uppercase">PDF</span>
                        </div>
                      )}
                    </button>
                    <div className="px-2.5 py-2 border-t border-gray-100">
                      <p className="text-xs font-medium text-gray-800 truncate mb-1.5" title={doc.originalName}>
                        {doc.originalName}
                      </p>
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] text-gray-400">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                        <div className="flex items-center gap-0.5">
                          <a href={url} download={doc.originalName}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                            onClick={e => e.stopPropagation()}>
                            <HiOutlineDownload className="w-3.5 h-3.5" />
                          </a>
                          <button type="button" onClick={() => handleDeleteExistingDoc(doc._id)}
                            disabled={isDeleting}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            {isDeleting
                              ? <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                              : <HiOutlineTrash className="w-3.5 h-3.5" />
                            }
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Pending (not yet uploaded) files */}
              {pendingAdmissionFiles.map((entry, idx) => {
                const img = isImage(entry.file.name);
                return (
                  <div key={idx}
                    className="border-2 border-dashed border-amber-300 rounded-xl overflow-hidden bg-amber-50/30 group relative">
                    <button type="button" onClick={() => setPendingPreview({ url: entry.previewUrl, name: entry.file.name })}
                      className="w-full h-28 flex items-center justify-center overflow-hidden focus:outline-none">
                      {img ? (
                        <img src={entry.previewUrl} alt={entry.file.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      ) : (
                        <div className="flex flex-col items-center gap-1.5">
                          <div className="bg-red-50 rounded-xl p-3">
                            <HiOutlineDocumentText className="w-7 h-7 text-red-400" />
                          </div>
                          <span className="text-[10px] font-bold text-red-400 uppercase">PDF</span>
                        </div>
                      )}
                    </button>
                    <div className="px-2.5 py-2 border-t border-amber-200">
                      <p className="text-xs font-medium text-gray-800 truncate mb-1.5" title={entry.file.name}>
                        {entry.file.name}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-400">{(entry.file.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={() => removePendingFile(idx)}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <HiOutlineTrash className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <span className="absolute top-1.5 left-1.5 bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">
                      PENDING
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {pendingAdmissionFiles.length > 0 && (
            <p className="text-xs text-amber-600 mt-3 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              {pendingAdmissionFiles.length} file{pendingAdmissionFiles.length !== 1 ? 's' : ''} will be uploaded when you {isEdit ? 'save changes' : 'create the claim'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={loading}
            className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-3 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors">
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                <span>{isEdit ? 'Saving...' : 'Creating...'}</span>
              </>
            ) : (
              isEdit ? 'Save Changes' : 'Create Claim'
            )}
          </button>
          <button type="button" onClick={() => navigate('/claims')}
            className="bg-white border border-gray-300 text-gray-700 px-6 py-3 rounded-lg text-sm font-medium hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </form>

      {/* Document preview modal */}
      {pendingPreview && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
          <div className="flex items-center gap-3 px-4 py-3 bg-black/60 flex-shrink-0">
            <button onClick={() => setPendingPreview(null)}
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
              <HiOutlineX className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{pendingPreview.name}</p>
              {pendingPreview.isPending && (
                <p className="text-xs text-amber-400 font-medium">Pending — will upload on save</p>
              )}
            </div>
            {!pendingPreview.isPending && (
              <a href={pendingPreview.url} download={pendingPreview.name}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0">
                <HiOutlineDownload className="w-4 h-4" /> Download
              </a>
            )}
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            {isImage(pendingPreview.name)
              ? <img src={pendingPreview.url} alt={pendingPreview.name} className="max-h-full max-w-full object-contain rounded-lg" />
              : <iframe src={pendingPreview.url} title={pendingPreview.name} className="w-full h-full rounded-lg bg-white" />
            }
          </div>
          <div className="flex items-center justify-center py-2.5 bg-black/60 flex-shrink-0">
            <p className="text-[11px] text-white/30">Esc to close</p>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default ClaimForm;
