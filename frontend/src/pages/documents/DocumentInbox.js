import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  getSubmissionsAPI, updateSubmissionAPI, deleteSubmissionAPI,
  downloadSubmissionAPI, getClaimDocumentTypesAPI, getHospitalsAPI,
} from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import {
  HiOutlineSearch, HiOutlineDownload, HiOutlineTrash,
  HiOutlineDocumentText, HiOutlinePhotograph, HiOutlineClipboardList,
  HiOutlinePlus, HiOutlineEye, HiOutlineRefresh, HiChevronDown,
} from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';

const STATUS_OPTIONS = [
  { value: 'pending',  label: 'Pending' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'claimed',  label: 'Claimed' },
];

const STATUS_STYLES = {
  pending:  { badge: 'bg-amber-100 text-amber-700 border border-amber-200',  label: 'Pending' },
  reviewed: { badge: 'bg-blue-100 text-blue-700 border border-blue-200',     label: 'Reviewed' },
  claimed:  { badge: 'bg-green-100 text-green-700 border border-green-200',  label: 'Claimed' },
};

const FileIcon = ({ fileType }) => {
  if (fileType?.startsWith('image/')) return <HiOutlinePhotograph className="w-4 h-4 text-primary-500" />;
  return <HiOutlineDocumentText className="w-4 h-4 text-red-500" />;
};

