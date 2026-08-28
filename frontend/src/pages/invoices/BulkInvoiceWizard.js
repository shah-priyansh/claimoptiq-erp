import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlineArrowRight,
  HiOutlineCheck, HiOutlineX, HiOutlineEye,
  HiOutlineExternalLink, HiOutlineDownload, HiOutlinePrinter,
} from 'react-icons/hi';
import JSZip from 'jszip';
import {
  previewBulkInvoiceAPI, previewDirectPatientInvoiceAPI,
  getTdsRatesAPI, getHospitalsAPI, previewInvoicePdfAPI, getInvoicePdfBlobAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { useConfirm } from '../../context/ConfirmContext';
import {
  formatINR, monthLabel, computeTotals, commitDraft, invoiceFilename,
} from './bulkInvoiceUtils';
import BulkInvoiceDraftEditor from './BulkInvoiceDraftEditor';

// Local date (not UTC) → "YYYY-MM-DD" for the Invoice Creation Date default.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Build initial draft state from a single preview group.
// Stable identity for a draft across re-previews (used to carry over the
// operator's approve/cancel + tax settings when the fixed-services toggle
// triggers a reload).
const draftKey = (d) => `${d.isDirectPatient ? 'dp' : 'reg'}|${d.hospitalId || 'nohosp'}|${new Date(d.month).toISOString()}|${(d.claimIds || [])[0] || ''}`;

const draftFromPreview = (p) => ({
  hospitalId: p.hospitalId,
  hospital: p.hospital,
  month: p.month,
  claimIds: p.claimIds,
  existingInvoice: p.existingInvoice,
  previewTotals: p.totals,
  previewLines: p.lines || [],
  editLines: (p.lines || []).map((l) => ({
    description: l.description || '',
    amount: l.amount,
    lineType: l.lineType,
    sourceHospitalName: l.meta?.sourceHospitalName || null,
    _isManual: false,
  })),
  settings: {
    gstRate: String(p.totals?.gstRate ?? 0),
    tdsRateId: '',
    notes: '',
    roundOff: 0,
    discount: 0,
    invoiceDate: todayIso(),
  },
  isDirectPatient: !!p.isDirectPatient,
  requiresHospitalPick: !!p.requiresHospitalPick,
  suggestedHospitalId: p.suggestedHospitalId || null,
  status: 'pending', // pending | approved | cancelled | success | failed
  edited: false,
  error: '',
  invoice: null,
});

const statusPill = (s) => {
  if (s === 'approved') return 'bg-green-100 text-green-700';
  if (s === 'cancelled') return 'bg-red-100 text-red-700';
  if (s === 'success') return 'bg-emerald-100 text-emerald-700';
  if (s === 'failed') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
};

const statusLabel = (s) => {
  if (s === 'approved') return 'Approved';
  if (s === 'cancelled') return 'Cancelled';
  if (s === 'success') return 'Created';
  if (s === 'failed') return 'Failed';
  return 'Pending';
};

// Mirrors backend `buildInvoiceDownloadName` — for direct-patient drafts,
// pull the patient name from the first TPA-desk line's description
// ("TPA Desk — VARSHA WAGH (CCN 0001)" → "VARSHA WAGH") so the modal header
// bills to the patient, not the reference hospital. The em-dash is the
// canonical separator; service names may themselves contain " - " (e.g.
// "TPA DESK SERVICE - REIMBURSEMENT"), so splitting on hyphen would pick
// the wrong token.
const previewTitleFor = (draft) => {
  if (!draft) return '-';
  if (!draft.isDirectPatient) return draft.hospital?.name || '-';
  const firstTpa = (draft.editLines || draft.previewLines || []).find((l) => l.lineType === 'claim_tpa_desk');
  const desc = firstTpa?.description || '';
  let afterSep = '';
  if (desc.includes('—')) {
    const parts = desc.split(/\s*—\s*/);
    afterSep = parts.slice(1).join(' — ');
  } else {
    const idx = desc.lastIndexOf(' - ');
    afterSep = idx >= 0 ? desc.slice(idx + 3) : '';
  }
  const patient = afterSep.replace(/\s*\(CCN[^)]*\)\s*$/, '').trim();
  if (patient) return patient;
  if (draft.claimIds?.length > 1) return `Direct Patients (${draft.claimIds.length})`;
  return 'Direct Patient';
};

