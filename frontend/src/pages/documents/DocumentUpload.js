import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../context/AuthContext';
import { uploadSubmissionAPI, getClaimDocumentTypesAPI, getSubmissionsAPI, downloadSubmissionAPI, deleteSubmissionAPI } from '../../services/api';
import { toast } from 'react-toastify';
import SearchableSelect from '../../components/ui/SearchableSelect';
import {
  HiOutlineCamera, HiOutlineFolderOpen, HiOutlineDocumentText,
  HiOutlineX, HiOutlineCheckCircle,
  HiOutlineRefresh, HiOutlinePlus, HiOutlineCloudUpload,
  HiOutlineInbox, HiOutlineDownload, HiOutlineTrash, HiOutlineEye,
} from 'react-icons/hi';

const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_STYLE = {
  pending:  'bg-yellow-50 text-yellow-700 border border-yellow-200',
  reviewed: 'bg-blue-50 text-blue-700 border border-blue-200',
  claimed:  'bg-green-50 text-green-700 border border-green-200',
};

const isMobileDevice = () => /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ─── Webcam Modal ─────────────────────────────────────────────────────────────
const WebcamModal = ({ onCapture, onClose }) => {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [ready, setReady]         = useState(false);
  const [facing, setFacing]       = useState('environment');
  const [switching, setSwitching] = useState(false);
  const [error, setError]         = useState('');
  const [captureCount, setCaptureCount] = useState(0);
  const [flash, setFlash]         = useState(false);

  const startStream = useCallback(async (facingMode) => {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setReady(false); setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch (err) {
      setError(
        err.name === 'NotAllowedError' ? 'Camera permission denied. Allow it in browser settings.' :
        err.name === 'NotFoundError'   ? 'No camera found on this device.' :
        'Could not open camera.'
      );
    }
  }, []);

  useEffect(() => {
    startStream('environment');
    return () => { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); };
  }, [startStream]);

  const handleSwitch = async () => {
    const next = facing === 'environment' ? 'user' : 'environment';
    setSwitching(true); setFacing(next);
    await startStream(next);
    setSwitching(false);
  };

  const handleCapture = () => {
    const v = videoRef.current;
    if (!v || !ready) return;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    c.toBlob(blob => {
      onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' }));
      setCaptureCount(n => n + 1);
      setFlash(true);
      setTimeout(() => setFlash(false), 200);
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 bg-black/80 flex-shrink-0">
        <p className="text-white text-sm font-semibold">
          Take Photos
          {captureCount > 0 && (
            <span className="ml-2 bg-primary-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
              {captureCount} captured
            </span>
          )}
        </p>
        <button onClick={onClose} className="px-4 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium">
          {captureCount > 0 ? `Done (${captureCount})` : 'Cancel'}
        </button>
      </div>
      <div className="flex-1 min-h-0 relative bg-black overflow-hidden">
        {flash && <div className="absolute inset-0 bg-white z-10 pointer-events-none" />}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            <HiOutlineCamera className="w-14 h-14 text-white/30 mb-3" />
            <p className="text-white/70 text-sm">{error}</p>
            <button onClick={onClose} className="mt-5 px-5 py-2.5 bg-white text-gray-900 rounded-xl text-sm font-medium">Close</button>
          </div>
        ) : (
          <video ref={videoRef} autoPlay playsInline muted onLoadedMetadata={() => setReady(true)}
            className="absolute inset-0 w-full h-full object-cover" />
        )}
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black">
            <div className="w-8 h-8 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          </div>
        )}
      </div>
      {!error && (
        <div className="bg-black flex-shrink-0 px-6 py-6 flex items-center justify-between">
          <button onClick={handleSwitch} disabled={switching}
            className="w-12 h-12 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white disabled:opacity-40">
            <HiOutlineRefresh className={`w-5 h-5 ${switching ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={handleCapture} disabled={!ready}
            className="rounded-full bg-white disabled:opacity-40 active:scale-95 transition-transform flex items-center justify-center shadow-xl"
            style={{ width: 72, height: 72 }}>
            <div className="w-14 h-14 rounded-full border-4 border-gray-300" />
          </button>
          <div className="w-12" />
        </div>
      )}
    </div>
  );
};

// ─── File Thumbnail ────────────────────────────────────────────────────────────
const FilePill = ({ file, preview, onRemove }) => (
  <div className="relative flex-shrink-0">
    <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 flex items-center justify-center border border-gray-200">
      {preview
        ? <img src={preview} alt="" className="w-full h-full object-cover" />
        : <HiOutlineDocumentText className="w-8 h-8 text-red-400" />}
    </div>
    <button
      onClick={onRemove}
      className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-sm active:scale-90">
      <HiOutlineX className="w-3.5 h-3.5" />
    </button>
    <p className="text-xs text-gray-400 mt-1 w-20 truncate text-center">{file.name.split('.')[0]}</p>
  </div>
);

// ─── Document Group Card ───────────────────────────────────────────────────────
const DocGroup = ({ group, index, docTypes, onTypeChange, onRemoveFile, onAddFiles, onAddCamera, onRemoveGroup }) => (
  <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
    <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
      <span className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
        {index + 1}
      </span>
      <div className="flex-1 min-w-0">
        <SearchableSelect
          options={docTypes.map(d => ({ value: d._id, label: d.name }))}
          value={group.docTypeId}
          onChange={val => onTypeChange(group.id, val)}
          placeholder="Select document type…"
          searchPlaceholder="Search types…"
        />
      </div>
      <button onClick={() => onRemoveGroup(group.id)}
        className="w-9 h-9 rounded-xl text-gray-300 hover:text-red-500 hover:bg-red-50 flex items-center justify-center flex-shrink-0 transition-colors">
        <HiOutlineTrash className="w-4 h-4" />
      </button>
    </div>

    <div className="px-4 py-3">
      <div className="flex gap-3 overflow-x-auto pb-1">
        {group.files.map(f => (
          <FilePill key={f.id} file={f.file} preview={f.preview} onRemove={() => onRemoveFile(group.id, f.id)} />
        ))}
        <div className="flex flex-col gap-2 flex-shrink-0">
          <button onClick={() => onAddCamera(group.id)}
            className="w-20 h-9 rounded-lg border border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50 flex items-center justify-center gap-1 text-gray-400 hover:text-primary-600 transition-colors">
            <HiOutlineCamera className="w-4 h-4" />
            <span className="text-xs font-medium">Photo</span>
          </button>
          <button onClick={() => onAddFiles(group.id)}
            className="w-20 h-9 rounded-lg border border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50 flex items-center justify-center gap-1 text-gray-400 hover:text-primary-600 transition-colors">
            <HiOutlinePlus className="w-4 h-4" />
            <span className="text-xs font-medium">File</span>
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {group.files.length} file{group.files.length !== 1 ? 's' : ''}
        {!group.docTypeId && <span className="text-amber-500 ml-2">← Select type above</span>}
      </p>
    </div>
  </div>
);

// ─── Progress Overlay ─────────────────────────────────────────────────────────
const ProgressOverlay = ({ current, total }) => (
  <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center px-6">
    <div className="bg-white rounded-2xl p-8 w-full max-w-xs text-center shadow-xl">
      <div className="w-14 h-14 border-4 border-primary-100 border-t-primary-600 rounded-full animate-spin mx-auto mb-5" />
      <p className="text-base font-bold text-gray-800">Uploading…</p>
      <p className="text-sm text-gray-500 mt-1">{current} of {total} document{total > 1 ? 's' : ''}</p>
      <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary-600 rounded-full transition-all duration-500"
          style={{ width: `${Math.round((current / total) * 100)}%` }} />
      </div>
      <p className="text-xs text-gray-400 mt-3">Please don't close this page</p>
    </div>
  </div>
);

// ─── My Uploads (grouped by patient, accordion) ───────────────────────────────
const MyUploads = () => {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [openName, setOpenName]       = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [deleting, setDeleting]       = useState(null);

  const load = useCallback(async (q = '') => {
    setLoading(true);
    try {
      const { data } = await getSubmissionsAPI({ limit: 200, search: q });
      const list = data.submissions || data;
      setSubmissions(list);
      setOpenName(prev => prev || list[0]?.patientName || null);
    } catch {
      toast.error('Failed to load uploads');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(''); }, [load]);

  const handleSearch = (e) => { const q = e.target.value; setSearch(q); load(q); };
  const toggleName = (name) => setOpenName(prev => prev === name ? null : name);

  const handleDownload = async (sub) => {
    setDownloading(sub._id);
    try {
      const { data } = await downloadSubmissionAPI(sub._id);
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement('a'); a.href = url; a.download = sub.file?.originalName || 'document'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
    finally { setDownloading(null); }
  };

  const handleDelete = async (sub) => {
    if (!window.confirm(`Delete "${sub.file?.originalName}"? This cannot be undone.`)) return;
    setDeleting(sub._id);
    try {
      await deleteSubmissionAPI(sub._id);
      toast.success('Document deleted');
      load(search);
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(null); }
  };

  const grouped = submissions.reduce((acc, sub) => {
    if (!acc[sub.patientName]) acc[sub.patientName] = [];
    acc[sub.patientName].push(sub);
    return acc;
  }, {});
  const patientNames = Object.keys(grouped);

  return (
    <div>
      <div className="flex gap-2 mb-4">
        <input value={search} onChange={handleSearch} placeholder="Search by patient name…"
          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
        <button onClick={() => load(search)} className="p-2.5 border border-gray-300 rounded-xl text-gray-500 hover:bg-gray-50">
          <HiOutlineRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-primary-200 border-t-primary-600 rounded-full animate-spin" />
        </div>
      ) : patientNames.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
          <HiOutlineInbox className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No documents uploaded yet</p>
          <p className="text-sm text-gray-400 mt-1">Switch to Upload to add documents</p>
        </div>
      ) : (
        <div className="space-y-3">
          {patientNames.map(name => {
            const docs      = grouped[name];
            const isOpen    = openName === name;
            const hasClaim  = docs.some(d => d.claim);
            const allDone   = docs.every(d => d.status !== 'pending');
            const statusLabel = hasClaim ? 'Claimed' : allDone ? 'Reviewed' : 'Pending';
            const statusCls   = hasClaim
              ? 'bg-green-50 text-green-700 border-green-200'
              : allDone
              ? 'bg-blue-50 text-blue-700 border-blue-200'
              : 'bg-yellow-50 text-yellow-700 border-yellow-200';

            return (
              <div key={name} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <button type="button" onClick={() => toggleName(name)}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 transition-colors text-left">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary-700">{name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-800">{name}</p>
                      <p className="text-xs text-gray-400">{docs.length} document{docs.length > 1 ? 's' : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${statusCls}`}>{statusLabel}</span>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {docs.map(sub => (
                      <div key={sub._id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                          <HiOutlineDocumentText className="w-4 h-4 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800 truncate">{sub.documentType?.name || '—'}</p>
                          <p className="text-xs text-gray-400 truncate">{sub.file?.originalName} · {formatDate(sub.createdAt)}</p>
                          {sub.notes && <p className="text-xs text-gray-400 italic truncate">"{sub.notes}"</p>}
                        </div>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0 border ${STATUS_STYLE[sub.status] || STATUS_STYLE.pending}`}>
                          {sub.status.charAt(0).toUpperCase() + sub.status.slice(1)}
                        </span>
                        <button onClick={() => handleDownload(sub)} disabled={downloading === sub._id} title="Download"
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary-600 hover:bg-primary-50 flex-shrink-0 transition-colors disabled:opacity-40">
                          <HiOutlineDownload className="w-4 h-4" />
                        </button>
                        {sub.status === 'pending' && (
                          <button onClick={() => handleDelete(sub)} disabled={deleting === sub._id} title="Delete"
                            className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex-shrink-0 transition-colors disabled:opacity-40">
                            <HiOutlineTrash className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    ))}
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

// ─── Main Component ───────────────────────────────────────────────────────────
const DocumentUpload = () => {
  const { user } = useAuth();
  const [tab, setTab]               = useState('upload');
  const [groups, setGroups]         = useState([]);
  const [docTypes, setDocTypes]     = useState([]);
  const [patientName, setPatientName] = useState('');
  const [notes, setNotes]           = useState('');
  const [progress, setProgress]     = useState(null);
  const [successCount, setSuccessCount] = useState(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [webcamTargetGroup, setWebcamTargetGroup] = useState(null);

  const galleryRef      = useRef(null);
  const mobileCamRef    = useRef(null);
  const galleryGroupRef = useRef(null);
  const idRef           = useRef(0);
  const groupIdRef      = useRef(0);

  useEffect(() => {
    getClaimDocumentTypesAPI()
      .then(({ data }) => setDocTypes(data.filter(d => d.isActive)))
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    groups.forEach(g => g.files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); }));
  }, []); // eslint-disable-line

  const makeFileEntry = (file) => {
    if (!file) return null;
    if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name}: too large (max 10 MB)`); return null; }
    return { id: ++idRef.current, file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
  };

  const addFilesToGroup = (groupId, files) => {
    const entries = files.map(makeFileEntry).filter(Boolean);
    if (!entries.length) return;
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, files: [...g.files, ...entries] } : g));
  };

  const addNewGroup = (files = []) => {
    const entries = files.map(makeFileEntry).filter(Boolean);
    const newGroup = { id: ++groupIdRef.current, files: entries, docTypeId: '' };
    setGroups(prev => [...prev, newGroup]);
    return newGroup.id;
  };

  const handleGalleryForGroup = (groupId) => {
    galleryGroupRef.current = groupId;
    galleryRef.current?.click();
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (!files.length) return;
    const target = galleryGroupRef.current;
    galleryGroupRef.current = null;
    if (target != null) { addFilesToGroup(target, files); } else { addNewGroup(files); }
  };

  const handleMobileCamera = (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const target = webcamTargetGroup;
    setWebcamTargetGroup(null);
    if (target != null) { addFilesToGroup(target, [file]); } else { addNewGroup([file]); }
  };

  const openCamera = (groupId = null) => {
    setWebcamTargetGroup(groupId);
    if (isMobileDevice()) {
      mobileCamRef.current?.click();
    } else {
      if (!navigator.mediaDevices?.getUserMedia) { toast.error('Camera not supported in this browser.'); return; }
      setWebcamOpen(true);
    }
  };

  const handleWebcamCapture = (file) => {
    const target = webcamTargetGroup;
    if (target != null) { addFilesToGroup(target, [file]); } else { addNewGroup([file]); setWebcamOpen(false); }
  };

  const handleWebcamClose = () => { setWebcamOpen(false); setWebcamTargetGroup(null); };

  const removeFile = (groupId, fileId) => {
    setGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const f = g.files.find(f => f.id === fileId);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return { ...g, files: g.files.filter(f => f.id !== fileId) };
    }).filter(g => g.files.length > 0));
  };

  const removeGroup = (groupId) => {
    setGroups(prev => {
      const g = prev.find(g => g.id === groupId);
      g?.files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); });
      return prev.filter(g => g.id !== groupId);
    });
  };

  const setGroupType = (groupId, docTypeId) =>
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, docTypeId } : g));

  const totalFiles = groups.reduce((s, g) => s + g.files.length, 0);
  const allTypesSelected = groups.every(g => g.docTypeId);
  const canSubmit = totalFiles > 0 && allTypesSelected && patientName.trim().length > 0;

  const handleSubmit = async () => {
    if (!patientName.trim()) { toast.error('Please enter patient name'); return; }
    if (!allTypesSelected) { toast.error('Please select a document type for each group'); return; }

    const allDocs = groups.flatMap(g => g.files.map(f => ({ ...f, docTypeId: g.docTypeId })));
    setProgress({ current: 0, total: allDocs.length });

    let ok = 0;
    for (let i = 0; i < allDocs.length; i++) {
      const doc = allDocs[i];
      setProgress({ current: i + 1, total: allDocs.length });
      try {
        const fd = new FormData();
        fd.append('file', doc.file);
        fd.append('patientName', patientName.trim());
        fd.append('documentTypeId', doc.docTypeId);
        if (notes.trim()) fd.append('notes', notes.trim());
        await uploadSubmissionAPI(fd);
        ok++;
      } catch {
        toast.error(`Failed: ${doc.file.name}`);
      }
    }

    groups.forEach(g => g.files.forEach(f => { if (f.preview) URL.revokeObjectURL(f.preview); }));
    setGroups([]);
    setPatientName('');
    setNotes('');
    setProgress(null);
    setSuccessCount(ok);
  };

  const resetUpload = () => { setSuccessCount(null); };

  return (
    <>
      {webcamOpen && <WebcamModal onCapture={handleWebcamCapture} onClose={handleWebcamClose} />}
      {progress   && <ProgressOverlay current={progress.current} total={progress.total} />}

      <input ref={mobileCamRef} type="file" accept="image/*" capture="environment" onChange={handleMobileCamera} className="hidden" />
      <input ref={galleryRef} type="file" accept="image/*,application/pdf" multiple onChange={handleFileChange} className="hidden" />

      {/* Page header */}
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-gray-800">Documents</h1>
        <p className="text-sm text-gray-500 mt-1">{user?.hospital?.name || 'Your hospital'} — submit to FCC team</p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5 max-w-xs">
        <button onClick={() => setTab('upload')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'upload' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <HiOutlineCloudUpload className="w-4 h-4" /> Upload
        </button>
        <button onClick={() => setTab('list')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-all ${
            tab === 'list' ? 'bg-white text-primary-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
          <HiOutlineEye className="w-4 h-4" /> My Uploads
        </button>
      </div>

      {/* ── Upload Tab ── */}
      {tab === 'upload' && (
        <div className="max-w-lg mx-auto">

          {/* Success banner */}
          {successCount !== null && (
            <div className="bg-green-50 border border-green-200 rounded-2xl p-5 flex items-center gap-4 mb-5">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiOutlineCheckCircle className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-bold text-green-800">
                  {successCount} Document{successCount > 1 ? 's' : ''} Submitted!
                </p>
                <p className="text-xs text-green-600 mt-0.5">Our team will review them shortly.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={resetUpload}
                  className="text-xs text-green-700 font-semibold px-3 py-1.5 rounded-lg border border-green-300 hover:bg-green-100">
                  Upload More
                </button>
                <button onClick={() => { resetUpload(); setTab('list'); }}
                  className="text-xs text-white font-semibold px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700">
                  View List
                </button>
              </div>
            </div>
          )}

          {/* Step 1: Patient details */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Step 1 — Patient Details</p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Patient Name <span className="text-red-500">*</span>
                </label>
                <input
                  value={patientName}
                  onChange={e => setPatientName(e.target.value)}
                  placeholder="Full name of the patient"
                  className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Remarks <span className="text-xs text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Any notes for the FCC team"
                  className="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
          </div>

          {/* Step 2: Add documents */}
          <div className="mb-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Step 2 — Add Documents</p>

            {/* Document groups */}
            {groups.length > 0 && (
              <div className="space-y-3 mb-3">
                {groups.map((group, idx) => (
                  <DocGroup
                    key={group.id}
                    group={group}
                    index={idx}
                    docTypes={docTypes}
                    onTypeChange={setGroupType}
                    onRemoveFile={removeFile}
                    onAddFiles={handleGalleryForGroup}
                    onAddCamera={openCamera}
                    onRemoveGroup={removeGroup}
                  />
                ))}
              </div>
            )}

            {/* Add buttons — always visible */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => openCamera()}
                className="flex flex-col items-center justify-center gap-2 py-5 bg-white border-2 border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50/50 rounded-2xl text-gray-500 hover:text-primary-600 transition-all active:scale-95">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <HiOutlineCamera className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold">Camera</span>
                <span className="text-xs text-gray-400">Take photos</span>
              </button>
              <button
                onClick={() => { galleryGroupRef.current = null; galleryRef.current?.click(); }}
                className="flex flex-col items-center justify-center gap-2 py-5 bg-white border-2 border-dashed border-gray-300 hover:border-primary-400 hover:bg-primary-50/50 rounded-2xl text-gray-500 hover:text-primary-600 transition-all active:scale-95">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <HiOutlineFolderOpen className="w-5 h-5" />
                </div>
                <span className="text-sm font-semibold">Gallery / PDF</span>
                <span className="text-xs text-gray-400">Pick from device</span>
              </button>
            </div>

            {groups.length === 0 && (
              <p className="text-xs text-center text-gray-400 mt-3">
                Add photos or files, then select the document type for each
              </p>
            )}
          </div>

          {/* Step 3: Submit */}
          {groups.length > 0 && (
            <div className="mt-2 pb-4">
              <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="w-full py-4 rounded-2xl text-sm font-bold transition-all shadow-sm active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed bg-primary-600 hover:bg-primary-700 text-white"
              >
                {!patientName.trim()
                  ? 'Enter patient name to continue'
                  : !allTypesSelected
                  ? 'Select type for each document'
                  : `Submit ${totalFiles} Document${totalFiles > 1 ? 's' : ''} →`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── My Uploads Tab ── */}
      {tab === 'list' && <MyUploads />}
    </>
  );
};

export default DocumentUpload;