const formatSize = (bytes) => {
  if (!bytes) return '';
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

const DocumentInbox = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const highlightId = searchParams.get('submissionId');
  const highlightRef = useRef(null);
  const { can, user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [docTypes, setDocTypes] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState(null);
  const [openPatient, setOpenPatient] = useState(null);
  const [filters, setFilters] = useState({ search: '', status: '', hospital: '', documentType: '' });

  const isHospitalUser = !!user?.hospital;

  const load = useCallback(() => {
    setLoading(true);
    const params = { limit: 200 };
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    getSubmissionsAPI(params)
      .then(({ data }) => {
        const list = data.submissions || data;
        setSubmissions(list);
        setTotal(data.total || list.length);
        if (highlightId) {
          const target = list.find(s => s._id === highlightId);
          if (target) setOpenPatient(target.patientName);
        } else {
          const first = list[0]?.patientName || null;
          setOpenPatient(prev => prev || first);
        }
      })
      .catch(() => toast.error('Failed to load submissions'))
      .finally(() => setLoading(false));
  }, [filters, highlightId]);

  useEffect(() => { load(); }, [load]);

  // Scroll highlighted row into view after render
  useEffect(() => {
    if (highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });

  useEffect(() => {
    if (!isHospitalUser) {
      getHospitalsAPI({ active: 'true' }).then(({ data }) => setHospitals(data)).catch(() => {});
    }
    getClaimDocumentTypesAPI().then(({ data }) => setDocTypes(data)).catch(() => {});
  }, [isHospitalUser]);

  const handleDownload = async (s) => {
    try {
      const { data, headers } = await downloadSubmissionAPI(s._id);
      const contentDisposition = headers['content-disposition'] || '';
      const nameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
      const filename = nameMatch?.[1] || s.originalName || s.fileName || 'document';
      const url = URL.createObjectURL(new Blob([data], { type: s.fileType || 'application/octet-stream' }));
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Download failed');
    }
  };

  const handleMarkReviewed = async (s) => {
    setActionId(s._id);
    try {
      const newStatus = s.status === 'reviewed' ? 'pending' : 'reviewed';
      await updateSubmissionAPI(s._id, { status: newStatus });
      toast.success(`Marked as ${newStatus}`);
      load();
    } catch {
      toast.error('Failed to update status');
    } finally { setActionId(null); }
  };

  const handleCreateClaim = (s) => {
    navigate(`/claims/new?${new URLSearchParams({ patientName: s.patientName, submissionId: s._id }).toString()}`);
  };

  const handleDelete = async (s) => {
    if (!window.confirm(`Delete submission for "${s.patientName}"?`)) return;
    setActionId(s._id);
    try {
      await deleteSubmissionAPI(s._id);
      toast.success('Deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    } finally { setActionId(null); }
  };

  // Group by patient name
  const grouped = submissions.reduce((acc, s) => {
    if (!acc[s.patientName]) acc[s.patientName] = [];
    acc[s.patientName].push(s);
    return acc;
  }, {});
  const patientNames = Object.keys(grouped);

  const groupStatusLabel = (docs) => {
    if (docs.some(d => d.claim)) return 'claimed';
    if (docs.every(d => d.status !== 'pending')) return 'reviewed';
    return 'pending';
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Document Inbox</h1>
          <p className="text-sm text-gray-500 mt-1">{total} submissions total</p>
        </div>
        <button onClick={load}
          className="flex items-center gap-2 border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-2.5 rounded-lg text-sm font-medium">
          <HiOutlineRefresh className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* Stats */}
      {!isHospitalUser && (
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Pending',  count: submissions.filter(s => s.status === 'pending').length,  style: 'bg-amber-50 border-amber-200', text: 'text-amber-700' },
            { label: 'Reviewed', count: submissions.filter(s => s.status === 'reviewed').length, style: 'bg-blue-50 border-blue-200',   text: 'text-blue-700' },
            { label: 'Claimed',  count: submissions.filter(s => s.status === 'claimed').length,  style: 'bg-green-50 border-green-200', text: 'text-green-700' },
          ].map(({ label, count, style, text }) => (
            <div key={label} className={`rounded-xl border p-3 text-center ${style}`}>
              <p className={`text-xl font-bold ${text}`}>{count}</p>
              <p className={`text-xs font-medium mt-0.5 ${text}`}>{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
        <div className={`grid gap-3 grid-cols-1 ${isHospitalUser ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
          <div className="relative sm:col-span-2 lg:col-span-1">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              placeholder="Search patient name..."
              value={filters.search}
              onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
              className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
          <SearchableSelect
            options={STATUS_OPTIONS}
            value={filters.status}
            onChange={val => setFilters(f => ({ ...f, status: val }))}
            placeholder="All Status"
            noneLabel="All Status"
          />
          {!isHospitalUser && (
            <SearchableSelect
              options={hospitals.map(h => ({ value: h._id, label: h.name }))}
              value={filters.hospital}
              onChange={val => setFilters(f => ({ ...f, hospital: val }))}
              placeholder="All Hospitals"
              searchPlaceholder="Search hospitals..."
              noneLabel="All Hospitals"
            />
          )}
          <SearchableSelect
            options={docTypes.map(d => ({ value: d._id, label: d.name }))}
            value={filters.documentType}
            onChange={val => setFilters(f => ({ ...f, documentType: val }))}
            placeholder="All Doc Types"
            searchPlaceholder="Search doc types..."
            noneLabel="All Doc Types"
          />
        </div>
      </div>

      {/* Grouped Accordion */}
      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : patientNames.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 py-14 text-center">
          <HiOutlineClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-400">No submissions found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {patientNames.map(name => {
            const docs     = grouped[name];
            const isOpen   = openPatient === name;
            const gStatus  = groupStatusLabel(docs);
            const st       = STATUS_STYLES[gStatus] || STATUS_STYLES.pending;
            const hospital = docs[0]?.hospital?.name;
            const hasPendingClaim = docs.some(d => d.status !== 'claimed' && !d.claim);

            return (
              <div key={name} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                {/* Accordion header */}
                <button
                  type="button"
                  onClick={() => setOpenPatient(prev => prev === name ? null : name)}
                  className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary-700">{name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-800">{name}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {hospital}{hospital ? ' · ' : ''}{docs.length} document{docs.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${st.badge}`}>{st.label}</span>
                    <HiChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </div>
                </button>

                {/* Document rows */}
                {isOpen && (
                  <div className="border-t border-gray-100">
                    {/* Mobile */}
                    <div className="md:hidden divide-y divide-gray-100">
                      {docs.map(s => {
                        const dst = STATUS_STYLES[s.status] || STATUS_STYLES.pending;
                        const busy = actionId === s._id;
                        return (
                          <div
                            key={s._id}
                            ref={s._id === highlightId ? highlightRef : null}
                            className={`p-4 ${s._id === highlightId ? 'bg-primary-50 border-l-4 border-primary-400' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <FileIcon fileType={s.fileType} />
                                <span className="text-sm font-medium text-gray-700 truncate">{s.documentType?.name || '-'}</span>
                              </div>
                              <div className="text-right">
                                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${dst.badge}`}>{dst.label}</span>
                                {s.statusChangedBy?.name && (
                                  <p className="text-xs text-gray-400 mt-0.5">by {s.statusChangedBy.name}</p>
                                )}
                              </div>
                            </div>
                            <p className="text-xs text-gray-400 mb-1">{s.originalName || s.fileName || '-'} · {formatSize(s.fileSize)} · {formatDate(s.createdAt)}</p>
                            {s.uploadedBy?.name && (
                              <p className="text-xs text-primary-600 font-medium mb-2">Uploaded by {s.uploadedBy.name}</p>
                            )}
                            {s.notes && <p className="text-xs text-gray-500 bg-gray-50 rounded px-2 py-1 mb-2">{s.notes}</p>}
                            <div className="flex flex-wrap gap-1.5">
                              <button onClick={() => handleDownload(s)}
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50">
                                <HiOutlineDownload className="w-3.5 h-3.5" /> Download
                              </button>
                              {can('document_submissions', 'edit') && s.status !== 'claimed' && (
                                <button onClick={() => handleMarkReviewed(s)} disabled={busy}
                                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${s.status === 'reviewed' ? 'text-gray-600 border-gray-200 hover:bg-gray-50' : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'}`}>
                                  {s.status === 'reviewed' ? 'Unmark' : 'Reviewed'}
                                </button>
                              )}
                              {s.claim && (
                                <button onClick={() => navigate(`/claims/${s.claim._id}`)}
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg">
                                  <HiOutlineEye className="w-3.5 h-3.5" /> SR#{s.claim.srNo}
                                </button>
                              )}
                              {can('document_submissions', 'delete') && (
                                <button onClick={() => handleDelete(s)} disabled={busy}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg ml-auto">
                                  <HiOutlineTrash className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Desktop */}
                    <div className="hidden md:block overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50/80 border-b border-gray-100">
                          <tr>
                            {!isHospitalUser && <th className="text-left py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Hospital</th>}
                            <th className="text-left py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Doc Type</th>
                            <th className="text-left py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">File</th>
                            <th className="text-left py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Uploaded By</th>
                            <th className="text-center py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Status</th>
                            <th className="text-left py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Date</th>
                            <th className="text-right py-2.5 px-5 text-xs font-semibold text-gray-400 uppercase">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {docs.map(s => {
                            const dst = STATUS_STYLES[s.status] || STATUS_STYLES.pending;
                            const busy = actionId === s._id;
                            return (
                              <tr
                                key={s._id}
                                ref={s._id === highlightId ? highlightRef : null}
                                className={`hover:bg-gray-50/60 transition-colors ${s._id === highlightId ? 'bg-primary-50 ring-1 ring-primary-300 ring-inset' : ''}`}
                              >
                                {!isHospitalUser && <td className="py-3 px-5 text-sm text-gray-500">{s.hospital?.name || '-'}</td>}
                                <td className="py-3 px-5 text-sm font-medium text-gray-700">{s.documentType?.name || '-'}</td>
                                <td className="py-3 px-5">
                                  <div className="flex items-center gap-2">
                                    <FileIcon fileType={s.fileType} />
                                    <div>
                                      <p className="text-xs font-medium text-gray-700 truncate max-w-[160px]">{s.originalName || s.fileName || '-'}</p>
                                      <p className="text-xs text-gray-400">{formatSize(s.fileSize)}</p>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-3 px-5">
                                  <div>
                                    <p className="text-sm font-medium text-gray-700">{s.uploadedBy?.name || '-'}</p>
                                    {s.uploadedBy?.name && (
                                      <p className="text-xs text-gray-400">{s.hospital?.name || ''}</p>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-5 text-center">
                                  <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${dst.badge}`}>{dst.label}</span>
                                  {s.statusChangedBy?.name && (
                                    <p className="text-xs text-gray-400 mt-1">by {s.statusChangedBy.name}</p>
                                  )}
                                </td>
                                <td className="py-3 px-5 text-sm text-gray-500 whitespace-nowrap">{formatDate(s.createdAt)}</td>
                                <td className="py-3 px-5">
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button onClick={() => handleDownload(s)} title="Download"
                                      className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                                      <HiOutlineDownload className="w-4 h-4" />
                                    </button>
                                    {can('document_submissions', 'edit') && s.status !== 'claimed' && (
                                      <button onClick={() => handleMarkReviewed(s)} disabled={busy}
                                        className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${s.status === 'reviewed' ? 'text-gray-600 hover:bg-gray-100' : 'text-blue-700 bg-blue-50 hover:bg-blue-100'}`}>
                                        {s.status === 'reviewed' ? 'Unmark' : 'Reviewed'}
                                      </button>
                                    )}
                                    {s.claim && (
                                      <button onClick={() => navigate(`/claims/${s.claim._id}`)} title="View Claim"
                                        className="px-2.5 py-1 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors">
                                        SR#{s.claim.srNo}
                                      </button>
                                    )}
                                    {can('document_submissions', 'delete') && (
                                      <button onClick={() => handleDelete(s)} disabled={busy} title="Delete"
                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                                        <HiOutlineTrash className="w-4 h-4" />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DocumentInbox;