const BulkInvoiceWizard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const claimIds = location.state?.claimIds || [];

  const [loading, setLoading] = useState(true);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [hospitals, setHospitals] = useState([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  const [resolvingDirectIdx, setResolvingDirectIdx] = useState(null);

  const [drafts, setDrafts] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState('reviewing'); // reviewing | final | generating | done
  const [generationResults, setGenerationResults] = useState([]);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationTotal, setGenerationTotal] = useState(0);
  const [bulkPdfLoading, setBulkPdfLoading] = useState(false);

  const [skipped, setSkipped] = useState([]);
  const [skippedDismissed, setSkippedDismissed] = useState(false);

  // Fixed-services toggle. Default ON (matches prior behavior). `anyFixed` gates
  // the toggle's visibility — it's only shown once a hospital in the batch is
  // found to have fixed monthly/one-time services. `reloading` covers the
  // re-preview while the operator flips the toggle.
  const [includeFixed, setIncludeFixed] = useState(true);
  const [anyFixed, setAnyFixed] = useState(false);
  const [reloading, setReloading] = useState(false);

  // PDF preview modal state
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  const handleDiscard = async () => {
    const ok = await confirm(
      'Discard this invoice batch? All draft edits, approvals, and TDS overrides on this page will be lost. No invoices have been saved.',
      { title: 'Discard Invoice Batch', confirmLabel: 'Discard', variant: 'danger' },
    );
    if (ok) navigate('/reports/claims?select=1');
  };

  // Load reference data once.
  useEffect(() => {
    getTdsRatesAPI({ active: 'true' })
      .then(({ data }) => setTdsRates(data || []))
      .catch(() => setTdsRates([]))
      .finally(() => setLoadingTdsRates(false));
    getHospitalsAPI({ all: 'true', active: 'true' })
      .then(({ data }) => {
        const list = Array.isArray(data) ? data : data.hospitals;
        setHospitals(list || []);
      })
      .catch(() => setHospitals([]))
      .finally(() => setLoadingHospitals(false));
  }, []);

  // Load (or reload) the bulk previews. `useFixed` controls whether fixed
  // monthly/one-time service lines are included. On a toggle-triggered reload
  // (`preserve`) we carry over each hospital's approve/cancel status and tax
  // settings so the operator doesn't lose their review; only the line items
  // refresh to reflect the fixed-services change.
  const loadPreviews = async (useFixed, { preserve = false } = {}) => {
    try {
      const { data } = await previewBulkInvoiceAPI({ claimIds, includeFixedServices: useFixed });
      const previews = data.previews || [];
      setSkipped(data.skipped || []);
      // Detected only when fixed lines are actually present (i.e. useFixed=true).
      // Never un-set it, so the toggle stays visible after switching OFF.
      const detected = previews.some((p) => (p.lines || []).some((l) => l.lineType === 'service_fixed'));
      setAnyFixed((prev) => prev || detected);
      if (!previews.length) {
        toast.info('No billable invoices to build from the selected claims.');
        navigate('/reports/claims?select=1');
        return;
      }
      setDrafts((prevDrafts) => {
        const byKey = preserve ? new Map(prevDrafts.map((d) => [draftKey(d), d])) : new Map();
        return previews.map((p) => {
          const fresh = draftFromPreview(p);
          const old = byKey.get(draftKey(fresh));
          return old ? { ...fresh, status: old.status, settings: { ...fresh.settings, ...old.settings } } : fresh;
        });
      });
    } catch (e) {
      const data = e.response?.data;
      const skippedCount = (data?.skipped || []).length;
      const baseMsg = data?.message || 'Failed to load previews';
      toast.error(skippedCount ? `${baseMsg} — all ${skippedCount} claim${skippedCount === 1 ? '' : 's'} were skipped (cancelled/already billed/no hospital)` : baseMsg);
      if (!preserve) navigate('/reports/claims?select=1');
    } finally {
      setLoading(false);
      setReloading(false);
    }
  };

  // Fetch previews on mount (fixed services included by default).
  useEffect(() => {
    if (!claimIds.length) {
      toast.error('No claims selected. Pick claims on the Claims Report first.');
      navigate('/reports/claims?select=1');
      return;
    }
    loadPreviews(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggleFixed = async () => {
    const next = !includeFixed;
    setIncludeFixed(next);
    setReloading(true);
    await loadPreviews(next, { preserve: true });
  };

  const current = drafts[currentIdx];
  const totalDrafts = drafts.length;
  const approvedCount = drafts.filter((d) => d.status === 'approved').length;
  const cancelledCount = drafts.filter((d) => d.status === 'cancelled').length;
  const pendingCount = drafts.filter((d) => d.status === 'pending').length;
  const allSettled = totalDrafts > 0 && pendingCount === 0;

  const approvedDrafts = useMemo(
    () => drafts.filter((d) => d.status === 'approved'),
    [drafts],
  );
  const approvedTotal = useMemo(() => approvedDrafts.reduce((s, d) => {
    const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
    const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
    return s + (t?.grandTotal || 0);
  }, 0), [approvedDrafts, tdsRates]);

  const updateDraft = (idx, mut) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...(typeof mut === 'function' ? mut(d) : mut) } : d));
  };

  const handleEditorChange = (idx) => (patch) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...patch, edited: true } : d));
  };

  const goPrev = () => setCurrentIdx((i) => Math.max(0, i - 1));
  const goNext = () => setCurrentIdx((i) => Math.min(totalDrafts - 1, i + 1));

  const approveAndAdvance = () => {
    if (current?.requiresHospitalPick) {
      toast.error('Pick a reference hospital first.');
      return;
    }
    updateDraft(currentIdx, { status: 'approved' });
    if (currentIdx < totalDrafts - 1) goNext();
  };
  const cancelAndAdvance = () => {
    updateDraft(currentIdx, { status: 'cancelled' });
    if (currentIdx < totalDrafts - 1) goNext();
  };

  // Direct-patient reference-hospital picker — mirrors the drawer's flow.
  const pickDirectPatientHospital = async (idx, hospitalId, draftOverride) => {
    if (!hospitalId) return;
    const draft = draftOverride || drafts[idx];
    if (!draft) return;
    setResolvingDirectIdx(idx);
    try {
      const monthIso = new Date(draft.month).toISOString().slice(0, 10);
      const monthArg = monthIso.slice(0, 7) + '-01';
      const { data } = await previewDirectPatientInvoiceAPI({
        hospitalId,
        month: monthArg,
        claimIds: draft.claimIds,
      });
      updateDraft(idx, {
        hospitalId: data.hospitalId,
        hospital: data.hospital,
        previewTotals: data.totals,
        previewLines: data.lines || [],
        editLines: (data.lines || []).map((l) => ({
          description: l.description || '',
          amount: l.amount,
          lineType: l.lineType,
          sourceHospitalName: l.meta?.sourceHospitalName || null,
          _isManual: false,
        })),
        settings: { ...draft.settings, gstRate: String(data.totals?.gstRate ?? 0) },
        requiresHospitalPick: false,
        edited: false,
        error: '',
      });
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load direct-patient preview');
    } finally {
      setResolvingDirectIdx(null);
    }
  };

  const openPreviewAt = async (idx) => {
    if (idx == null || idx < 0 || idx >= drafts.length) return;
    const draft = drafts[idx];
    if (draft.requiresHospitalPick) {
      toast.error('Pick a reference hospital first.');
      return;
    }
    setPreviewIdx(idx);
    setPdfError('');
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPdfLoading(true);
    try {
      const monthIso = new Date(draft.month).toISOString().slice(0, 10);
      const monthArg = monthIso.slice(0, 7) + '-01';
      const { data } = await previewInvoicePdfAPI({
        hospitalId: draft.hospitalId,
        month: monthArg,
        isDirectPatient: draft.isDirectPatient,
        claimIds: draft.claimIds,
        lines: draft.editLines.map((l) => ({
          description: l.description,
          amount: Number(l.amount) || 0,
          lineType: l.lineType,
        })),
        ...(draft.settings.gstRate !== '' ? { gstRate: Number(draft.settings.gstRate) || 0 } : {}),
        ...(draft.settings.tdsRateId ? { tdsRateId: draft.settings.tdsRateId } : {}),
        roundOff: Number(draft.settings.roundOff) || 0,
        discount: Math.max(0, Math.round(Number(draft.settings.discount) || 0)),
        notes: draft.settings.notes || '',
      });
      const url = URL.createObjectURL(data);
      setPdfBlobUrl(url);
    } catch (e) {
      setPdfError(e.response?.data?.message || 'Failed to render preview PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const closePreview = () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPreviewIdx(null);
    setPdfError('');
  };

  const printPreview = () => {
    const iframe = document.getElementById('bulk-preview-pdf-iframe');
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch {
      if (pdfBlobUrl) window.open(pdfBlobUrl, '_blank');
    }
  };

  const downloadPreview = () => {
    const draft = previewIdx != null ? drafts[previewIdx] : null;
    if (!pdfBlobUrl || !draft) return;
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `Preview - ${invoiceFilename({
      isDirectPatient: draft.isDirectPatient,
      hospitalName: draft.hospital?.name,
      month: draft.month,
      lineItems: draft.previewLines,
    })}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleGenerateAll = async () => {
    const targets = drafts
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.status === 'approved');
    if (!targets.length) {
      toast.error('No approved invoices. Approve at least one hospital.');
      return;
    }
    setPhase('generating');
    setGenerationProgress(0);
    setGenerationTotal(targets.length);
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const { d, idx } = targets[i];
      try {
        const inv = await commitDraft(d, { autoIssue: true, includeFixedServices: includeFixed });
        updateDraft(idx, { status: 'success', invoice: inv, error: '' });
        results.push({ draft: d, ok: true, invoice: inv });
      } catch (e) {
        const msg = e.response?.data?.message || e.message || 'Failed';
        updateDraft(idx, { status: 'failed', error: msg });
        results.push({ draft: d, ok: false, error: msg });
      }
      setGenerationProgress(i + 1);
    }
    setGenerationResults(results);
    setPhase('done');
    const okCount = results.filter((r) => r.ok).length;
    if (okCount === results.length) toast.success(`${okCount} invoice${okCount === 1 ? '' : 's'} created`);
    else toast.warn(`${okCount} of ${results.length} invoices created — see results`);
  };

  const handleDownloadAllPdfs = async () => {
    const okRows = generationResults.filter((r) => r.ok && r.invoice?._id);
    if (!okRows.length) {
      toast.error('No generated invoices to download.');
      return;
    }
    setBulkPdfLoading(true);
    try {
      const zip = new JSZip();
      const usedNames = new Map();
      const fetches = okRows.map(async (r) => {
        const { data: blob } = await getInvoicePdfBlobAPI(r.invoice._id);
        let name = invoiceFilename({
          isDirectPatient: r.invoice.isDirectPatient ?? r.draft.isDirectPatient,
          hospitalName: r.invoice.hospital?.name || r.draft.hospital?.name,
          month: r.invoice.month || r.draft.month,
          lineItems: r.invoice.lineItems || r.draft.previewLines,
        });
        // Guard against duplicate filenames (e.g. two direct-patient invoices
        // whose first patient names coincide) — JSZip would silently overwrite.
        const seen = usedNames.get(name) || 0;
        if (seen > 0) name = name.replace(/\.pdf$/, ` (${seen + 1}).pdf`);
        usedNames.set(name, seen + 1);
        zip.file(name, blob);
      });
      await Promise.all(fetches);
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoices-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to download invoice PDFs');
    } finally {
      setBulkPdfLoading(false);
    }
  };

  const previewDraft = previewIdx != null ? drafts[previewIdx] : null;
  const previewModal = previewDraft && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => openPreviewAt(previewIdx - 1)}
              disabled={previewIdx <= 0 || pdfLoading}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Previous draft"
            >
              <HiOutlineArrowLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => openPreviewAt(previewIdx + 1)}
              disabled={previewIdx >= drafts.length - 1 || pdfLoading}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              title="Next draft"
            >
              <HiOutlineArrowRight className="w-4 h-4" />
            </button>
            <div className="min-w-0 ml-1">
              <h3 className="text-base font-semibold text-gray-900 truncate">
                Invoice Preview — {previewTitleFor(previewDraft)}
              </h3>
              <p className="text-xs text-gray-500 truncate">
                Draft {previewIdx + 1} of {drafts.length} • {monthLabel(previewDraft.month)} • {previewDraft.claimIds.length} claim{previewDraft.claimIds.length === 1 ? '' : 's'}
                {previewDraft.isDirectPatient && previewDraft.hospital?.name ? ` • Ref: ${previewDraft.hospital.name}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={printPreview}
              disabled={!pdfBlobUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 rounded-lg"
            >
              <HiOutlinePrinter className="w-4 h-4" /> Print
            </button>
            <button
              onClick={downloadPreview}
              disabled={!pdfBlobUrl}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg"
            >
              <HiOutlineDownload className="w-4 h-4" /> Download
            </button>
            <button
              onClick={closePreview}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
              title="Close"
            >
              <HiOutlineX className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex-1 bg-gray-100 overflow-hidden">
          {pdfLoading && (
            <div className="h-full flex items-center justify-center text-gray-500 text-sm">Rendering PDF…</div>
          )}
          {pdfError && (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div>
                <p className="text-red-600 font-medium">{pdfError}</p>
                <button
                  onClick={() => openPreviewAt(previewIdx)}
                  className="mt-3 text-sm text-primary-600 hover:text-primary-700 font-medium"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          {pdfBlobUrl && !pdfLoading && !pdfError && (
            <iframe
              id="bulk-preview-pdf-iframe"
              src={pdfBlobUrl}
              title="Invoice preview"
              className="w-full h-full border-0 bg-white"
            />
          )}
        </div>
      </div>
    </div>
  );

  // Fixed-services toggle — shown once a hospital in the batch is known to have
  // fixed monthly/one-time services. Flipping it re-previews with/without them.
  const fixedToggle = anyFixed ? (
    <div className="flex items-center justify-between gap-4 p-3 mb-3 border border-primary-200 bg-primary-50/60 rounded-lg">
      <div className="text-sm">
        <p className="font-medium text-gray-800">Include fixed services</p>
        <p className="text-xs text-gray-500 mt-0.5">Monthly / one-time charges configured on the hospital. Turn off to bill claims only.</p>
      </div>
      <label className="inline-flex items-center gap-2 cursor-pointer select-none shrink-0">
        <span className="text-xs font-medium text-gray-600 w-16 text-right">{reloading ? 'Updating…' : (includeFixed ? 'Included' : 'Skipped')}</span>
        <input type="checkbox" checked={includeFixed} onChange={handleToggleFixed} disabled={reloading} className="sr-only peer" />
        <div className="relative w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-primary-600 peer-focus:ring-2 peer-focus:ring-primary-300 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5 peer-disabled:opacity-60" />
      </label>
    </div>
  ) : null;

  if (loading) {
    return <div className="py-16 text-center text-gray-500">Loading previews…</div>;
  }

  // ─── Generating phase ──────────────────────────────────────────────────────
  if (phase === 'generating') {
    const pct = generationTotal ? Math.round((generationProgress / generationTotal) * 100) : 0;
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-medium text-gray-800">Generating invoices…</p>
        <p className="text-sm text-gray-500 mt-1">{generationProgress} of {generationTotal}</p>
        <div className="max-w-md mx-auto mt-4 h-2 bg-gray-200 rounded-full overflow-hidden">
          <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  // ─── Done phase ────────────────────────────────────────────────────────────
  if (phase === 'done') {
    const okResults = generationResults.filter((r) => r.ok);
    const failResults = generationResults.filter((r) => !r.ok);
    return (
      <div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Generation Complete</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                {okResults.length} succeeded, {failResults.length} failed.
              </p>
            </div>
            {okResults.length > 0 && (
              <button
                onClick={handleDownloadAllPdfs}
                disabled={bulkPdfLoading}
                className="flex items-center gap-2 px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white rounded-lg font-medium"
              >
                <HiOutlineDownload className="w-4 h-4" />
                {bulkPdfLoading
                  ? 'Preparing ZIP…'
                  : `Download All ${okResults.length} Invoice${okResults.length === 1 ? '' : 's'} (ZIP)`}
              </button>
            )}
          </div>

          <div className="mt-5 space-y-2">
            {generationResults.map((r, i) => (
              <div
                key={i}
                className={`flex items-center justify-between p-3 rounded-lg border ${r.ok ? 'border-green-200 bg-green-50/40' : 'border-red-200 bg-red-50/40'}`}
              >
                <div>
                  <p className="font-medium text-gray-800">{r.draft.hospital?.name || '-'}</p>
                  <p className="text-xs text-gray-500">{monthLabel(r.draft.month)} • {r.draft.claimIds.length} claim{r.draft.claimIds.length === 1 ? '' : 's'}</p>
                  {!r.ok && <p className="text-xs text-red-600 mt-1">{r.error}</p>}
                </div>
                <div className="flex items-center gap-3">
                  {r.ok ? (
                    <>
                      <span className="text-sm font-medium text-green-700">{r.invoice.invoiceNumber || `Draft-${(r.invoice._id || '').slice(0, 8)}`}</span>
                      <button
                        onClick={() => navigate(`/invoices/${r.invoice._id}`)}
                        className="text-primary-600 hover:text-primary-700 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <HiOutlineExternalLink className="w-4 h-4" /> Open
                      </button>
                    </>
                  ) : (
                    <span className="text-sm font-medium text-red-700">Failed</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-end gap-3 mt-5">
            <button
              onClick={() => navigate('/invoices')}
              className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg"
            >
              Go to Invoices
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Final review phase ────────────────────────────────────────────────────
  if (phase === 'final') {
    return (
      <>
      {previewModal}
      <div>
        <button onClick={() => setPhase('reviewing')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-3">
          <HiOutlineArrowLeft className="w-4 h-4" /> Back to drafts
        </button>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-gray-800">Review &amp; Generate</h1>
              <p className="text-sm text-gray-500 mt-0.5">Confirm the approved invoices below, then generate.</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Approved total</p>
              <p className="text-2xl font-bold text-gray-900 tabular-nums">{formatINR(approvedTotal)}</p>
            </div>
          </div>

          <div className="mt-4">{fixedToggle}</div>

          <div className="mt-5 overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Hospital</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Month</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Claims</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Lines</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Grand Total</th>
                  <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {drafts.map((d, idx) => {
                  const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
                  const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
                  return (
                    <tr key={`${d.hospitalId || 'direct'}-${d.month}-${idx}`} className="hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-800">{d.hospital?.name || '-'}</td>
                      <td className="py-3 px-4 text-gray-600">{monthLabel(d.month)}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{d.claimIds.length}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{d.editLines.length}</td>
                      <td className="py-3 px-4 text-right font-medium text-gray-800 tabular-nums">{formatINR(t?.grandTotal || 0)}</td>
                      <td className="py-3 px-4 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${statusPill(d.status)}`}>
                          {statusLabel(d.status)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openPreviewAt(idx)}
                            className="text-primary-600 hover:text-primary-700 text-xs font-medium inline-flex items-center gap-1"
                            title="Preview PDF"
                          >
                            <HiOutlineEye className="w-4 h-4" /> Preview
                          </button>
                          <button
                            onClick={() => { setCurrentIdx(idx); setPhase('reviewing'); }}
                            className="text-gray-500 hover:text-gray-700 text-xs font-medium"
                            title="Edit lines"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-3 mt-5">
            <button
              onClick={handleDiscard}
              className="px-4 py-2.5 text-sm border border-red-300 rounded-lg text-red-700 hover:bg-red-50 font-medium"
            >
              Discard Invoice
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={!approvedDrafts.length}
              className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              Generate {approvedDrafts.length} Invoice{approvedDrafts.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
      </>
    );
  }

  // ─── Reviewing phase (hospital-wise tabs) ─────────────────────────────────
  const needsPick = current?.isDirectPatient && current?.requiresHospitalPick;

  const overrideTds = current?.settings.tdsRateId ? tdsRates.find((r) => r._id === current.settings.tdsRateId) : null;
  const currentTotals = current ? computeTotals(current.editLines, current.settings, current.previewTotals, overrideTds) : null;

  return (
    <>
    {previewModal}
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={handleDiscard} className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium">
          <HiOutlineArrowLeft className="w-4 h-4" /> Discard Invoice
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Hospital {currentIdx + 1} of {totalDrafts}</span>
          <span className="text-gray-300">|</span>
          <span className="text-green-700 font-medium">{approvedCount} approved</span>
          <span className="text-gray-300">|</span>
          <span className="text-red-700 font-medium">{cancelledCount} cancelled</span>
          {pendingCount > 0 && (
            <>
              <span className="text-gray-300">|</span>
              <span className="text-amber-700 font-medium">{pendingCount} pending</span>
            </>
          )}
        </div>
      </div>

      {/* Skipped-claims banner */}
      {skipped.length > 0 && !skippedDismissed && (
        <div className="flex items-start gap-3 p-3 mb-3 border border-amber-200 bg-amber-50 rounded-lg">
          <div className="flex-1 text-sm text-amber-900">
            <p className="font-medium">
              {skipped.length} of {skipped.length + drafts.reduce((n, d) => n + d.claimIds.length, 0)} selected claim{skipped.length === 1 ? ' was' : 's were'} skipped
            </p>
            <p className="text-xs text-amber-800 mt-1">
              {skipped.slice(0, 6).map((s) => `#${s.srNo || ''} ${s.patientName || '-'} (${s.reason})`).join(', ')}
              {skipped.length > 6 ? `, and ${skipped.length - 6} more` : ''}
            </p>
          </div>
          <button
            onClick={() => setSkippedDismissed(true)}
            className="p-1 text-amber-700 hover:bg-amber-100 rounded"
            title="Dismiss"
          >
            <HiOutlineX className="w-4 h-4" />
          </button>
        </div>
      )}

      {fixedToggle}

      {/* Hospital tabs */}
      <div className="border-b border-gray-200 mb-4 -mx-1 px-1 overflow-x-auto">
        <div className="flex items-end gap-1 min-w-max">
          {drafts.map((d, i) => {
            const isActive = i === currentIdx;
            const tabName = d.isDirectPatient
              ? (d.hospital?.name ? `${d.hospital.name} (Direct)` : 'Direct Patients')
              : (d.hospital?.name || `Hospital ${i + 1}`);
            return (
              <button
                key={`${d.hospitalId || 'direct'}-${d.month}-${i}`}
                onClick={() => setCurrentIdx(i)}
                className={`shrink-0 max-w-xs flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-700 bg-primary-50/40'
                    : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
                title={tabName}
              >
                <span className="truncate">{tabName}</span>
                <span className={`shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${statusPill(d.status)}`}>
                  {statusLabel(d.status)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-800 truncate">
              {current.isDirectPatient
                ? (current.hospital?.name
                    ? `${current.hospital.name} (Direct Patients — reference)`
                    : 'Direct Patients')
                : (current.hospital?.name || '-')}
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {monthLabel(current.month)} • {current.claimIds.length} claim{current.claimIds.length === 1 ? '' : 's'} selected
              {currentTotals?.grandTotal ? <> • <span className="tabular-nums text-gray-700 font-medium">{formatINR(currentTotals.grandTotal)}</span></> : null}
            </p>
            {current.isDirectPatient && !needsPick && (
              <p className="text-xs text-purple-800 mt-2 inline-flex items-center gap-1 bg-purple-50 px-2 py-1 rounded">
                Add services + rates manually in the editor below — no slab charges are auto-applied.
              </p>
            )}
            {current.existingInvoice && (
              <p className="text-xs text-amber-700 mt-2 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded">
                Existing {current.existingInvoice.status} invoice {current.existingInvoice.invoiceNumber || ''} —{' '}
                <Link
                  to={`/invoices/${current.existingInvoice._id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-amber-900"
                >
                  view existing
                </Link>
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => openPreviewAt(currentIdx)}
              disabled={needsPick}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-white border border-primary-600 hover:bg-primary-50 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg"
              title={needsPick ? 'Pick a reference hospital first' : 'Preview this draft as the final PDF'}
            >
              <HiOutlineEye className="w-4 h-4" /> Preview
            </button>
            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusPill(current.status)}`}>
              {statusLabel(current.status)}
            </span>
          </div>
        </div>

        {needsPick ? (
          <div className="mt-5 border-t border-purple-100 pt-4">
            <label className="block text-xs font-semibold text-purple-900 uppercase tracking-wide mb-1.5">
              Reference hospital for this invoice
            </label>
            <p className="text-[11px] text-purple-800 mb-2">
              Used only for the invoice template (GST/TDS defaults, number prefix). No slab charges will be applied — enter services + rates manually.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 max-w-md">
                <SearchableSelect
                  isLoading={loadingHospitals || resolvingDirectIdx === currentIdx}
                  value={current.hospitalId || ''}
                  onChange={(val) => pickDirectPatientHospital(currentIdx, val)}
                  placeholder="Select hospital"
                  searchPlaceholder="Search hospitals..."
                  options={hospitals.map((h) => ({ value: h._id, label: h.name }))}
                />
              </div>
              {resolvingDirectIdx === currentIdx && (
                <span className="text-xs text-purple-700">Loading…</span>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <BulkInvoiceDraftEditor
              draft={current}
              tdsRates={tdsRates}
              loadingTdsRates={loadingTdsRates}
              onChange={handleEditorChange(currentIdx)}
            />
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
          >
            <HiOutlineArrowLeft className="w-4 h-4" /> Previous
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={cancelAndAdvance}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-red-300 rounded-lg text-red-700 hover:bg-red-50 font-medium"
            >
              <HiOutlineX className="w-4 h-4" /> Cancel
            </button>
            <button
              onClick={approveAndAdvance}
              disabled={needsPick}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              <HiOutlineCheck className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={goNext}
              disabled={currentIdx === totalDrafts - 1}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              Next <HiOutlineArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Generate All CTA — appears once every hospital has been settled */}
      {allSettled && (
        <div className="mt-4 flex items-center justify-between gap-4 p-4 bg-white border border-primary-200 rounded-xl">
          <div className="text-sm text-gray-700">
            <p className="font-semibold text-gray-900">
              All {totalDrafts} hospital{totalDrafts === 1 ? '' : 's'} reviewed
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              <span className="text-green-700 font-medium">{approvedCount} approved</span>
              {' • '}
              <span className="text-red-700 font-medium">{cancelledCount} cancelled</span>
              {approvedDrafts.length > 0 && (
                <> • <span className="tabular-nums font-semibold text-gray-900">{formatINR(approvedTotal)}</span> total</>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPhase('final')}
              disabled={!approvedDrafts.length}
              className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              Review All
            </button>
            <button
              onClick={handleGenerateAll}
              disabled={!approvedDrafts.length}
              className="px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium"
            >
              Generate All ({approvedDrafts.length})
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default BulkInvoiceWizard;
