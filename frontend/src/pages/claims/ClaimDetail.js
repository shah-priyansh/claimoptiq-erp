import React, { useState, useEffect, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { getClaimAPI, updateClaimAPI, uploadDocumentsAPI, deleteDocumentAPI, getClaimStatusesAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlineUpload, HiOutlineTrash, HiOutlineDownload,
  HiOutlineCheckCircle, HiOutlineDocumentText, HiChevronDown, HiCheck,
} from 'react-icons/hi';
import { STATUS_COLOR_MAP } from '../claimstatus/ClaimStatusMaster';
import { formatCurrency } from '../../utils/format';
import AmountInput from '../../components/AmountInput';

const statusSteps = [
  { key: 'admitted',      label: 'Admitted' },
  { key: 'discharged',    label: 'Discharged' },
  { key: 'file_received', label: 'File Received' },
  { key: 'submitted',     label: 'Submitted' },
  { key: 'settled',       label: 'Settled' },
];

const ClaimDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [claim, setClaim] = useState(null);
  const [claimStatuses, setClaimStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusDropOpen, setStatusDropOpen] = useState(false);
  const [statusDropPos, setStatusDropPos] = useState({ top: 0, left: 0 });
  const statusBtnRef = useRef(null);

  const [dischargeForm, setDischargeForm] = useState({});
  const [fileForm, setFileForm] = useState({});
  const [settlementForm, setSettlementForm] = useState({});

  useEffect(() => {
    getClaimStatusesAPI().then(({ data }) => setClaimStatuses(data.filter(s => s.isActive))).catch(() => {});
  }, []);

  const fetchClaim = useCallback(async () => {
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
    }
  }, [id, navigate]);

  useEffect(() => { fetchClaim(); }, [fetchClaim]);

  const handleUpdateStatus = async (slug) => {
    if (slug === claim.status) return;
    setStatusUpdating(true);
    try {
      await updateClaimAPI(id, { status: slug });
      toast.success('Status updated');
      fetchClaim();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update status');
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleSaveDischarge = async () => {
    setSaving(true);
    try {
      await updateClaimAPI(id, { ...dischargeForm, status: 'discharged' });
      toast.success('Discharge details saved');
      fetchClaim();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveFileReceive = async () => {
    setSaving(true);
    try {
      const status = fileForm.courierSubmitDate || fileForm.onlineSubmitDate ? 'submitted' : 'file_received';
      await updateClaimAPI(id, { ...fileForm, status });
      toast.success('File & submit details saved');
      fetchClaim();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleSaveSettlement = async () => {
    setSaving(true);
    try {
      const status = settlementForm.rejectedReason ? 'rejected' : 'settled';
      await updateClaimAPI(id, { ...settlementForm, status });
      toast.success('Settlement details saved');
      fetchClaim();
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleFileUpload = async (e, category) => {
    const files = e.target.files;
    if (!files.length) return;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    formData.append('category', category);
    try {
      await uploadDocumentsAPI(id, formData);
      toast.success('Documents uploaded');
      fetchClaim();
    } catch {
      toast.error('Upload failed');
    }
    e.target.value = '';
  };

  const handleDeleteDoc = async (docId) => {
    if (!window.confirm('Delete this document?')) return;
    try {
      await deleteDocumentAPI(id, docId);
      toast.success('Document deleted');
      fetchClaim();
    } catch {
      toast.error('Failed to delete');
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
    </div>;
  }

  if (!claim) return null;

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '-';
  const formatAmount = (a) => formatCurrency(Number(a) || 0);
  const currentStepIdx = statusSteps.findIndex(s => s.key === claim.status);
  const isEditable = can('claims', 'edit');
  const canUpload = can('claims', 'edit');

  const currentStatusObj = claimStatuses.find(s => s.slug === claim.status);
  const statusBadgeCls = STATUS_COLOR_MAP[currentStatusObj?.color] || 'bg-blue-100 text-blue-700';
  const statusLabel = currentStatusObj?.label || claim.status.replace(/_/g, ' ');

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'discharge', label: 'Discharge' },
    { key: 'file_submit', label: 'File & Submit' },
    { key: 'settlement', label: 'Settlement' },
    { key: 'documents', label: `Docs (${claim.documents?.length || 0})` },
  ];

  const baseUrl = process.env.REACT_APP_API_URL === '/api' ? '' : (process.env.REACT_APP_API_URL?.replace('/api', '') || 'http://localhost:5001');

  return (
    <div>
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <button onClick={() => navigate('/claims')}
          className="p-2.5 rounded-lg text-gray-500 hover:bg-gray-100 flex-shrink-0 mt-0.5">
          <HiOutlineArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-800">Claim #{claim.srNo}</h1>
          <p className="text-sm text-gray-500 truncate">{claim.patientName} · {claim.hospital?.name}</p>
        </div>
      </div>

      {/* Status Update */}
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 mb-4 flex items-center gap-3">
        <p className="text-xs text-gray-400 uppercase font-medium tracking-wide flex-shrink-0">Status</p>

        {isEditable ? (
          <>
            <button
              ref={statusBtnRef}
              onClick={() => {
                const r = statusBtnRef.current.getBoundingClientRect();
                setStatusDropPos({ top: r.bottom + 6, left: r.left });
                setStatusDropOpen(v => !v);
              }}
              disabled={statusUpdating}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold transition-opacity ${statusBadgeCls} ${statusUpdating ? 'opacity-60' : ''}`}
            >
              {statusUpdating ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <span>{statusLabel}</span>
                  <HiChevronDown className={`w-4 h-4 opacity-50 transition-transform duration-200 ${statusDropOpen ? 'rotate-180' : ''}`} />
                </>
              )}
            </button>

            {statusDropOpen && !statusUpdating && ReactDOM.createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setStatusDropOpen(false)} />
                <div
                  style={{ top: statusDropPos.top, left: statusDropPos.left }}
                  className="fixed z-50 w-56 bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 py-1.5 overflow-hidden"
                >
                  <p className="px-4 pt-1.5 pb-2 text-[10px] font-semibold text-gray-400 uppercase tracking-widest border-b border-gray-100 mb-1">
                    Update Status
                  </p>
                  {claimStatuses.map(s => {
                    const cls = STATUS_COLOR_MAP[s.color] || 'bg-gray-100 text-gray-700';
                    const isActive = s.slug === claim.status;
                    return (
                      <button
                        key={s._id}
                        onClick={() => { handleUpdateStatus(s.slug); setStatusDropOpen(false); }}
                        className={`w-full px-3 py-2.5 flex items-center justify-between gap-2 transition-colors ${isActive ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                      >
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${cls}`}>{s.label}</span>
                        {isActive && <HiCheck className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </>,
              document.body
            )}
          </>
        ) : (
          <span className={`px-4 py-2 rounded-full text-sm font-bold ${statusBadgeCls}`}>
            {statusLabel}
          </span>
        )}
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 overflow-x-auto">
        <div className="flex items-center justify-between min-w-[400px]">
          {statusSteps.map((step, idx) => (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                  ${idx <= currentStepIdx ? 'bg-primary-600 text-white' :
                    idx === currentStepIdx + 1 ? 'bg-primary-100 text-primary-600 border-2 border-primary-300' :
                    'bg-gray-100 text-gray-400'}`}>
                  {idx <= currentStepIdx ? <HiOutlineCheckCircle className="w-5 h-5" /> : idx + 1}
                </div>
                <p className={`text-xs mt-1 font-medium whitespace-nowrap ${idx <= currentStepIdx ? 'text-primary-700' : 'text-gray-400'}`}>
                  {step.label}
                </p>
              </div>
              {idx < statusSteps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-2 ${idx < currentStepIdx ? 'bg-primary-500' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="overflow-x-auto mb-4">
        <div className="flex gap-1 bg-white rounded-xl border border-gray-200 p-1 min-w-max">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap
                ${activeTab === tab.key ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Patient Details</h3>
            <div className="space-y-3">
              {[
                ['Patient Name', claim.patientName],
                ['Mobile', claim.patientMobile || '-'],
                ['Doctor', claim.doctorName || '-'],
                ['Claim Type', claim.claimType],
                ['Date of Admit', formatDate(claim.dateOfAdmit)],
                ['Date of Discharge', formatDate(claim.dateOfDischarge)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
                  <span className="text-sm font-medium text-gray-800 capitalize text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Insurance Details</h3>
            <div className="space-y-3">
              {[
                ['Insurance', claim.insuranceCompany?.name || '-'],
                ['TPA', claim.tpa?.name || '-'],
                ['Policy No', claim.policyNo || '-'],
                ['Client ID', claim.clientId || '-'],
                ['CCN No', claim.ccnNo || '-'],
                ['Month Claim #', claim.monthClaimNo],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
                  <span className="text-sm font-medium text-gray-800 text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Financial Summary</h3>
            <div className="space-y-3">
              {[
                ['Hospital Final Bill', formatAmount(claim.hospitalFinalBill)],
                ['MOU Discount', formatAmount(claim.mouDiscount)],
                ['Deduction', formatAmount(claim.deduction)],
                ['Final Approval', formatAmount(claim.finalApprovalAmount)],
                ['Settlement Amount', formatAmount(claim.settlementAmount)],
                ['TDS', formatAmount(claim.tds)],
                ['Bank Transfer', formatAmount(claim.bankTransferAmount)],
                ['File Price', formatAmount(claim.filePrice)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
                  <span className="text-sm font-medium text-gray-800 text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <h3 className="text-base font-semibold text-gray-800 mb-4">Submission & Courier</h3>
            <div className="space-y-3">
              {[
                ['File Received', formatDate(claim.fileReceivedDate)],
                ['Submit Mode', claim.submitMode || '-'],
                ['Courier Date', formatDate(claim.courierSubmitDate)],
                ['Online Date', formatDate(claim.onlineSubmitDate)],
                ['Courier Company', claim.courierCompanyName || '-'],
                ['POD Number', claim.podNumber || '-'],
                ['Settlement Date', formatDate(claim.settlementDate)],
                ['NEFT No', claim.neftNo || '-'],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4">
                  <span className="text-sm text-gray-500 flex-shrink-0">{label}</span>
                  <span className="text-sm font-medium text-gray-800 text-right">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'discharge' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Discharge Details</h3>
          {isEditable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Date of Admit', name: 'dateOfAdmit', type: 'date' },
                { label: 'Date of Discharge', name: 'dateOfDischarge', type: 'date' },
                { label: 'Final Approval Date', name: 'finalApprovalDate', type: 'date' },
                { label: 'Hospital Final Bill (Rs)', name: 'hospitalFinalBill', type: 'number' },
                { label: 'MOU Discount (Rs)', name: 'mouDiscount', type: 'number' },
                { label: 'Deduction (Rs)', name: 'deduction', type: 'number' },
                { label: 'Final Approval Amount (Rs)', name: 'finalApprovalAmount', type: 'number' },
              ].map(f => (
                <div key={f.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  {f.type === 'number' ? (
                    <AmountInput
                      value={dischargeForm[f.name] || 0}
                      onChange={(v) => setDischargeForm({ ...dischargeForm, [f.name]: v })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  ) : (
                    <input type={f.type} value={dischargeForm[f.name] || ''}
                      onChange={(e) => setDischargeForm({ ...dischargeForm, [f.name]: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['Date of Admit', formatDate(claim.dateOfAdmit)],
                ['Date of Discharge', formatDate(claim.dateOfDischarge)],
                ['Final Approval Date', formatDate(claim.finalApprovalDate)],
                ['Hospital Final Bill', formatAmount(claim.hospitalFinalBill)],
                ['MOU Discount', formatAmount(claim.mouDiscount)],
                ['Deduction', formatAmount(claim.deduction)],
                ['Final Approval Amount', formatAmount(claim.finalApprovalAmount)],
              ].map(([label, value]) => (
                <div key={label} className="bg-gray-50 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          )}
          {canUpload && (
            <div className="mt-4">
              <label className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer w-fit">
                <HiOutlineUpload className="w-4 h-4" /> Upload Discharge Docs
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => handleFileUpload(e, 'discharge')} />
              </label>
            </div>
          )}
          {isEditable && (
            <button onClick={handleSaveDischarge} disabled={saving}
              className="mt-4 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 w-full sm:w-auto">
              {saving ? 'Saving...' : 'Save Discharge'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'file_submit' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">File Receive & Submit</h3>
          {isEditable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File Received Date</label>
                <input type="date" value={fileForm.fileReceivedDate}
                  onChange={(e) => setFileForm({ ...fileForm, fileReceivedDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Submit Mode</label>
                <select value={fileForm.submitMode}
                  onChange={(e) => setFileForm({ ...fileForm, submitMode: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500">
                  <option value="">Select</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline (Courier)</option>
                  <option value="both">Both</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Online Submit Date</label>
                <input type="date" value={fileForm.onlineSubmitDate}
                  onChange={(e) => setFileForm({ ...fileForm, onlineSubmitDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Courier Submit Date</label>
                <input type="date" value={fileForm.courierSubmitDate}
                  onChange={(e) => setFileForm({ ...fileForm, courierSubmitDate: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Courier Company</label>
                <input value={fileForm.courierCompanyName}
                  onChange={(e) => setFileForm({ ...fileForm, courierCompanyName: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">POD / Docket Number</label>
                <input value={fileForm.podNumber}
                  onChange={(e) => setFileForm({ ...fileForm, podNumber: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['File Received Date', formatDate(claim.fileReceivedDate)],
                ['Submit Mode', claim.submitMode || '-'],
                ['Online Submit Date', formatDate(claim.onlineSubmitDate)],
                ['Courier Submit Date', formatDate(claim.courierSubmitDate)],
                ['Courier Company', claim.courierCompanyName || '-'],
                ['POD / Docket Number', claim.podNumber || '-'],
              ].map(([label, value]) => (
                <div key={label} className="bg-gray-50 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          )}
          {canUpload && (
            <div className="mt-4">
              <label className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer w-fit">
                <HiOutlineUpload className="w-4 h-4" /> Upload POD / Bill
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => handleFileUpload(e, 'pod')} />
              </label>
            </div>
          )}
          {isEditable && (
            <button onClick={handleSaveFileReceive} disabled={saving}
              className="mt-4 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 w-full sm:w-auto">
              {saving ? 'Saving...' : 'Save File & Submit'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'settlement' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Payment Settlement</h3>
          {isEditable ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                { label: 'Settlement Amount (Rs)', name: 'settlementAmount', type: 'number' },
                { label: 'Settlement Deduction (Rs)', name: 'settlementAmountDeduction', type: 'number' },
                { label: 'MOU Discount on Settlement (Rs)', name: 'mouDiscountOnSettlement', type: 'number' },
                { label: 'TDS (Rs)', name: 'tds', type: 'number' },
                { label: 'Bank Transfer Amount (Rs)', name: 'bankTransferAmount', type: 'number' },
                { label: 'Settlement Date', name: 'settlementDate', type: 'date' },
                { label: 'NEFT Number', name: 'neftNo', type: 'text' },
                { label: 'File Price (Rs)', name: 'filePrice', type: 'number' },
              ].map(f => (
                <div key={f.name}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{f.label}</label>
                  {f.type === 'number' ? (
                    <AmountInput
                      value={settlementForm[f.name] || 0}
                      onChange={(v) => setSettlementForm({ ...settlementForm, [f.name]: v })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  ) : (
                    <input type={f.type} value={settlementForm[f.name] || ''}
                      onChange={(e) => setSettlementForm({ ...settlementForm, [f.name]: e.target.value })}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
                  )}
                </div>
              ))}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Remarks</label>
                <textarea value={settlementForm.remarks}
                  onChange={(e) => setSettlementForm({ ...settlementForm, remarks: e.target.value })} rows={2}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rejected Reason (if rejected)</label>
                <input value={settlementForm.rejectedReason}
                  onChange={(e) => setSettlementForm({ ...settlementForm, rejectedReason: e.target.value })}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['Settlement Amount', formatAmount(claim.settlementAmount)],
                ['Settlement Deduction', formatAmount(claim.settlementAmountDeduction)],
                ['MOU Discount on Settlement', formatAmount(claim.mouDiscountOnSettlement)],
                ['TDS', formatAmount(claim.tds)],
                ['Bank Transfer Amount', formatAmount(claim.bankTransferAmount)],
                ['Settlement Date', formatDate(claim.settlementDate)],
                ['NEFT Number', claim.neftNo || '-'],
                ['File Price', formatAmount(claim.filePrice)],
                ['Remarks', claim.remarks || '-'],
                ['Rejected Reason', claim.rejectedReason || '-'],
              ].map(([label, value]) => (
                <div key={label} className="bg-gray-50 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-0.5">{label}</p>
                  <p className="text-sm font-semibold text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          )}
          {canUpload && (
            <div className="mt-4">
              <label className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer w-fit">
                <HiOutlineUpload className="w-4 h-4" /> Upload Settlement Proof
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => handleFileUpload(e, 'settlement_proof')} />
              </label>
            </div>
          )}
          {isEditable && (
            <button onClick={handleSaveSettlement} disabled={saving}
              className="mt-4 bg-primary-600 hover:bg-primary-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium disabled:opacity-50 w-full sm:w-auto">
              {saving ? 'Saving...' : 'Save Settlement'}
            </button>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-800">Documents</h3>
            {isEditable && (
              <label className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium cursor-pointer">
                <HiOutlineUpload className="w-4 h-4" /> Upload
                <input type="file" multiple accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                  onChange={(e) => handleFileUpload(e, 'other')} />
              </label>
            )}
          </div>
          {(!claim.documents || claim.documents.length === 0) ? (
            <p className="text-sm text-gray-400 text-center py-8">No documents uploaded yet</p>
          ) : (
            <div className="space-y-2">
              {claim.documents.map((doc) => (
                <div key={doc._id} className="flex items-center justify-between border border-gray-200 rounded-lg p-3 hover:bg-gray-50">
                  <div className="flex items-center gap-3 min-w-0">
                    <HiOutlineDocumentText className="w-8 h-8 text-primary-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{doc.originalName}</p>
                      <p className="text-xs text-gray-400">
                        {doc.category} · {(doc.fileSize / 1024).toFixed(1)} KB · {new Date(doc.uploadedAt).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <a href={`${baseUrl}/uploads/${doc.fileName}`} target="_blank" rel="noreferrer"
                      className="p-2.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                      <HiOutlineDownload className="w-4 h-4" />
                    </a>
                    {isEditable && (
                      <button onClick={() => handleDeleteDoc(doc._id)}
                        className="p-2.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg">
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ClaimDetail;
