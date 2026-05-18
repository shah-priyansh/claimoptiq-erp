import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { getClaimAPI, updateClaimAPI, uploadDocumentsAPI, deleteDocumentAPI, getClaimStatusesAPI, getClaimDocumentTypesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import DateInput from '../../components/ui/DateInput';
import {
  HiOutlineArrowLeft, HiOutlineUpload, HiOutlineTrash, HiOutlineDownload,
  HiOutlineDocumentText, HiChevronDown, HiCheck,
  HiOutlineX, HiOutlineChevronLeft, HiOutlineChevronRight,
  HiOutlineUser, HiOutlineCash, HiOutlineTruck,
  HiOutlineShieldCheck, HiOutlinePencil, HiOutlineCalendar,
  HiOutlineClipboardList,
} from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency } from '../../utils/format';
import AmountInput from '../../components/AmountInput';
import SearchableSelect from '../../components/ui/SearchableSelect';

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  admission: 'Admission', discharge: 'Discharge', pod: 'POD / Bill',
  settlement_proof: 'Settlement Proof', other: 'Other',
};
const CATEGORY_ORDER = ['admission', 'discharge', 'pod', 'settlement_proof', 'other'];
const isImage = (name) => /\.(jpe?g|png)$/i.test(name || '');

const statusSteps = [
  { key: 'admitted',      label: 'Admitted' },
  { key: 'discharged',    label: 'Discharged' },
  { key: 'file_received', label: 'File Received' },
  { key: 'submitted',     label: 'Submitted' },
  { key: 'settled',       label: 'Settled' },
];

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
  const { can } = useAuth();
  const confirm = useConfirm();
  const [claim, setClaim] = useState(null);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [saving, setSaving] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusDropOpen, setStatusDropOpen] = useState(false);
  const [statusDropPos, setStatusDropPos] = useState({ top: 0, left: 0 });
  const statusBtnRef = useRef(null);
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pendingFiles, setPendingFiles] = useState({ discharge: [], pod: [], settlement_proof: [], other: [] });
  const [pendingPreview, setPendingPreview] = useState(null);

  const [dischargeForm, setDischargeForm] = useState({});
  const [fileForm, setFileForm] = useState({});
  const [settlementForm, setSettlementForm] = useState({});

  useEffect(() => {
    getClaimStatusesAPI().then(({ data }) => setClaimStatuses(data.filter(s => s.isActive))).catch(() => {});
    getClaimDocumentTypesAPI()
      .then(({ data }) => setDocTypes(Array.isArray(data) ? data.filter(d => d.isActive !== false) : []))
      .catch(() => toast.error('Failed to load document types'));
  }, []);

  const fetchClaim = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const { data } = await getClaimAPI(id);
      setClaim(data);
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
      setSettlementForm({
        settlementAmount: data.settlementAmount || 0,
        settlementAmountDeduction: data.settlementAmountDeduction || 0,
        mouDiscountOnSettlement: data.mouDiscountOnSettlement || 0,
        tds: data.tds || 0,
        bankTransferAmount: data.bankTransferAmount || 0,
        settlementDate: data.settlementDate?.slice(0, 10) || '',
        neftNo: data.neftNo || '',
        filePrice: data.filePrice || 0,
        remarks: data.remarks || '',
        rejectedReason: data.rejectedReason || '',
      });
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

  const handleUpdateStatus = async (slug) => {
    if (slug === claim.status) return;
    setStatusUpdating(true);
    try {
      await updateClaimAPI(id, { status: slug });
      toast.success('Status updated');
      await fetchClaim(true);
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally { setStatusUpdating(false); }
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
  const currentStepIdx = statusSteps.findIndex(s => s.key === claim.status);
  const isEditable = can('claims', 'edit');
  const canUpload = can('claims', 'edit');

  const currentStatusObj = claimStatuses.find(s => s.slug === claim.status);
  const statusBadgeCls = STATUS_COLOR_MAP[currentStatusObj?.color] || 'bg-blue-100 text-blue-700';
  const statusLabel = currentStatusObj?.label || claim.status.replace(/_/g, ' ');

  const tabs = [
    { key: 'overview',   label: 'Overview' },
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
                    setStatusDropOpen(v => !v);
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
              {isEditable && (
                <button onClick={() => navigate(`/claims/${id}/edit`)}
                  className="p-2 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-xl transition-colors">
                  <HiOutlinePencil className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
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
          </div>
        </div>
      </div>

      {/* ── Progress Timeline ── */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-4 mb-4 overflow-x-auto shadow-sm">
        <div className="flex items-center min-w-[480px]">
          {statusSteps.map((step, idx) => (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center gap-1.5">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all
                  ${idx < currentStepIdx  ? 'bg-primary-600 border-primary-600 text-white shadow-sm shadow-primary-200' :
                    idx === currentStepIdx ? 'bg-white border-primary-500 text-primary-600 shadow-sm' :
                    'bg-gray-50 border-gray-200 text-gray-300'}`}>
                  {idx < currentStepIdx ? <HiCheck className="w-4 h-4" /> : <span className="text-xs font-bold">{idx + 1}</span>}
                </div>
                <p className={`text-[11px] font-semibold whitespace-nowrap
                  ${idx < currentStepIdx  ? 'text-primary-600' :
                    idx === currentStepIdx ? 'text-primary-700' : 'text-gray-300'}`}>
                  {step.label}
                </p>
              </div>
              {idx < statusSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 rounded-full transition-all ${idx < currentStepIdx ? 'bg-primary-400' : 'bg-gray-100'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="overflow-x-auto mb-4">
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 min-w-max shadow-sm">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
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
                <StatCard label="File Price"           value={formatAmount(claim.filePrice)} />
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
                  { label: 'Final Approval Amount (₹)',name:'finalApprovalAmount', type: 'amount' },
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
                  { label: 'Settlement Amount (₹)',           name: 'settlementAmount',          type: 'amount' },
                  { label: 'Settlement Deduction (₹)',        name: 'settlementAmountDeduction',  type: 'amount' },
                  { label: 'MOU Discount on Settlement (₹)',  name: 'mouDiscountOnSettlement',    type: 'amount' },
                  { label: 'TDS (₹)',                         name: 'tds',                        type: 'amount' },
                  { label: 'Bank Transfer Amount (₹)',        name: 'bankTransferAmount',          type: 'amount' },
                  { label: 'File Price (₹)',                  name: 'filePrice',                  type: 'amount' },
                  { label: 'Settlement Date',                 name: 'settlementDate',             type: 'date' },
                  { label: 'NEFT Number',                     name: 'neftNo',                     type: 'text' },
                ].map(f => (
                  <div key={f.name}>
                    <label className={labelCls}>{f.label}</label>
                    {f.type === 'amount'
                      ? <AmountInput value={settlementForm[f.name] || 0}
                          onChange={v => setSettlementForm({ ...settlementForm, [f.name]: v })}
                          className={inputCls} />
                      : <input type={f.type} value={settlementForm[f.name] || ''}
                          onChange={e => setSettlementForm({ ...settlementForm, [f.name]: e.target.value })}
                          className={inputCls} />
                    }
                  </div>
                ))}
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
                  ['TDS',                         formatAmount(claim.tds)],
                  ['Bank Transfer Amount',        formatAmount(claim.bankTransferAmount)],
                  ['File Price',                  formatAmount(claim.filePrice)],
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

      {/* ── Status dropdown portal ── */}
      {statusDropOpen && !statusUpdating && ReactDOM.createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setStatusDropOpen(false)} />
          <div style={{ top: statusDropPos.top, left: statusDropPos.left }}
            className="fixed z-50 w-56 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 py-1.5 overflow-hidden">
            <p className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 mb-1">
              Update Status
            </p>
            {claimStatuses.map(s => {
              const cls = STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700';
              const isActive = s.slug === claim.status;
              return (
                <button key={s._id}
                  onClick={() => { handleUpdateStatus(s.slug); setStatusDropOpen(false); }}
                  className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50'}`}>
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>{s.label}</span>
                  {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                </button>
              );
            })}
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
    </div>
  );
};

export default ClaimDetail;
