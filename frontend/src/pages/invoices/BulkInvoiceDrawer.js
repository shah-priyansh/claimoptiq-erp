import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineX, HiOutlineEye, HiOutlinePrinter, HiOutlineDownload,
  HiOutlineArrowLeft, HiOutlineArrowRight, HiChevronDown, HiChevronRight,
} from 'react-icons/hi';
import {
  previewBulkInvoiceAPI, previewDirectPatientInvoiceAPI,
  getTdsRatesAPI, getHospitalsAPI, previewInvoicePdfAPI,
} from '../../services/api';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { useConfirm } from '../../context/ConfirmContext';
import {
  formatINR, monthLabel, computeTotals, commitDraft,
} from './bulkInvoiceUtils';
import BulkInvoiceDraftEditor from './BulkInvoiceDraftEditor';

// Build initial draft state from a single preview group. Mirrors the shape
// the editor + commitDraft expect, with the drawer-only `approved` / `edited`
// / `status` fields tacked on.
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
    _isManual: false,
  })),
  settings: {
    gstRate: String(p.totals?.gstRate ?? 0),
    tdsRateId: '',
    notes: '',
    roundOff: 0,
    discount: 0,
  },
  // Direct-patient cards start unticked + with no lines/totals until the
  // operator picks a target hospital. The drawer renders a chooser then
  // POSTs /invoices/preview-direct-patient to fill in `editLines`, totals,
  // etc., and flip `requiresHospitalPick: false`. `suggestedHospitalId`
  // comes from the backend when every claim in the bucket already shares
  // a hospitalId — the drawer auto-resolves with it.
  isDirectPatient: !!p.isDirectPatient,
  requiresHospitalPick: !!p.requiresHospitalPick,
  suggestedHospitalId: p.suggestedHospitalId || null,
  approved: !p.existingInvoice && !p.requiresHospitalPick,
  edited: false,
  status: 'pending',
  error: '',
  invoice: null,
});

