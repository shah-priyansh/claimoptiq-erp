import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { getClaimAPI, updateClaimAPI, uploadDocumentsAPI, deleteDocumentAPI, getClaimStatusesAPI, getClaimDocumentTypesAPI, getHospitalsAPI, getInsuranceAPI, getTPAAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import DateInput from '../../components/ui/DateInput';
import {
  HiOutlineArrowLeft, HiOutlineUpload, HiOutlineTrash, HiOutlineDownload,
  HiOutlineDocumentText, HiChevronDown, HiCheck, HiOutlineSearch,
  HiOutlineX, HiOutlineChevronLeft, HiOutlineChevronRight,
  HiOutlineUser, HiOutlineCash, HiOutlineTruck,
  HiOutlineShieldCheck, HiOutlinePencil, HiOutlineCalendar,
  HiOutlineClipboardList, HiOutlinePrinter,
} from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency, calculateFilePrice } from '../../utils/format';
import AmountInput from '../../components/AmountInput';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { isValidPhone, onPhoneInput } from '../../utils/validators';

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  admission: 'Admission', discharge: 'Discharge', pod: 'POD / Bill',
  settlement_proof: 'Settlement Proof', other: 'Other',
};
const CATEGORY_ORDER = ['admission', 'discharge', 'pod', 'settlement_proof', 'other'];
const isImage = (name) => /\.(jpe?g|png)$/i.test(name || '');

// Compact duration between two timestamps, e.g. "12m", "5h 20m", "3d 4h", "2mo"
const formatElapsed = (ms) => {
  if (!ms || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) {
    const rm = mins % 60;
    return rm ? `${hrs}h ${rm}m` : `${hrs}h`;
  }
  const days = Math.floor(hrs / 24);
  if (days < 30) {
    const rh = hrs % 24;
    return rh ? `${days}d ${rh}h` : `${days}d`;
  }
  const months = Math.floor(days / 30);
  return `${months}mo`;
};


// ── Micro components ─────────────────────────────────────────────────────────
const Spinner = ({ sm }) => (
  <div className={`border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0 ${sm ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
);

const SectionHeader = ({ icon: Icon, title }) => (
  <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
    <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
      <Icon className="w-4 h-4 text-primary-600" />
    </div>
    <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
  </div>
);

const InfoRow = ({ label, value }) => (
  <div className="flex justify-between gap-4 py-2.5 border-b border-gray-50 last:border-0">
    <span className="text-sm text-gray-400 flex-shrink-0">{label}</span>
    <span className="text-sm font-medium text-gray-800 text-right capitalize">{value}</span>
  </div>
);

const StatCard = ({ label, value, highlight }) => (
  <div className={`rounded-xl p-4 ${highlight ? 'bg-primary-50 border border-primary-100' : 'bg-gray-50 border border-gray-100'}`}>
    <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${highlight ? 'text-primary-500' : 'text-gray-400'}`}>{label}</p>
    <p className={`text-sm font-bold ${highlight ? 'text-primary-700' : 'text-gray-800'}`}>{value}</p>
  </div>
);