const BulkInvoiceDrawer = ({ open, claimIds, suggestedHospitalId, onClose, onGenerated }) => {
  const confirm = useConfirm();

  const [phase, setPhase] = useState('loading'); // loading | reviewing | generating | empty
  const [drafts, setDrafts] = useState([]);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  // Hospitals are only needed when the selection contains direct-patient
  // claims, but loading them lazily would mean a second spinner mid-flow.
  // The list is small (~few dozen rows) so we pre-load on first open.
  const [hospitals, setHospitals] = useState([]);
  const [loadingHospitals, setLoadingHospitals] = useState(true);
  // Per-card spinner for the direct-patient preview fetch.
  const [resolvingDirectIdx, setResolvingDirectIdx] = useState(null);
  const [skipped, setSkipped] = useState([]);
  const [skippedDismissed, setSkippedDismissed] = useState(false);
  const [expanded, setExpanded] = useState({}); // { [draftIdx]: bool }
  const [progress, setProgress] = useState(0);
  // Snapshot of how many invoices the current generate run is committing.
  // Without this the denominator would be `approvedDrafts.length`, which
  // shrinks as drafts get marked status='success' — pushing the bar to
  // "4 of 1 / 400%" mid-run.
  const [progressTotal, setProgressTotal] = useState(0);

  // PDF preview modal state — same pattern as the legacy wizard.
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Reset drawer state every time it opens.
  useEffect(() => {
    if (!open) return;
    setPhase('loading');
    setDrafts([]);
    setSkipped([]);
    setSkippedDismissed(false);
    setExpanded({});
    setProgress(0);
    setProgressTotal(0);
    setPreviewIdx(null);
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPdfError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Load TDS rates and hospitals once.
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

  // Fetch previews when the drawer opens with a non-empty claim list.
  useEffect(() => {
    if (!open || !claimIds?.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await previewBulkInvoiceAPI({ claimIds });
        if (cancelled) return;
        const previews = data.previews || [];
        setSkipped(data.skipped || []);
        if (!previews.length) {
          setPhase('empty');
          return;
        }
        const initialDrafts = previews.map(draftFromPreview);
        setDrafts(initialDrafts);
        setPhase('reviewing');
        // If the caller passed a suggestedHospitalId (typically the Reports
        // page's active hospital filter), auto-resolve every direct-patient
        // card against it so the operator doesn't have to repeat the pick.
        // Prefer the per-group suggestion the backend returned (when all
        // claims in the bucket already share a hospitalId), and fall back
        // to the page-level filter the caller passed in.
        initialDrafts.forEach((d, idx) => {
          if (!d.requiresHospitalPick) return;
          const auto = d.suggestedHospitalId || suggestedHospitalId;
          if (auto) pickDirectPatientHospital(idx, auto, d);
        });
      } catch (e) {
        if (cancelled) return;
        // The backend returns 400 + { skipped: [...] } when every selected
        // claim is unbillable (rejected, cancelled, already billed, missing
        // discharge date). Surface those reasons in the empty phase instead
        // of closing the drawer with a generic toast.
        const errSkipped = e.response?.data?.skipped;
        if (Array.isArray(errSkipped) && errSkipped.length) {
          setSkipped(errSkipped);
          setPhase('empty');
          return;
        }
        const baseMsg = e.response?.data?.message || 'Failed to load previews';
        toast.error(baseMsg);
        onClose();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, claimIds]);

  const approvedDrafts = useMemo(
    () => drafts.filter((d) => d.approved && d.status !== 'success' && !d.requiresHospitalPick),
    [drafts],
  );
  const approvedTotal = useMemo(() => approvedDrafts.reduce((s, d) => {
    const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
    const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
    return s + (t?.grandTotal || 0);
  }, 0), [approvedDrafts, tdsRates]);

  const hasEdits = drafts.some((d) => d.edited);

  const updateDraft = (idx, patch) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...patch } : d));
  };

  // Patch handler for the editor — also flips `edited: true` so the discard
  // guard knows the user has touched something.
  const handleEditorChange = (idx) => (patch) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...patch, edited: true } : d));
  };

  const toggleExpanded = (idx) =>
    setExpanded((s) => ({ ...s, [idx]: !s[idx] }));

  const toggleApproved = (idx) =>
    updateDraft(idx, { approved: !drafts[idx].approved });

  // Operator picked a target hospital for a direct-patient card. Fetch the
  // real preview lines/totals from the backend and merge them into the draft.
  // Auto-approves the card on success so it's queued for the batch generate.
  // Accepts an optional `draftOverride` for the auto-resolve flow that fires
  // right after `setDrafts(initialDrafts)` — at that moment the `drafts`
  // closure still sees the old (empty) array.
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
          _isManual: false,
        })),
        settings: { ...draft.settings, gstRate: String(data.totals?.gstRate ?? 0) },
        requiresHospitalPick: false,
        approved: true,
        edited: false,
        error: '',
      });
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to load direct-patient preview');
    } finally {
      setResolvingDirectIdx(null);
    }
  };

  const handleClose = async () => {
    if (phase === 'generating') return;
    if (hasEdits && phase === 'reviewing') {
      const ok = await confirm(
        `Discard unsaved edits on ${drafts.filter((d) => d.edited).length} draft(s)? Approvals and line changes will be lost.`,
        { title: 'Discard Drafts', confirmLabel: 'Discard', variant: 'danger' },
      );
      if (!ok) return;
    }
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    onClose();
  };

  const handleGenerate = async () => {
    const targets = drafts
      .map((d, idx) => ({ d, idx }))
      .filter(({ d }) => d.approved && d.status !== 'success');
    if (!targets.length) {
      toast.error('No invoices to generate. Tick at least one card.');
      return;
    }
    setPhase('generating');
    setProgress(0);
    setProgressTotal(targets.length);
    let allOk = true;
    const results = [];
    for (let i = 0; i < targets.length; i++) {
      const { d, idx } = targets[i];
      try {
        // autoIssue: bulk generate goes straight to "issued" so operators
        // don't have to open each draft afterward and click Issue.
        const inv = await commitDraft(d, { autoIssue: true });
        updateDraft(idx, { status: 'success', invoice: inv, error: '' });
        results.push({ ok: true, invoice: inv });
      } catch (e) {
        const msg = e.response?.data?.message || e.message || 'Failed';
        updateDraft(idx, { status: 'failed', error: msg });
        results.push({ ok: false, error: msg });
        allOk = false;
      }
      setProgress(i + 1);
    }
    if (allOk) {
      toast.success(`${results.length} invoice${results.length === 1 ? '' : 's'} created`);
      if (onGenerated) onGenerated(results);
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      onClose();
      return;
    }
    setPhase('reviewing');
    const okCount = results.filter((r) => r.ok).length;
    toast.warn(`${okCount} of ${results.length} invoices created — fix the failed ones and retry.`);
  };

  const openPreviewAt = async (idx) => {
    if (idx == null || idx < 0 || idx >= drafts.length) return;
    setPreviewIdx(idx);
    setPdfError('');
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPdfLoading(true);
    const draft = drafts[idx];
    try {
      const monthIso = new Date(draft.month).toISOString().slice(0, 10);
      const monthArg = monthIso.slice(0, 7) + '-01';
      const { data } = await previewInvoicePdfAPI({
        hospitalId: draft.hospitalId,
        month: monthArg,
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
    const iframe = document.getElementById('drawer-preview-pdf-iframe');
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
    const safe = (draft.hospital?.name || 'invoice').replace(/[^a-zA-Z0-9]+/g, '_');
    const a = document.createElement('a');
    a.href = pdfBlobUrl;
    a.download = `Preview-${safe}-${monthLabel(draft.month).replace(/\s+/g, '-')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  if (!open) return null;

  const previewDraft = previewIdx != null ? drafts[previewIdx] : null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40" onClick={handleClose} />

      {/* Slide-over panel */}
      <div className="fixed inset-y-0 right-0 z-40 w-full max-w-3xl bg-white shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">
              {phase === 'reviewing'
                ? `Generate ${approvedDrafts.length} Invoice${approvedDrafts.length === 1 ? '' : 's'}`
                : phase === 'generating'
                  ? 'Generating Invoices…'
                  : phase === 'empty'
                    ? 'Nothing to bill'
                    : 'Loading previews…'}
            </h2>
            {phase === 'reviewing' && drafts.length > 0 && (
              <p className="text-xs text-gray-500 mt-0.5">
                {drafts.length} hospital{drafts.length === 1 ? '' : 's'} • tick to include, expand to edit
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={phase === 'generating'}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Close"
          >
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {phase === 'loading' && (
            <div className="py-16 text-center text-gray-500 text-sm">Loading previews…</div>
          )}

          {phase === 'empty' && (
            <div className="py-8">
              <div className="text-center mb-5">
                <p className="text-gray-800 font-semibold">No billable invoices.</p>
                <p className="text-sm text-gray-500 mt-1">
                  All {skipped.length} selected claim{skipped.length === 1 ? ' was' : 's were'} skipped.
                  Fix the issues below and try again.
                </p>
              </div>
              <div className="border border-amber-200 bg-amber-50/40 rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-amber-100/60 text-amber-900">
                    <tr>
                      <th className="text-left py-2 px-3 text-xs font-semibold uppercase">SR</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold uppercase">Patient</th>
                      <th className="text-left py-2 px-3 text-xs font-semibold uppercase">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {skipped.map((s, i) => (
                      <tr key={s.id || i} className="hover:bg-amber-50">
                        <td className="py-2 px-3 text-amber-900 tabular-nums">{s.srNo || '-'}</td>
                        <td className="py-2 px-3 text-amber-900">{s.patientName || '-'}</td>
                        <td className="py-2 px-3 text-amber-800 capitalize">{s.reason || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(phase === 'reviewing' || phase === 'generating') && (
            <>
              {/* Skipped banner */}
              {skipped.length > 0 && !skippedDismissed && (
                <div className="flex items-start gap-3 p-3 mb-3 border border-amber-200 bg-amber-50 rounded-lg">
                  <div className="flex-1 text-sm text-amber-900">
                    <p className="font-medium">
                      {skipped.length} claim{skipped.length === 1 ? '' : 's'} skipped
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

              {/* Generating progress bar */}
              {phase === 'generating' && (
                <div className="mb-4">
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>{progress} of {progressTotal}</span>
                    <span>
                      {progressTotal ? Math.round((progress / progressTotal) * 100) : 0}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-600 transition-all"
                      style={{ width: `${progressTotal ? (progress / progressTotal) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Cards */}
              <div className="space-y-3">
                {drafts.map((d, idx) => {
                  const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
                  const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
                  const isExpanded = !!expanded[idx];
                  const claimCount = d.claimIds.length;
                  const disabled = phase === 'generating' || d.status === 'success';
                  const needsPick = d.isDirectPatient && d.requiresHospitalPick;
                  const cardLabel = d.isDirectPatient
                    ? (d.hospital?.name
                        ? `${d.hospital.name} (Direct Patients)`
                        : 'Direct Patients')
                    : (d.hospital?.name || '-');
                  return (
                    <div
                      key={`${d.hospitalId || 'direct'}-${d.month}-${idx}`}
                      className={`rounded-xl border ${
                        d.status === 'success' ? 'border-green-200 bg-green-50/30' :
                        d.status === 'failed' ? 'border-red-200 bg-red-50/30' :
                        needsPick ? 'border-purple-200 bg-purple-50/30' :
                        d.approved ? 'border-primary-200 bg-white' :
                        'border-gray-200 bg-gray-50/40'
                      }`}
                    >
                      <div className="flex items-start gap-3 p-4">
                        <input
                          type="checkbox"
                          checked={d.approved}
                          onChange={() => toggleApproved(idx)}
                          disabled={disabled || needsPick}
                          title={needsPick ? 'Pick a target hospital first' : ''}
                          className="mt-1 rounded border-gray-300 text-primary-600 focus:ring-primary-500 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-gray-900 truncate">{cardLabel}</h3>
                            <span className="text-sm text-gray-500">— {monthLabel(d.month)}</span>
                            {d.isDirectPatient && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">direct patient</span>
                            )}
                            {d.edited && d.status === 'pending' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">edited</span>
                            )}
                            {d.status === 'success' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">
                                created {d.invoice?.invoiceNumber || ''}
                              </span>
                            )}
                            {d.status === 'failed' && (
                              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-red-100 text-red-700">failed</span>
                            )}
                          </div>
                          <p className="text-sm text-gray-600 mt-1 tabular-nums">
                            {claimCount} claim{claimCount === 1 ? '' : 's'} · {formatINR(t?.grandTotal || 0)}
                            {t?.effectiveGst > 0 && <> · GST {t.effectiveGst}%</>}
                            {t?.tdsRate > 0 && <> · TDS {t.tdsRate}%</>}
                          </p>
                          {d.existingInvoice && (
                            <p className="text-xs text-amber-800 mt-2 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded">
                              Existing {d.existingInvoice.status} invoice {d.existingInvoice.invoiceNumber || ''} —{' '}
                              <Link
                                to={`/invoices/${d.existingInvoice._id}`}
                                target="_blank"
                                rel="noreferrer"
                                className="underline hover:text-amber-900"
                              >
                                view existing
                              </Link>
                            </p>
                          )}
                          {d.status === 'failed' && (
                            <p className="text-xs text-red-700 mt-2">{d.error}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openPreviewAt(idx)}
                            disabled={disabled || needsPick}
                            className="p-1.5 text-gray-500 hover:text-primary-700 hover:bg-primary-50 rounded-lg disabled:opacity-40"
                            title={needsPick ? 'Pick a target hospital first' : 'Preview PDF'}
                          >
                            <HiOutlineEye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => toggleExpanded(idx)}
                            disabled={disabled || needsPick}
                            className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg disabled:opacity-40"
                            title={needsPick ? 'Pick a target hospital first' : (isExpanded ? 'Collapse' : 'Edit')}
                          >
                            {isExpanded
                              ? <HiChevronDown className="w-4 h-4" />
                              : <HiChevronRight className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {needsPick && (
                        <div className="border-t border-purple-100 px-4 py-3 bg-purple-50/30">
                          <label className="block text-xs font-semibold text-purple-900 uppercase tracking-wide mb-1.5">
                            Bill these direct-patient claims under
                          </label>
                          <div className="flex items-center gap-2">
                            <div className="flex-1">
                              <SearchableSelect
                                isLoading={loadingHospitals || resolvingDirectIdx === idx}
                                value={d.hospitalId || ''}
                                onChange={(val) => pickDirectPatientHospital(idx, val)}
                                placeholder="Select hospital"
                                searchPlaceholder="Search hospitals..."
                                options={hospitals.map((h) => ({ value: h._id, label: h.name }))}
                              />
                            </div>
                            {resolvingDirectIdx === idx && (
                              <span className="text-xs text-purple-700">Loading preview…</span>
                            )}
                          </div>
                        </div>
                      )}

                      {isExpanded && !needsPick && (
                        <div className="border-t border-gray-100 px-4 pt-4 pb-4">
                          <BulkInvoiceDraftEditor
                            draft={d}
                            tdsRates={tdsRates}
                            loadingTdsRates={loadingTdsRates}
                            onChange={handleEditorChange(idx)}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {phase !== 'loading' && (
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-gray-200 shrink-0 bg-white">
            {phase === 'empty' ? (
              <button
                onClick={handleClose}
                className="ml-auto px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
              >
                Close
              </button>
            ) : (
              <>
                <div className="text-sm text-gray-600">
                  <span className="font-semibold text-gray-900 tabular-nums">{formatINR(approvedTotal)}</span>
                  {' '}across {approvedDrafts.length} invoice{approvedDrafts.length === 1 ? '' : 's'}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleClose}
                    disabled={phase === 'generating'}
                    className="px-4 py-2.5 text-sm border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 disabled:opacity-40 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={phase === 'generating' || approvedDrafts.length === 0}
                    className="px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium"
                  >
                    {phase === 'generating'
                      ? `Generating ${progress}/${progressTotal}…`
                      : `Generate ${approvedDrafts.length} Invoice${approvedDrafts.length === 1 ? '' : 's'}`}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* PDF preview modal */}
      {previewDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col" style={{ height: '90vh' }}>
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => openPreviewAt(previewIdx - 1)}
                  disabled={previewIdx <= 0 || pdfLoading}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Previous"
                >
                  <HiOutlineArrowLeft className="w-4 h-4" />
                </button>
                <button
                  onClick={() => openPreviewAt(previewIdx + 1)}
                  disabled={previewIdx >= drafts.length - 1 || pdfLoading}
                  className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                  title="Next"
                >
                  <HiOutlineArrowRight className="w-4 h-4" />
                </button>
                <div className="min-w-0 ml-1">
                  <h3 className="text-base font-semibold text-gray-900 truncate">
                    Invoice Preview — {previewDraft.hospital?.name}
                  </h3>
                  <p className="text-xs text-gray-500 truncate">
                    Draft {previewIdx + 1} of {drafts.length} • {monthLabel(previewDraft.month)} • {previewDraft.claimIds.length} claim{previewDraft.claimIds.length === 1 ? '' : 's'}
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
                  id="drawer-preview-pdf-iframe"
                  src={pdfBlobUrl}
                  title="Invoice preview"
                  className="w-full h-full border-0 bg-white"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default BulkInvoiceDrawer;