// Pending doc grid (used on sub-tabs where category is fixed)
const PendingDocGrid = ({ files, onPreview, onRemove }) => {
  if (!files || files.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse" />
        <p className="text-[11px] font-semibold text-primary-600 uppercase tracking-wider">
          {files.length} file{files.length !== 1 ? 's' : ''} pending — saved with form
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {files.map((entry, idx) => {
          const img = isImage(entry.file.name);
          return (
            <div key={idx} className="border border-dashed border-primary-200 rounded-xl overflow-hidden bg-primary-50/20 group relative">
              <button type="button" onClick={() => onPreview(entry)}
                className="w-full h-24 flex items-center justify-center overflow-hidden focus:outline-none">
                {img ? (
                  <img src={entry.previewUrl} alt={entry.file.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="bg-white rounded-lg p-2.5 shadow-sm">
                      <HiOutlineDocumentText className="w-6 h-6 text-gray-400" />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">PDF</span>
                  </div>
                )}
              </button>
              <div className="px-2.5 py-2 border-t border-primary-100 bg-white/60">
                <p className="text-xs font-medium text-gray-700 truncate mb-1.5" title={entry.file.name}>{entry.file.name}</p>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-gray-400">{(entry.file.size / 1024).toFixed(0)} KB</span>
                  <button onClick={() => onRemove(idx)}
                    className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                    <HiOutlineTrash className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <span className="absolute top-1.5 left-1.5 bg-primary-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full leading-tight">
                UNSAVED
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Saved doc grid (used on sub-tabs and docs tab)
const DocMiniGrid = ({ docs, onPreview, onDelete, isEditable, deletingDocId }) => {
  if (!docs || docs.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {docs.length} saved file{docs.length !== 1 ? 's' : ''}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {docs.map(doc => {
          const img = isImage(doc.fileName);
          const isDeleting = deletingDocId === doc._id;
          return (
            <div key={doc._id}
              className={`border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-primary-200 transition-all group ${isDeleting ? 'opacity-50' : ''}`}>
              <button type="button" onClick={() => !isDeleting && onPreview(doc._origIdx)}
                className="w-full h-24 bg-gray-50 flex items-center justify-center overflow-hidden focus:outline-none">
                {img ? (
                  <img src={doc._url} alt={doc.originalName}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="bg-white rounded-lg p-2.5 shadow-sm">
                      <HiOutlineDocumentText className="w-6 h-6 text-gray-400" />
                    </div>
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">PDF</span>
                  </div>
                )}
              </button>
              <div className="px-2.5 py-2 border-t border-gray-100">
                <p className="text-xs font-medium text-gray-700 truncate mb-1.5" title={doc.originalName}>{doc.originalName}</p>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] text-gray-400">{(doc.fileSize / 1024).toFixed(0)} KB</span>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <a href={doc._url} download={doc.originalName}
                      className="p-1 text-gray-300 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                      onClick={e => e.stopPropagation()}>
                      <HiOutlineDownload className="w-3.5 h-3.5" />
                    </a>
                    {isEditable && (
                      <button onClick={() => onDelete(doc._id)} disabled={isDeleting}
                        className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors disabled:cursor-not-allowed">
                        {isDeleting
                          ? <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                          : <HiOutlineTrash className="w-3.5 h-3.5" />
                        }
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Reusable upload button label
const UploadLabel = ({ onChange, label }) => (
  <label className="inline-flex items-center gap-2 text-sm font-medium text-primary-600 border border-primary-200 hover:bg-primary-50 px-3 py-1.5 rounded-lg cursor-pointer transition-all">
    <HiOutlineUpload className="w-4 h-4" /> {label}
    <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={onChange} />
  </label>
);

// ── Main component ────────────────────────────────────────────────────────────
const ClaimDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, roleSlug } = useAuth();
  const isSuperAdmin = roleSlug === 'super_admin';
  const confirm = useConfirm();
  const [claim, setClaim] = useState(null);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const VALID_TABS = ['overview', 'admission', 'discharge', 'file_submit', 'settlement', 'documents'];
  const tabParam = searchParams.get('tab');
  const activeTab = VALID_TABS.includes(tabParam) ? tabParam : 'overview';
  const changeTab = (key) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next, { replace: true });
  };
  const [saving, setSaving] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusDropOpen, setStatusDropOpen] = useState(false);
  const [statusDropPos, setStatusDropPos] = useState({ top: 0, left: 0 });
  const [statusSearch, setStatusSearch] = useState('');
  const [rejectionModal, setRejectionModal] = useState(false);
  const [rejectionInput, setRejectionInput] = useState('');
  const statusBtnRef = useRef(null);
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pendingFiles, setPendingFiles] = useState({ admission: [], discharge: [], pod: [], settlement_proof: [], other: [] });
  const [pendingPreview, setPendingPreview] = useState(null);

  const [hospitals, setHospitals] = useState([]);
  const [insurances, setInsurances] = useState([]);
  const [tpas, setTPAs] = useState([]);
  const [stickerOpen, setStickerOpen] = useState(false);
  const [dischargeForm, setDischargeForm] = useState({});
  const [admissionForm, setAdmissionForm] = useState({});
  const [mobileError, setMobileError] = useState('');
  const [fileForm, setFileForm] = useState({});
  const [settlementForm, setSettlementForm] = useState({});
  const [filePriceManual, setFilePriceManual] = useState(false);
  const [savingFilePrice, setSavingFilePrice] = useState(false);

  useEffect(() => {
    setDischargeForm(prev => ({
      ...prev,
      finalApprovalAmount: Math.max(0, (prev.hospitalFinalBill || 0) - (prev.mouDiscount || 0) - (prev.deduction || 0)),
    }));
  }, [dischargeForm.hospitalFinalBill, dischargeForm.mouDiscount, dischargeForm.deduction]);

  useEffect(() => {
    setSettlementForm(prev => ({
      ...prev,
      settlementAmount:
        (dischargeForm.finalApprovalAmount || claim?.finalApprovalAmount || 0) -
        (prev.settlementAmountDeduction || 0) -
        (prev.mouDiscountOnSettlement || 0),
    }));
  }, [dischargeForm.finalApprovalAmount, claim?.finalApprovalAmount, settlementForm.settlementAmountDeduction, settlementForm.mouDiscountOnSettlement]);

  useEffect(() => {
    if (filePriceManual) return;
    if (!claim?.hospital?.billingServices?.length) return;
    const computed = calculateFilePrice(
      claim.hospital.billingServices,
      dischargeForm.hospitalFinalBill || 0,
      dischargeForm.finalApprovalAmount || 0,
    );
    setSettlementForm(prev => ({ ...prev, filePrice: computed }));
  }, [claim, dischargeForm.hospitalFinalBill, dischargeForm.finalApprovalAmount, filePriceManual]);

  const showTds = claim && ['cashless', 'grievance'].includes(claim.claimType);

  useEffect(() => {
    if (!showTds) return;
    setSettlementForm(prev => ({
      ...prev,
      tds: Math.round((prev.settlementAmount || 0) * 0.10),
    }));
  }, [settlementForm.settlementAmount, showTds]);

  useEffect(() => {
    setSettlementForm(prev => ({
      ...prev,
      bankTransferAmount: Math.max(
        0,
        (prev.settlementAmount || 0) - (prev.tds || 0),
      ),
    }));
  }, [settlementForm.settlementAmount, settlementForm.tds]);

  useEffect(() => {
    getClaimStatusesAPI().then(({ data }) => setClaimStatuses(
      data.filter(s => s.isActive && (!s.superAdminOnly || isSuperAdmin))
    )).catch(() => {}).finally(() => setStatusesLoading(false));
    getClaimDocumentTypesAPI()
      .then(({ data }) => setDocTypes(Array.isArray(data) ? data.filter(d => d.isActive !== false) : []))
      .catch(() => toast.error('Failed to load document types'));
    Promise.all([
      getHospitalsAPI({ active: 'true' }),
      getInsuranceAPI(),
      getTPAAPI(),
    ]).then(([h, i, t]) => {
      setHospitals(h.data);
      setInsurances(i.data);
      setTPAs(t.data);
    }).catch(() => toast.error('Failed to load hospitals/insurance/TPA list'));
  }, []);

  const fetchClaim = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await getClaimAPI(id);
      setClaim(data);
      setAdmissionForm({
        hospital: data.hospital?._id || data.hospital || '',
        isDirectPatient: !!data.isDirectPatient,
        patientName: data.patientName || '',
        patientMobile: data.patientMobile || '',
        doctorName: data.doctorName || '',
        claimType: data.claimType || 'cashless',
        insuranceCompany: data.insuranceCompany?._id || data.insuranceCompany || '',
        tpa: data.tpa?._id || data.tpa || '',
        policyNo: data.policyNo || '',
        clientId: data.clientId || '',
        ccnNo: data.ccnNo || '',
        monthClaimNo: data.monthClaimNo || '',
        dateOfAdmit: data.dateOfAdmit ? data.dateOfAdmit.slice(0, 10) : '',
        treatmentType: data.treatmentType || '',
        diagnosis: data.diagnosis || '',
        surgeryName: data.surgeryName || '',
      });
      setMobileError('');
      setDischargeForm({
        dateOfAdmit: data.dateOfAdmit?.slice(0, 10) || '',
        dateOfDischarge: data.dateOfDischarge?.slice(0, 10) || '',
        hospitalFinalBill: data.hospitalFinalBill || 0,
        mouDiscount: data.mouDiscount || 0,
        deduction: data.deduction || 0,
        finalApprovalAmount: data.finalApprovalAmount || 0,
        finalApprovalDate: data.finalApprovalDate?.slice(0, 10) || '',
      });
      setFileForm({
        fileReceivedDate: data.fileReceivedDate?.slice(0, 10) || '',
        submitMode: data.submitMode || '',
        courierSubmitDate: data.courierSubmitDate?.slice(0, 10) || '',
        onlineSubmitDate: data.onlineSubmitDate?.slice(0, 10) || '',
        courierCompanyName: data.courierCompanyName || '',
        podNumber: data.podNumber || '',
      });
      const initialSettlementAmount = data.settlementAmount
        || ((data.finalApprovalAmount || 0) - (data.settlementAmountDeduction || 0) - (data.mouDiscountOnSettlement || 0))
        || 0;
      const initialTds = data.tds
        || (['cashless', 'grievance'].includes(data.claimType) ? Math.round(initialSettlementAmount * 0.10) : 0);
      const initialBank = data.bankTransferAmount
        || Math.max(0, initialSettlementAmount - initialTds);
      setSettlementForm({
        settlementAmount: initialSettlementAmount,
        settlementAmountDeduction: data.settlementAmountDeduction || 0,
        mouDiscountOnSettlement: data.mouDiscountOnSettlement || 0,
        tds: initialTds,
        bankTransferAmount: initialBank,
        settlementDate: data.settlementDate?.slice(0, 10) || '',
        neftNo: data.neftNo || '',
        filePrice: data.filePrice || 0,
        filePriceOverridden: !!data.filePriceOverridden,
        remarks: data.remarks || '',
        rejectedReason: data.rejectedReason || '',
      });
      setFilePriceManual(!!data.filePriceOverridden);
    } catch {
      toast.error('Claim not found');
      navigate('/claims');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, navigate]);

  useEffect(() => { fetchClaim(); }, [fetchClaim]);

  useEffect(() => {
    if (previewIdx === null) return;
    const total = claim?.documents?.length || 0;
    const onKey = (e) => {
      if (e.key === 'Escape') setPreviewIdx(null);
      if (e.key === 'ArrowLeft') setPreviewIdx(i => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setPreviewIdx(i => Math.min(total - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewIdx, claim?.documents?.length]);

  const doStatusUpdate = async (slug, extra = {}) => {
    setStatusUpdating(true);
    try {
      await updateClaimAPI(id, { status: slug, ...extra });
      toast.success('Status updated');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally { setStatusUpdating(false); }
  };

  const handleUpdateStatus = (slug) => {
    if (slug === claim.status) return;
    if (slug === 'rejected') {
      setRejectionInput('');
      setRejectionModal(true);
      return;
    }
    const extra = claim.status === 'rejected' ? { rejectedReason: '' } : {};
    if (claim.status === 'rejected') {
      setSettlementForm(sf => ({ ...sf, rejectedReason: '' }));
    }
    doStatusUpdate(slug, extra);
  };

  const handleConfirmRejection = async () => {
    if (!rejectionInput.trim()) { toast.error('Please enter a rejection reason'); return; }
    setRejectionModal(false);
    setSettlementForm(sf => ({ ...sf, rejectedReason: rejectionInput.trim() }));
    await doStatusUpdate('rejected', { rejectedReason: rejectionInput.trim() });
  };

  const handleFileSelect = (e, category) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const entries = files.map(f => ({
      file: f,
      previewUrl: URL.createObjectURL(f),
      ...(category === 'other' ? { category: '' } : {}),
    }));
    setPendingFiles(p => ({ ...p, [category]: [...p[category], ...entries] }));
    e.target.value = '';
  };

  const updatePendingOtherCategory = (idx, cat) => {
    setPendingFiles(p => {
      const arr = [...p.other];
      arr[idx] = { ...arr[idx], category: cat };
      return { ...p, other: arr };
    });
  };

  const removePendingFile = (category, idx) => {
    setPendingFiles(p => {
      const arr = [...p[category]];
      URL.revokeObjectURL(arr[idx].previewUrl);
      arr.splice(idx, 1);
      return { ...p, [category]: arr };
    });
  };

  const uploadPendingFiles = async (category, currentPending) => {
    if (!currentPending.length) return;
    const fd = new FormData();
    currentPending.forEach(e => fd.append('files', e.file));
    fd.append('category', category);
    await uploadDocumentsAPI(id, fd);
    currentPending.forEach(e => URL.revokeObjectURL(e.previewUrl));
    setPendingFiles(p => ({ ...p, [category]: [] }));
  };

  const handleSaveAdmission = async () => {
    if (admissionForm.patientMobile && !isValidPhone(admissionForm.patientMobile)) {
      setMobileError('Enter a valid 10-digit Indian mobile number (starts with 6-9)');
      toast.error('Please fix the mobile number before saving');
      return;
    }
    if (!admissionForm.patientName?.trim()) {
      toast.error('Patient name is required');
      return;
    }
    if (!admissionForm.hospital) {
      toast.error('Hospital is required');
      return;
    }
    if (!admissionForm.insuranceCompany) {
      toast.error('Insurance company is required');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...admissionForm };
      if (!payload.tpa) delete payload.tpa;
      await updateClaimAPI(id, payload);
      await uploadPendingFiles('admission', pendingFiles.admission);
      toast.success('Admission details saved');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveDischarge = async () => {
    setSaving(true);
    try {
      await updateClaimAPI(id, { ...dischargeForm, status: 'discharged' });
      await uploadPendingFiles('discharge', pendingFiles.discharge);
      toast.success('Discharge details saved');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveFileReceive = async () => {
    setSaving(true);
    try {
      const status = fileForm.courierSubmitDate || fileForm.onlineSubmitDate ? 'submitted' : 'file_received';
      await updateClaimAPI(id, { ...fileForm, status });
      await uploadPendingFiles('pod', pendingFiles.pod);
      toast.success('File & submit details saved');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveSettlement = async () => {
    setSaving(true);
    try {
      const status = settlementForm.rejectedReason ? 'rejected' : 'settled';
      await updateClaimAPI(id, { ...settlementForm, status });
      await uploadPendingFiles('settlement_proof', pendingFiles.settlement_proof);
      toast.success('Settlement details saved');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveFilePrice = async () => {
    setSavingFilePrice(true);
    try {
      await updateClaimAPI(id, {
        filePrice: settlementForm.filePrice,
        filePriceOverridden: settlementForm.filePriceOverridden,
      });
      toast.success('File price saved');
      await fetchClaim(true);
    } catch {
      toast.error('Failed to save file price');
    } finally { setSavingFilePrice(false); }
  };

  const handleSaveOtherDocs = async () => {
    if (!pendingFiles.other.length) return;
    const untyped = pendingFiles.other.filter(f => !f.category);
    if (untyped.length) {
      toast.error(`Select a document type for ${untyped.length} file${untyped.length !== 1 ? 's' : ''}`);
      return;
    }
    setSaving(true);
    try {
      const groups = pendingFiles.other.reduce((acc, f) => {
        if (!acc[f.category]) acc[f.category] = [];
        acc[f.category].push(f);
        return acc;
      }, {});
      for (const [cat, entries] of Object.entries(groups)) {
        const fd = new FormData();
        entries.forEach(e => fd.append('files', e.file));
        fd.append('category', cat);
        await uploadDocumentsAPI(id, fd);
        entries.forEach(e => URL.revokeObjectURL(e.previewUrl));
      }
      setPendingFiles(p => ({ ...p, other: [] }));
      toast.success('Documents saved');
      await fetchClaim(true);
    } catch {
      toast.error('Upload failed');
    } finally { setSaving(false); }
  };

  const handleDeleteDoc = async (docId) => {
    if (!await confirm('Delete this document?', { title: 'Delete Document', confirmLabel: 'Delete' })) return;
    setDeletingDocId(docId);
    try {
      await deleteDocumentAPI(id, docId);
      toast.success('Document deleted');
      await fetchClaim(true);
    } catch {
      toast.error('Failed to delete');
    } finally { setDeletingDocId(null); }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <div className="w-10 h-10 border-[3px] border-primary-100 border-t-primary-600 rounded-full animate-spin" />
        <p className="text-sm text-gray-400">Loading claim...</p>
      </div>
    );
  }
  if (!claim) return null;

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
  const formatAmount = (a) => formatCurrency(Number(a) || 0);
  // Build the actual journey from history (fallback to current status if history is missing)
  const statusMeta = (slug) => claimStatuses.find(s => s.slug === slug);
  const historyRaw = (claim.statusHistory && claim.statusHistory.length)
    ? claim.statusHistory
    : [{ status: claim.status, changedAt: claim.updatedAt || claim.createdAt }];
  const journey = historyRaw.map((h, idx) => {
    const meta = statusMeta(h.status);
    return {
      key: h._id || `${h.status}-${idx}`,
      slug: h.status,
      label: meta?.label || h.status.replace(/_/g, ' '),
      color: meta?.color || 'gray',
      changedAt: h.changedAt,
      changedBy: h.changedBy?.name || null,
    };
  });
  const isEditable = can('claims', 'edit');
  const canUpload = can('claims', 'edit');

  const currentStatusObj = claimStatuses.find(s => s.slug === claim.status);
  const statusBadgeCls = STATUS_COLOR_MAP[currentStatusObj?.color] || 'bg-blue-100 text-blue-700';
  const statusLabel = currentStatusObj?.label || claim.status.replace(/_/g, ' ');

  const tabs = [
    { key: 'overview',   label: 'Overview' },
    { key: 'admission',  label: 'Admission' },
    { key: 'discharge',  label: 'Discharge' },
    { key: 'file_submit',label: 'File & Submit' },
    { key: 'settlement', label: 'Settlement' },
    { key: 'documents',  label: `Documents (${claim.documents?.length || 0})` },
  ];

  const baseUrl = process.env.REACT_APP_API_URL === '/api' ? '' : (process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001');
  const getDocUrl = (doc) => `${baseUrl}/uploads/${doc.fileName}`;
  const allDocs = claim.documents || [];
  const docGroups = allDocs.reduce((acc, doc, idx) => {
    const cat = doc.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push({ ...doc, _origIdx: idx, _url: `${baseUrl}/uploads/${doc.fileName}` });
    return acc;
  }, {});
  const sortedCats = [
    ...CATEGORY_ORDER.filter(c => docGroups[c]),
    ...Object.keys(docGroups).filter(c => !CATEGORY_ORDER.includes(c)),
  ];
  const previewDoc = previewIdx !== null ? allDocs[previewIdx] : null;

  const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white transition-colors';
  const labelCls = 'block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5';

  const hospitalOptions  = hospitals.map(h => ({ value: h._id, label: h.name }));
  const insuranceOptions = insurances.map(i => ({ value: i._id, label: i.name }));
  const tpaOptions       = tpas.map(t => ({ value: t._id, label: t.name }));
  const selectedAdmissionHospital = hospitals.find(h => h._id === admissionForm.hospital);
  const admissionDoctorOptions = (selectedAdmissionHospital?.doctors ?? []).map(d => ({ value: d.name, label: d.name }));
  const CLAIM_TYPES = ['cashless', 'reimbursement', 'grievance'];

  // Shared documents subsection used in Discharge / File&Submit / Settlement tabs
  const DocsSubsection = ({ category, pendingKey, uploadLabel }) => (
    <div className="mt-6 pt-5 border-t border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Attachments</p>
        {canUpload && (
          <UploadLabel label={uploadLabel} onChange={e => handleFileSelect(e, pendingKey)} />
        )}
      </div>
      <PendingDocGrid
        files={pendingFiles[pendingKey]}
        onPreview={e => setPendingPreview({ url: e.previewUrl, name: e.file.name })}
        onRemove={idx => removePendingFile(pendingKey, idx)}
      />
      <DocMiniGrid
        docs={docGroups[category] || []}
        onPreview={setPreviewIdx}
        onDelete={handleDeleteDoc}
        isEditable={isEditable}
        deletingDocId={deletingDocId}
      />
      {(pendingFiles[pendingKey].length === 0 && (docGroups[category] || []).length === 0) && (
        <div className="text-center py-8 text-gray-300">
          <HiOutlineDocumentText className="w-8 h-8 mx-auto mb-2" />
          <p className="text-xs">No files attached yet</p>
        </div>
      )}
    </div>
  );

  // Shared save footer
  const SaveFooter = ({ onSave, label }) => isEditable ? (
    <div className="mt-6 pt-4 border-t border-gray-100 flex items-center justify-end">
      <button onClick={onSave} disabled={saving}
        className="inline-flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-60 transition-colors shadow-sm">
        {saving ? <><Spinner /><span>Saving...</span></> : label}
      </button>
    </div>
  ) : null;

  return (
    <div>
      {/* ── Hero Header ── */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden mb-4 shadow-sm">
        <div className="h-1 bg-gradient-to-r from-primary-600 via-primary-400 to-blue-300" />
        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            <button onClick={() => navigate('/claims')}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0 mt-0.5">
              <HiOutlineArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Claim #{claim.srNo}</span>
                <span className="text-gray-200">·</span>
                <span className={`text-[11px] font-semibold capitalize px-2 py-0.5 rounded-full ${
                  claim.claimType === 'cashless' ? 'bg-green-50 text-green-600' :
                  claim.claimType === 'reimbursement' ? 'bg-primary-50 text-primary-600' :
                  'bg-orange-50 text-orange-600'}`}>
                  {claim.claimType}
                </span>
              </div>
              <h1 className="text-xl font-bold text-gray-900 truncate">{claim.patientName}</h1>
              <p className="text-sm text-gray-400 mt-0.5 truncate">{claim.hospital?.name}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {isEditable ? (
                <button ref={statusBtnRef}
                  onClick={() => {
                    const r = statusBtnRef.current.getBoundingClientRect();
                    setStatusDropPos({ top: r.bottom + 6, left: r.left });
                    setStatusSearch(''); setStatusDropOpen(v => !v);
                  }}
                  disabled={statusUpdating}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all ${statusBadgeCls} ${statusUpdating ? 'opacity-60' : 'hover:shadow-sm'}`}>
                  {statusUpdating ? <><Spinner sm /><span>Saving…</span></> : (
                    <><span>{statusLabel}</span><HiChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform ${statusDropOpen ? 'rotate-180' : ''}`} /></>
                  )}
                </button>
              ) : (
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${statusBadgeCls}`}>{statusLabel}</span>
              )}
              {isSuperAdmin && (
                <span className={`px-3 py-1.5 rounded-full text-xs font-bold ${claim.isBilled ? 'bg-teal-100 text-teal-800' : 'bg-gray-100 text-gray-600'}`}>
                  {claim.isBilled ? 'Billed' : 'Unbilled'}
                </span>
              )}
              <button onClick={() => setStickerOpen(true)}
                title="Print courier sticker"
                className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors">
                <HiOutlinePrinter className="w-4 h-4" />
              </button>
              {isEditable && (
                <button onClick={() => changeTab('admission')}
                  title="Edit admission details"
                  className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors">
                  <HiOutlinePencil className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className={`grid gap-4 mt-4 pt-4 border-t border-gray-100 ${isSuperAdmin ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
            {[
              ['Date of Admit',     formatDate(claim.dateOfAdmit)],
              ['Date of Discharge', formatDate(claim.dateOfDischarge)],
              ['Final Bill',        claim.hospitalFinalBill ? formatAmount(claim.hospitalFinalBill) : '—'],
              ['Settlement',        claim.settlementAmount  ? formatAmount(claim.settlementAmount)  : '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{label}</p>
                <p className="text-sm font-bold text-gray-800 mt-0.5">{value}</p>
              </div>
            ))}
            {isSuperAdmin && (
              <div>
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">File Price</p>
                <div className="flex items-start gap-1.5">
                  <div className="flex-1 min-w-0">
                    <AmountInput
                      value={settlementForm.filePrice || 0}
                      onChange={v => { setFilePriceManual(true); setSettlementForm(sf => ({ ...sf, filePrice: v, filePriceOverridden: true })); }}
                      className={`w-full px-2.5 py-1.5 border rounded-lg text-sm font-bold text-gray-800 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white ${filePriceManual ? 'border-amber-300' : 'border-gray-200'}`}
                    />
                  </div>
                  <button
                    onClick={handleSaveFilePrice}
                    disabled={savingFilePrice}
                    className="flex-shrink-0 h-[34px] px-3 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white rounded-lg text-xs font-semibold transition-colors inline-flex items-center justify-center">
                    {savingFilePrice ? <Spinner sm /> : 'Save'}
                  </button>
                </div>
                {filePriceManual ? (
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] font-semibold text-amber-600">Manually edited</span>
                    <span className="text-gray-300">·</span>
                    <button
                      onClick={() => { setFilePriceManual(false); setSettlementForm(sf => ({ ...sf, filePriceOverridden: false })); }}
                      className="text-[10px] text-primary-600 hover:underline font-medium">
                      Reset to auto
                    </button>
                  </div>
                ) : (
                  <p className="text-[10px] text-gray-400 mt-1">Auto-calculated</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Status Journey ── */}
      {journey.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 mb-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary-50 flex items-center justify-center">
                <HiOutlineCalendar className="w-3.5 h-3.5 text-primary-600" />
              </div>
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status Journey</p>
            </div>
            <p className="text-[10px] font-medium text-gray-400">
              {journey.length} status change{journey.length !== 1 ? 's' : ''}
            </p>
          </div>

          <div className="overflow-x-auto pb-2 -mx-1 px-1">
            <div className="flex items-stretch gap-0">
              {journey.map((step, idx) => {
                const isLast = idx === journey.length - 1;
                const isCurrent = isLast;
                const dt = step.changedAt ? new Date(step.changedAt) : null;
                const pillCls = STATUS_COLOR_MAP[step.color] || 'bg-gray-100 text-gray-700';
                const nextDt = !isLast && journey[idx + 1].changedAt
                  ? new Date(journey[idx + 1].changedAt) : null;
                const elapsed = dt && nextDt ? formatElapsed(nextDt - dt) : null;

                return (
                  <React.Fragment key={step.key}>
                    <div className="flex flex-col flex-shrink-0 w-[180px]">
                      <div className={`rounded-xl border p-3 transition-all
                        ${isCurrent
                          ? 'border-primary-300 bg-primary-50/40 shadow-sm ring-1 ring-primary-100'
                          : 'border-gray-200 bg-white hover:border-gray-300'}`}>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0
                            ${isCurrent
                              ? 'bg-white border-2 border-primary-500 text-primary-600 ring-2 ring-primary-100'
                              : 'bg-primary-600 text-white shadow-sm shadow-primary-200'}`}>
                            {isCurrent
                              ? <span className="text-[10px] font-bold">{idx + 1}</span>
                              : <HiCheck className="w-3.5 h-3.5" />}
                          </div>
                          {isCurrent && (
                            <span className="text-[9px] font-bold text-primary-600 uppercase tracking-wider bg-primary-100 px-1.5 py-0.5 rounded">
                              Current
                            </span>
                          )}
                        </div>
                        <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${pillCls}`}>
                          {step.label}
                        </span>
                        {dt && (
                          <div className="mt-2 pt-2 border-t border-gray-100">
                            <p className="text-[11px] font-medium text-gray-700">{dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
                            <p className="text-[10px] text-gray-400">{dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</p>
                          </div>
                        )}
                        {step.changedBy && (
                          <p className="text-[10px] text-gray-400 mt-1.5 truncate" title={step.changedBy}>
                            by <span className="font-medium text-gray-500">{step.changedBy}</span>
                          </p>
                        )}
                      </div>
                    </div>
                    {!isLast && (
                      <div className="flex flex-col items-center justify-center px-2 flex-shrink-0 min-w-[60px]">
                        {elapsed && (
                          <span className="text-[9px] font-semibold text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full border border-gray-100 mb-1">
                            {elapsed}
                          </span>
                        )}
                        <div className="flex items-center w-full">
                          <div className="flex-1 h-0.5 bg-primary-300 rounded-full" />
                          <HiOutlineChevronRight className="w-3.5 h-3.5 text-primary-400 -ml-0.5" />
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="overflow-x-auto mb-4">
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 min-w-max shadow-sm">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => changeTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all whitespace-nowrap
                ${activeTab === tab.key ? 'bg-primary-600 text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ── */}
      <div className={`relative transition-opacity duration-200 ${refreshing ? 'opacity-60 pointer-events-none' : ''}`}>
        {refreshing && (
          <div className="absolute inset-0 z-10 flex items-start justify-center pt-16 pointer-events-none">
            <div className="bg-white/90 border border-gray-200 rounded-full px-4 py-2 flex items-center gap-2 shadow-md">
              <div className="w-4 h-4 border-2 border-primary-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-medium text-gray-600">Refreshing...</span>
            </div>
          </div>
        )}

        {/* ── Overview ── */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <SectionHeader icon={HiOutlineUser} title="Patient Details" />
                {[
                  ['Patient Name',     claim.patientName],
                  ['Mobile',           claim.patientMobile || '—'],
                  ['Doctor',           claim.doctorName || '—'],
                  ['Claim Type',       claim.claimType],
                  ['Date of Admit',    formatDate(claim.dateOfAdmit)],
                  ['Date of Discharge',formatDate(claim.dateOfDischarge)],
                ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <SectionHeader icon={HiOutlineShieldCheck} title="Insurance Details" />
                {[
                  ['Insurance',   claim.insuranceCompany?.name || '—'],
                  ['TPA',         claim.tpa?.name || '—'],
                  ['Policy No',   claim.policyNo || '—'],
                  ['Client ID',   claim.clientId || '—'],
                  ['CCN No',      claim.ccnNo || '—'],
                  ['Month Claim #', claim.monthClaimNo || '—'],
                ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <SectionHeader icon={HiOutlineCash} title="Financial Summary" />
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatCard label="Hospital Final Bill"  value={formatAmount(claim.hospitalFinalBill)} />
                <StatCard label="MOU Discount"         value={formatAmount(claim.mouDiscount)} />
                <StatCard label="Deduction"            value={formatAmount(claim.deduction)} />
                <StatCard label="Final Approval"       value={formatAmount(claim.finalApprovalAmount)} highlight />
                <StatCard label="Settlement Amount"    value={formatAmount(claim.settlementAmount)} />
                <StatCard label="TDS"                  value={formatAmount(claim.tds)} />
                <StatCard label="Bank Transfer"        value={formatAmount(claim.bankTransferAmount)} highlight />
                {isSuperAdmin && <StatCard label="File Price" value={formatAmount(claim.filePrice)} />}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <SectionHeader icon={HiOutlineTruck} title="Submission & Courier" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
                {[
                  ['File Received',   formatDate(claim.fileReceivedDate)],
                  ['Submit Mode',     claim.submitMode || '—'],
                  ['Courier Date',    formatDate(claim.courierSubmitDate)],
                  ['Online Date',     formatDate(claim.onlineSubmitDate)],
                  ['Courier Company', claim.courierCompanyName || '—'],
                  ['POD Number',      claim.podNumber || '—'],
                  ['Settlement Date', formatDate(claim.settlementDate)],
                  ['NEFT No',         claim.neftNo || '—'],
                ].map(([l, v]) => <InfoRow key={l} label={l} value={v} />)}
              </div>
            </div>
          </div>
        )}

        {/* ── Admission ── */}
        {activeTab === 'admission' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionHeader icon={HiOutlineUser} title="Admission Details" />

            {isEditable ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="md:col-span-2 lg:col-span-3">
                  <label className={labelCls}>Claim Type</label>
                  <div className="flex gap-3 mt-1">
                    {CLAIM_TYPES.map(t => (
                      <button key={t} type="button"
                        onClick={() => setAdmissionForm(f => ({ ...f, claimType: t }))}
                        className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-all capitalize ${
                          admissionForm.claimType === t
                            ? 'bg-primary-600 border-primary-600 text-white shadow-sm'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                        }`}>{t}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={labelCls}>Hospital *</label>
                  <SearchableSelect
                    value={admissionForm.hospital}
                    onChange={v => setAdmissionForm(f => ({ ...f, hospital: v, doctorName: '' }))}
                    options={hospitalOptions}
                    placeholder="Select hospital" />
                </div>

                <div>
                  <label className={labelCls}>Patient Name *</label>
                  <input type="text" value={admissionForm.patientName || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, patientName: e.target.value }))}
                    className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Patient Mobile</label>
                  <input type="text" value={admissionForm.patientMobile || ''}
                    onChange={e => {
                      const val = onPhoneInput(e.target.value);
                      setAdmissionForm(f => ({ ...f, patientMobile: val }));
                      setMobileError(val && !isValidPhone(val) ? 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' : '');
                    }}
                    className={`${inputCls} ${mobileError ? 'border-red-400 focus:ring-red-200 focus:border-red-400' : ''}`} />
                  {mobileError && <p className="mt-1 text-xs text-red-500">{mobileError}</p>}
                </div>

                <div>
                  <label className={labelCls}>Doctor</label>
                  <SearchableSelect
                    value={admissionForm.doctorName}
                    onChange={v => setAdmissionForm(f => ({ ...f, doctorName: v }))}
                    options={admissionDoctorOptions}
                    placeholder={selectedAdmissionHospital ? 'Select doctor' : 'Select hospital first'} />
                </div>

                <div>
                  <label className={labelCls}>Date of Admit</label>
                  <DateInput type="date" value={admissionForm.dateOfAdmit || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, dateOfAdmit: e.target.value }))}
                    className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Insurance Company *</label>
                  <SearchableSelect
                    value={admissionForm.insuranceCompany}
                    onChange={v => setAdmissionForm(f => ({ ...f, insuranceCompany: v }))}
                    options={insuranceOptions}
                    placeholder="Select insurance" />
                </div>

                <div>
                  <label className={labelCls}>TPA</label>
                  <SearchableSelect
                    value={admissionForm.tpa}
                    onChange={v => setAdmissionForm(f => ({ ...f, tpa: v }))}
                    options={tpaOptions}
                    placeholder="Select TPA (optional)" />
                </div>

                <div>
                  <label className={labelCls}>Policy No</label>
                  <input type="text" value={admissionForm.policyNo || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, policyNo: e.target.value }))}
                    className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Client ID</label>
                  <input type="text" value={admissionForm.clientId || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, clientId: e.target.value }))}
                    className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>CCN No</label>
                  <input type="text" value={admissionForm.ccnNo || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, ccnNo: e.target.value }))}
                    className={inputCls} />
                </div>

                <div>
                  <label className={labelCls}>Month Claim #</label>
                  <input type="text" value={admissionForm.monthClaimNo || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, monthClaimNo: e.target.value }))}
                    className={inputCls} />
                </div>

                <div className="md:col-span-2 lg:col-span-3">
                  <label className={labelCls}>Treatment Type</label>
                  <div className="flex gap-4 mt-1">
                    {['Medical', 'Surgical'].map(t => (
                      <label key={t} className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="treatmentType" value={t}
                          checked={admissionForm.treatmentType === t}
                          onChange={() => setAdmissionForm(f => ({ ...f, treatmentType: t, surgeryName: t === 'Medical' ? '' : f.surgeryName }))}
                          className="w-4 h-4 text-primary-600 border-gray-300 focus:ring-primary-500" />
                        <span className="text-sm text-gray-700">{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={labelCls}>Diagnosis</label>
                  <input type="text" value={admissionForm.diagnosis || ''}
                    onChange={e => setAdmissionForm(f => ({ ...f, diagnosis: e.target.value }))}
                    minLength={3} placeholder="Enter diagnosis (min. 3 letters)"
                    className={inputCls} />
                  {admissionForm.diagnosis && admissionForm.diagnosis.length < 3 && (
                    <p className="text-xs text-red-500 mt-0.5">Minimum 3 characters required</p>
                  )}
                </div>
                {admissionForm.treatmentType === 'Surgical' && (
                  <div>
                    <label className={labelCls}>Surgery Name</label>
                    <input type="text" value={admissionForm.surgeryName || ''}
                      onChange={e => setAdmissionForm(f => ({ ...f, surgeryName: e.target.value }))}
                      placeholder="Enter surgery name"
                      className={inputCls} />
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['Claim Type',         claim.claimType],
                  ['Hospital',           claim.hospital?.name || '—'],
                  ['Patient Name',       claim.patientName],
                  ['Patient Mobile',     claim.patientMobile || '—'],
                  ['Doctor',             claim.doctorName || '—'],
                  ['Date of Admit',      formatDate(claim.dateOfAdmit)],
                  ['Insurance',          claim.insuranceCompany?.name || '—'],
                  ['TPA',                claim.tpa?.name || '—'],
                  ['Policy No',          claim.policyNo || '—'],
                  ['Client ID',          claim.clientId || '—'],
                  ['CCN No',             claim.ccnNo || '—'],
                  ['Month Claim #',      claim.monthClaimNo || '—'],
                  ['Treatment Type',     claim.treatmentType || '—'],
                  ['Diagnosis',          claim.diagnosis || '—'],
                  ...(claim.treatmentType === 'Surgical' ? [['Surgery Name', claim.surgeryName || '—']] : []),
                ].map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
              </div>
            )}

            <DocsSubsection category="admission" pendingKey="admission" uploadLabel="Add Files" />
            <SaveFooter onSave={handleSaveAdmission} label="Save Admission" />
          </div>
        )}

        {/* ── Discharge ── */}
        {activeTab === 'discharge' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionHeader icon={HiOutlineCalendar} title="Discharge Details" />

            {isEditable ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Date of Admit',           name: 'dateOfAdmit',        type: 'date' },
                  { label: 'Date of Discharge',       name: 'dateOfDischarge',    type: 'date' },
                  { label: 'Final Approval Date',     name: 'finalApprovalDate',  type: 'date' },
                  { label: 'Hospital Final Bill (₹)', name: 'hospitalFinalBill',  type: 'amount' },
                  { label: 'MOU Discount (₹)',        name: 'mouDiscount',        type: 'amount' },
                  { label: 'Deduction (₹)',           name: 'deduction',          type: 'amount' },
                ].map(f => (
                  <div key={f.name}>
                    <label className={labelCls}>{f.label}</label>
                    {f.type === 'amount'
                      ? <AmountInput value={dischargeForm[f.name] || 0}
                          onChange={v => setDischargeForm({ ...dischargeForm, [f.name]: v })}
                          className={inputCls} />
                      : <DateInput type="date" value={dischargeForm[f.name] || ''}
                          onChange={e => setDischargeForm({ ...dischargeForm, [f.name]: e.target.value })}
                          className={inputCls} />
                    }
                  </div>
                ))}
                <div>
                  <label className={labelCls}>Final Approval Amount (₹) <span className="text-xs text-gray-400 font-normal">— auto-calculated</span></label>
                  <AmountInput value={dischargeForm.finalApprovalAmount || 0}
                    onChange={v => setDischargeForm(f => ({ ...f, finalApprovalAmount: v }))}
                    className={inputCls} />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['Date of Admit',          formatDate(claim.dateOfAdmit)],
                  ['Date of Discharge',      formatDate(claim.dateOfDischarge)],
                  ['Final Approval Date',    formatDate(claim.finalApprovalDate)],
                  ['Hospital Final Bill',    formatAmount(claim.hospitalFinalBill)],
                  ['MOU Discount',           formatAmount(claim.mouDiscount)],
                  ['Deduction',              formatAmount(claim.deduction)],
                  ['Final Approval Amount',  formatAmount(claim.finalApprovalAmount)],
                ].map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
              </div>
            )}

            <DocsSubsection category="discharge" pendingKey="discharge" uploadLabel="Add Files" />
            <SaveFooter onSave={handleSaveDischarge} label="Save Discharge" />
          </div>
        )}

        {/* ── File & Submit ── */}
        {activeTab === 'file_submit' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionHeader icon={HiOutlineTruck} title="File Receive & Submit" />

            {isEditable ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'File Received Date',    name: 'fileReceivedDate',   type: 'date' },
                  { label: 'Online Submit Date',    name: 'onlineSubmitDate',   type: 'date' },
                  { label: 'Courier Submit Date',   name: 'courierSubmitDate',  type: 'date' },
                  { label: 'Courier Company',       name: 'courierCompanyName', type: 'text' },
                  { label: 'POD / Docket Number',   name: 'podNumber',          type: 'text' },
                ].map(f => (
                  <div key={f.name}>
                    <label className={labelCls}>{f.label}</label>
                    <input type={f.type} value={fileForm[f.name] || ''}
                      onChange={e => setFileForm({ ...fileForm, [f.name]: e.target.value })}
                      className={inputCls} />
                  </div>
                ))}
                <div>
                  <label className={labelCls}>Submit Mode</label>
                  <select value={fileForm.submitMode}
                    onChange={e => setFileForm({ ...fileForm, submitMode: e.target.value })}
                    className={inputCls}>
                    <option value="">Select mode</option>
                    <option value="online">Online</option>
                    <option value="offline">Offline (Courier)</option>
                    <option value="both">Both</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['File Received Date',  formatDate(claim.fileReceivedDate)],
                  ['Submit Mode',         claim.submitMode || '—'],
                  ['Online Submit Date',  formatDate(claim.onlineSubmitDate)],
                  ['Courier Submit Date', formatDate(claim.courierSubmitDate)],
                  ['Courier Company',     claim.courierCompanyName || '—'],
                  ['POD / Docket Number', claim.podNumber || '—'],
                ].map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
              </div>
            )}

            <DocsSubsection category="pod" pendingKey="pod" uploadLabel="Add Files" />
            <SaveFooter onSave={handleSaveFileReceive} label="Save File & Submit" />
          </div>
        )}

        {/* ── Settlement ── */}
        {activeTab === 'settlement' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <SectionHeader icon={HiOutlineCash} title="Payment Settlement" />

            {isEditable ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Settlement Deduction (₹)',        name: 'settlementAmountDeduction',  type: 'amount', allowNegative: true },
                  { label: 'MOU Discount on Settlement (₹)',  name: 'mouDiscountOnSettlement',    type: 'amount', allowNegative: true },
                  ...(showTds ? [{ label: 'TDS (₹) — 10% auto-calculated', name: 'tds', type: 'amount' }] : []),
                  { label: 'Bank Transfer Amount (₹) — auto-calculated', name: 'bankTransferAmount', type: 'amount' },
                  { label: 'Settlement Date',                 name: 'settlementDate',             type: 'date' },
                  { label: 'NEFT Number',                     name: 'neftNo',                     type: 'text' },
                ].reduce((els, f) => {
                  if (els.length === 0) {
                    els.push(
                      <div key="settlementAmount">
                        <label className={labelCls}>Settlement Amount (₹) <span className="text-xs text-gray-400 font-normal">— auto-calculated</span></label>
                        <AmountInput value={settlementForm.settlementAmount || 0}
                          onChange={v => setSettlementForm(sf => ({ ...sf, settlementAmount: v }))}
                          className={inputCls} />
                      </div>
                    );
                  }
                  els.push(
                    <div key={f.name}>
                      <label className={labelCls}>{f.label}</label>
                      {f.type === 'amount'
                        ? <AmountInput value={settlementForm[f.name] || 0}
                            onChange={v => setSettlementForm({ ...settlementForm, [f.name]: v })}
                            allowNegative={f.allowNegative}
                            className={inputCls} />
                        : <input type={f.type} value={settlementForm[f.name] || ''}
                            onChange={e => setSettlementForm({ ...settlementForm, [f.name]: e.target.value })}
                            className={inputCls} />
                      }
                    </div>
                  );
                  return els;
                }, [])}
                <div className="md:col-span-2">
                  <label className={labelCls}>Remarks</label>
                  <textarea value={settlementForm.remarks}
                    onChange={e => setSettlementForm({ ...settlementForm, remarks: e.target.value })}
                    rows={2} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Rejected Reason <span className="normal-case font-normal">(leave blank if settled)</span></label>
                  <input value={settlementForm.rejectedReason}
                    onChange={e => setSettlementForm({ ...settlementForm, rejectedReason: e.target.value })}
                    className={inputCls} placeholder="Enter reason if rejected" />
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  ['Settlement Amount',           formatAmount(claim.settlementAmount)],
                  ['Settlement Deduction',        formatAmount(claim.settlementAmountDeduction)],
                  ['MOU Discount on Settlement',  formatAmount(claim.mouDiscountOnSettlement)],
                  ...(showTds ? [['TDS', formatAmount(claim.tds)]] : []),
                  ['Bank Transfer Amount',        formatAmount(claim.bankTransferAmount)],
                  ['Settlement Date',             formatDate(claim.settlementDate)],
                  ['NEFT Number',                 claim.neftNo || '—'],
                  ['Remarks',                     claim.remarks || '—'],
                  ['Rejected Reason',             claim.rejectedReason || '—'],
                ].map(([l, v]) => <StatCard key={l} label={l} value={v} />)}
              </div>
            )}

            <DocsSubsection category="settlement_proof" pendingKey="settlement_proof" uploadLabel="Add Files" />
            <SaveFooter onSave={handleSaveSettlement} label="Save Settlement" />
          </div>
        )}

        {/* ── Documents ── */}
        {activeTab === 'documents' && (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-primary-50 border border-primary-100 flex items-center justify-center flex-shrink-0">
                    <HiOutlineClipboardList className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-800">All Documents</h3>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {allDocs.length} saved{pendingFiles.other.length > 0 ? ` · ${pendingFiles.other.length} pending` : ''}
                    </p>
                  </div>
                </div>
                {isEditable && (
                  <UploadLabel label="Select Files" onChange={e => handleFileSelect(e, 'other')} />
                )}
              </div>

              {allDocs.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-gray-100">
                  {sortedCats.map(cat => (
                    <span key={cat} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 border border-gray-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-primary-400" />
                      {CATEGORY_LABELS[cat] || cat} · {docGroups[cat].length}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Pending upload panel */}
            {pendingFiles.other.length > 0 && (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                      <HiOutlineUpload className="w-3.5 h-3.5 text-primary-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">
                        {pendingFiles.other.length} file{pendingFiles.other.length !== 1 ? 's' : ''} ready to upload
                      </p>
                      <p className="text-[11px] text-gray-400 mt-0.5">Select a document type for each file before uploading</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => {
                        pendingFiles.other.forEach(e => URL.revokeObjectURL(e.previewUrl));
                        setPendingFiles(p => ({ ...p, other: [] }));
                      }}
                      className="text-xs text-gray-400 hover:text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors border border-gray-200">
                      Discard
                    </button>
                    <button onClick={handleSaveOtherDocs} disabled={saving}
                      className="inline-flex items-center gap-1.5 bg-primary-600 hover:bg-primary-700 text-white px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-60 transition-colors shadow-sm">
                      {saving ? <><Spinner sm /><span>Uploading...</span></> : `Upload ${pendingFiles.other.length} file${pendingFiles.other.length !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-gray-100">
                  {pendingFiles.other.map((entry, idx) => {
                    const img = isImage(entry.file.name);
                    const hasType = !!entry.category;
                    return (
                      <div key={idx} className={`flex items-center gap-4 px-5 py-3 transition-colors ${hasType ? 'bg-white' : 'bg-primary-50/20'}`}>
                        <button type="button"
                          onClick={() => setPendingPreview({ url: entry.previewUrl, name: entry.file.name })}
                          className="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border border-gray-200 flex-shrink-0 flex items-center justify-center hover:ring-2 hover:ring-primary-300 transition-all">
                          {img
                            ? <img src={entry.previewUrl} alt="" className="w-full h-full object-cover" />
                            : <HiOutlineDocumentText className="w-5 h-5 text-gray-400" />
                          }
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate" title={entry.file.name}>{entry.file.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{(entry.file.size / 1024).toFixed(0)} KB</p>
                        </div>
                        <div className="flex-shrink-0 w-60">
                          <SearchableSelect
                            options={docTypes.map(dt => ({ value: dt.name, label: dt.name }))}
                            value={entry.category}
                            onChange={val => updatePendingOtherCategory(idx, val)}
                            placeholder="Select document type…"
                            searchPlaceholder="Search types…"
                          />
                        </div>
                        <div className="flex-shrink-0">
                          {hasType ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">
                              <HiCheck className="w-3 h-3" /> Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-500 border border-gray-200">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" /> Unset
                            </span>
                          )}
                        </div>
                        <button onClick={() => removePendingFile('other', idx)}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                          <HiOutlineTrash className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
                  <p className="text-[11px] text-gray-400">
                    {pendingFiles.other.filter(f => f.category).length} of {pendingFiles.other.length} assigned
                  </p>
                  <div className="flex gap-1">
                    {pendingFiles.other.map((f, i) => (
                      <span key={i} className={`w-2 h-2 rounded-full ${f.category ? 'bg-green-400' : 'bg-gray-300'}`} />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Saved docs by category */}
            {allDocs.length === 0 && pendingFiles.other.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 py-16 text-center shadow-sm">
                <div className="w-14 h-14 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center mx-auto mb-3">
                  <HiOutlineDocumentText className="w-7 h-7 text-gray-300" />
                </div>
                <p className="text-sm font-medium text-gray-400">No documents yet</p>
                <p className="text-xs text-gray-300 mt-1">Click "Select Files" above to add documents</p>
              </div>
            ) : allDocs.length > 0 ? (
              <div className="space-y-3">
                {sortedCats.map(cat => (
                  <div key={cat} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                    <div className="flex items-center gap-2 mb-4">
                      <span className="w-2 h-2 rounded-full bg-primary-400" />
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {CATEGORY_LABELS[cat] || cat} · {docGroups[cat].length} file{docGroups[cat].length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {docGroups[cat].map(doc => {
                        const img = isImage(doc.fileName);
                        const isDeleting = deletingDocId === doc._id;
                        return (
                          <div key={doc._id}
                            className={`border border-gray-200 rounded-xl overflow-hidden hover:shadow-md hover:border-primary-200 transition-all group ${isDeleting ? 'opacity-50' : ''}`}>
                            <button type="button" onClick={() => !isDeleting && setPreviewIdx(doc._origIdx)}
                              className="w-full h-32 bg-gray-50 flex items-center justify-center overflow-hidden focus:outline-none">
                              {img ? (
                                <img src={doc._url} alt={doc.originalName}
                                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                              ) : (
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className="bg-white rounded-lg p-2.5 shadow-sm">
                                    <HiOutlineDocumentText className="w-7 h-7 text-gray-400" />
                                  </div>
                                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">PDF</span>
                                </div>
                              )}
                            </button>
                            <div className="px-2.5 py-2 border-t border-gray-100">
                              <p className="text-xs font-medium text-gray-700 truncate mb-1.5" title={doc.originalName}>{doc.originalName}</p>
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[10px] text-gray-400">
                                  {(doc.fileSize / 1024).toFixed(0)} KB · {new Date(doc.uploadedAt).toLocaleDateString('en-IN')}
                                </span>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  <a href={doc._url} download={doc.originalName}
                                    className="p-1 text-gray-300 hover:text-primary-600 hover:bg-primary-50 rounded-md transition-colors"
                                    onClick={e => e.stopPropagation()}>
                                    <HiOutlineDownload className="w-3.5 h-3.5" />
                                  </a>
                                  {isEditable && (
                                    <button onClick={() => handleDeleteDoc(doc._id)} disabled={isDeleting}
                                      className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors">
                                      {isDeleting
                                        ? <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                                        : <HiOutlineTrash className="w-3.5 h-3.5" />
                                      }
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Rejection Reason Modal ── */}
      {rejectionModal && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-red-500 to-red-400" />
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <HiOutlineX className="w-5 h-5 text-red-500" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900">Rejection Reason</h3>
                  <p className="text-xs text-gray-400 mt-0.5">Enter why this claim is being rejected</p>
                </div>
              </div>
              <textarea
                autoFocus
                rows={3}
                value={rejectionInput}
                onChange={e => setRejectionInput(e.target.value)}
                placeholder="Enter rejection reason…"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-red-400 resize-none"
              />
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setRejectionModal(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                  Cancel
                </button>
                <button
                  onClick={handleConfirmRejection}
                  className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-semibold transition-colors">
                  Mark as Rejected
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Status dropdown portal ── */}
      {statusDropOpen && !statusUpdating && ReactDOM.createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setStatusDropOpen(false)} />
          <div style={{ top: statusDropPos.top, left: statusDropPos.left }}
            className="fixed z-50 w-56 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 overflow-hidden">
            <p className="px-4 pt-3 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest">
              Update Status
            </p>
            <div className="px-3 pb-2">
              <div className="relative">
                <HiOutlineSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-3.5 h-3.5" />
                <input
                  autoFocus
                  value={statusSearch}
                  onChange={e => setStatusSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="max-h-56 overflow-y-auto overscroll-contain border-t border-gray-100">
              {statusesLoading ? (
                <div className="flex items-center justify-center gap-2 py-6">
                  <div className="w-4 h-4 border-2 border-gray-200 border-t-primary-500 rounded-full animate-spin" />
                  <span className="text-xs text-gray-400">Loading...</span>
                </div>
              ) : claimStatuses
                .filter(s => s.label.toLowerCase().includes(statusSearch.toLowerCase()))
                .map(s => {
                  const cls = STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700';
                  const isActive = s.slug === claim.status;
                  return (
                    <button key={s._id}
                      onClick={() => { handleUpdateStatus(s.slug); setStatusDropOpen(false); }}
                      className={`w-full px-3 py-2 flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                      <span className={`px-3 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{s.label}</span>
                      {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                    </button>
                  );
                })}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* ── Pending file preview ── */}
      {pendingPreview && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
          <div className="flex items-center gap-3 px-4 py-3 bg-black/60 flex-shrink-0">
            <button onClick={() => setPendingPreview(null)}
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
              <HiOutlineX className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{pendingPreview.name}</p>
              <p className="text-xs text-primary-300 font-medium">Preview — not saved yet</p>
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0">
            {isImage(pendingPreview.name)
              ? <img src={pendingPreview.url} alt={pendingPreview.name} className="max-h-full max-w-full object-contain rounded-lg" />
              : <iframe src={pendingPreview.url} title={pendingPreview.name} className="w-full h-full rounded-lg bg-white" />
            }
          </div>
          <div className="flex items-center justify-center py-2.5 bg-black/60 flex-shrink-0">
            <p className="text-[11px] text-white/40">Click Save / Upload to persist this file</p>
          </div>
        </div>,
        document.body
      )}

      {/* ── Saved doc preview ── */}
      {previewDoc && ReactDOM.createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
          <div className="flex items-center gap-3 px-4 py-3 bg-black/60 flex-shrink-0">
            <button onClick={() => setPreviewIdx(null)}
              className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors flex-shrink-0">
              <HiOutlineX className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">{previewDoc.originalName}</p>
              <p className="text-xs text-white/40">{previewIdx + 1} / {allDocs.length} · {CATEGORY_LABELS[previewDoc.category] || previewDoc.category}</p>
            </div>
            <a href={getDocUrl(previewDoc)} download={previewDoc.originalName}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-medium rounded-lg transition-colors flex-shrink-0">
              <HiOutlineDownload className="w-4 h-4" /> Download
            </a>
          </div>
          <div className="flex-1 flex items-center justify-center p-4 min-h-0 relative">
            {previewIdx > 0 && (
              <button onClick={() => setPreviewIdx(i => i - 1)}
                className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-2.5 bg-black/40 hover:bg-black/70 text-white rounded-full transition-colors">
                <HiOutlineChevronLeft className="w-5 h-5" />
              </button>
            )}
            {previewIdx < allDocs.length - 1 && (
              <button onClick={() => setPreviewIdx(i => i + 1)}
                className="absolute right-3 top-1/2 -translate-y-1/2 z-10 p-2.5 bg-black/40 hover:bg-black/70 text-white rounded-full transition-colors">
                <HiOutlineChevronRight className="w-5 h-5" />
              </button>
            )}
            {isImage(previewDoc.fileName)
              ? <img src={getDocUrl(previewDoc)} alt={previewDoc.originalName} className="max-h-full max-w-full object-contain rounded-lg" />
              : <iframe src={getDocUrl(previewDoc)} title={previewDoc.originalName} className="w-full h-full rounded-lg bg-white" />
            }
          </div>
          {allDocs.length > 1 && (
            <div className="flex items-center justify-center py-2.5 bg-black/60 flex-shrink-0">
              <p className="text-[11px] text-white/30">← → to navigate · Esc to close</p>
            </div>
          )}
        </div>,
        document.body
      )}

      {stickerOpen && (() => {
        const recipient = claim.tpa?.name
          ? { label: 'TPA', name: claim.tpa.name, address: claim.tpa.address, mobile: claim.tpa.mobile }
          : { label: 'Insurance Company', name: claim.insuranceCompany?.name, address: claim.insuranceCompany?.address, mobile: claim.insuranceCompany?.mobile };
        const sender = claim.isDirectPatient
          ? { name: 'Direct Patient', address: '', phone: '' }
          : { name: claim.hospital?.name, address: claim.hospital?.address, phone: claim.hospital?.phone };
        const claimNo = claim.ccnNo || (claim.monthClaimNo ? `M${claim.monthClaimNo}` : claim._id?.slice(-8).toUpperCase() || '');
        return ReactDOM.createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 print:bg-white print:p-0 print:static print:block">
            <style>{`
              @media print {
                @page { size: A4 portrait; margin: 10mm; }
                body * { visibility: hidden !important; }
                #courier-sticker-print, #courier-sticker-print * { visibility: visible !important; }
                #courier-sticker-print {
                  position: absolute !important;
                  left: 0 !important; top: 0 !important;
                  width: 100% !important;
                  padding: 0 !important;
                  background: white !important;
                }
                #courier-sticker-print .sticker-card {
                  width: 100% !important;
                  box-sizing: border-box !important;
                  box-shadow: none !important;
                  border: 2px solid #111 !important;
                  border-radius: 4px !important;
                  background: white !important;
                }
              }
            `}</style>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] print:rounded-none print:shadow-none print:max-w-full print:max-h-full">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 print:hidden">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Courier Sticker</h3>
                  <p className="text-xs text-gray-400 mt-0.5">A4 portrait · prints at top of page</p>
                </div>
                <button onClick={() => setStickerOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
                  <HiOutlineX className="w-5 h-5" />
                </button>
              </div>

              <div id="courier-sticker-print" className="p-6 overflow-y-auto flex-1 font-sans text-gray-900 bg-gray-100">
                <div className="sticker-card bg-white border-2 border-gray-900 rounded-lg shadow-sm overflow-hidden">
                  <div className="p-4 space-y-3">
                    <div>
                      <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">TO · {recipient.label}</p>
                      <p className="text-lg font-extrabold leading-tight text-gray-900">{recipient.name || '—'}</p>
                      {recipient.address && (
                        <p className="mt-1 text-sm leading-snug whitespace-pre-line text-gray-700">{recipient.address}</p>
                      )}
                      {recipient.mobile && (
                        <p className="mt-1 text-sm text-gray-700"><span className="font-semibold">Mobile:</span> {recipient.mobile}</p>
                      )}
                    </div>

                    <div className="border-t-2 border-dashed border-gray-400" />

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">FROM</p>
                        <p className="text-sm font-bold leading-tight text-gray-900">{sender.name || '—'}</p>
                        {sender.address && (
                          <p className="mt-0.5 text-xs leading-snug whitespace-pre-line text-gray-600">{sender.address}</p>
                        )}
                        {sender.phone && (
                          <p className="mt-0.5 text-xs text-gray-600">M: {sender.phone}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold tracking-widest text-gray-500 mb-1">CLAIM</p>
                        <p className="text-sm text-gray-900"><span className="font-semibold">Patient:</span> {claim.patientName || '—'}</p>
                        <p className="mt-0.5 text-sm text-gray-900"><span className="font-semibold">Claim No:</span> <span className="font-mono">{claimNo || '—'}</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl print:hidden">
                <button onClick={() => setStickerOpen(false)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium">
                  Close
                </button>
                <button onClick={() => window.print()}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium shadow-sm">
                  <HiOutlinePrinter className="w-4 h-4" /> Print
                </button>
              </div>
            </div>
          </div>,
          document.body
        );
      })()}
    </div>
  );
};

export default ClaimDetail;
