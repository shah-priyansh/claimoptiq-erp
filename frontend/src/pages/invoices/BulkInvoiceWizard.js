import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
  HiOutlineArrowLeft, HiOutlineArrowRight,
  HiOutlineCheck, HiOutlineX, HiOutlineEye,
  HiOutlineExternalLink, HiOutlineDownload, HiOutlinePrinter,
} from 'react-icons/hi';
import {
  previewBulkInvoiceAPI, getTdsRatesAPI, previewInvoicePdfAPI,
} from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import {
  formatINR, monthLabel, computeTotals, commitDraft,
} from './bulkInvoiceUtils';
import BulkInvoiceDraftEditor from './BulkInvoiceDraftEditor';

const BulkInvoiceWizard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const claimIds = location.state?.claimIds || [];

  // Confirm before walking away — the wizard holds unsaved edits per draft
  // and previously a stray click on "Cancel" would silently drop everything.
  const handleDiscard = async () => {
    const ok = await confirm(
      'Discard this invoice batch? All draft edits, approvals, and TDS overrides on this page will be lost. No invoices have been saved.',
      { title: 'Discard Invoice Batch', confirmLabel: 'Discard', variant: 'danger' },
    );
    if (ok) navigate('/reports/claims');
  };

  const [loading, setLoading] = useState(true);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);
  const [drafts, setDrafts] = useState([]); // each draft has its own editLines/settings/status
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState('reviewing'); // reviewing | final | generating | done
  const [generationResults, setGenerationResults] = useState([]);
  const [generationProgress, setGenerationProgress] = useState(0);
  // Claims dropped by the backend (rejected/cancelled/already-billed/no
  // discharge date). Surfaced as a dismissible banner so the operator knows
  // why the count shrank between selection and the wizard.
  const [skipped, setSkipped] = useState([]);
  const [skippedDismissed, setSkippedDismissed] = useState(false);
  // PDF preview modal — fetches the real renderInvoicePdf output for an
  // unsaved draft so the operator confirms the exact print layout before
  // committing. `previewIdx` is the index into `drafts` of the draft being
  // previewed (or null = modal closed).
  const [previewIdx, setPreviewIdx] = useState(null);
  const [pdfBlobUrl, setPdfBlobUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');

  // Load active TDS master rows once so the per-draft picker can offer them.
  useEffect(() => {
    getTdsRatesAPI({ active: 'true' })
      .then(({ data }) => setTdsRates(data || []))
      .catch(() => setTdsRates([]))
      .finally(() => setLoadingTdsRates(false));
  }, []);

  // Fetch all per-hospital previews on mount.
  useEffect(() => {
    if (!claimIds.length) {
      toast.error('No claims selected. Pick claims on the Claims Report first.');
      navigate('/reports/claims');
      return;
    }
    (async () => {
      try {
        const { data } = await previewBulkInvoiceAPI({ claimIds });
        const previews = data.previews || [];
        setSkipped(data.skipped || []);
        if (!previews.length) {
          toast.info('No billable invoices to build from the selected claims.');
          navigate('/reports/claims');
          return;
        }
        const drafted = previews.map((p) => ({
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
            tdsRateId: '', // '' = use the rate that came back with the preview (hospital default)
            notes: '',
            roundOff: 0,
            discount: 0,
          },
          status: 'pending', // pending | approved | rejected
        }));
        setDrafts(drafted);
      } catch (e) {
        const data = e.response?.data;
        const skippedCount = (data?.skipped || []).length;
        const baseMsg = data?.message || 'Failed to load previews';
        toast.error(skippedCount ? `${baseMsg} — all ${skippedCount} claim${skippedCount === 1 ? '' : 's'} were skipped (cancelled/already billed/no hospital)` : baseMsg);
        navigate('/reports/claims');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = drafts[currentIdx];
  const totalDrafts = drafts.length;
  const approvedCount = drafts.filter((d) => d.status === 'approved').length;
  const rejectedCount = drafts.filter((d) => d.status === 'rejected').length;
  const pendingCount = drafts.filter((d) => d.status === 'pending').length;

  const updateDraft = (idx, mut) => {
    setDrafts((arr) => arr.map((d, i) => i === idx ? { ...d, ...(typeof mut === 'function' ? mut(d) : mut) } : d));
  };

  const setStatus = (status) => updateDraft(currentIdx, { status });

  const approveAndNext = () => {
    setStatus('approved');
    goNext();
  };
  const rejectAndNext = () => {
    setStatus('rejected');
    goNext();
  };

  const goPrev = () => setCurrentIdx((i) => Math.max(0, i - 1));
  const goNext = () => {
    if (currentIdx < totalDrafts - 1) {
      setCurrentIdx((i) => i + 1);
    } else {
      // "Review All" → switch to the review table AND auto-open the PDF
      // preview for the first draft so the operator immediately sees the
      // final layout and can step through every draft via the modal's
      // Prev/Next arrows.
      setPhase('final');
      openPreviewAt(0);
    }
  };

  // Open the PDF preview modal for a draft. Sends the current edit state to
  // the backend's `previewPdf` endpoint and renders the binary in an iframe.
  const openPreviewAt = async (idx) => {
    if (idx == null || idx < 0 || idx >= drafts.length) return;
    setPreviewIdx(idx);
    setPdfError('');
    // Revoke any prior blob so we don't leak object URLs as the user
    // walks through drafts.
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

  // Backwards-compatible helper — find the draft's index and delegate.
  const openPreview = (draft) => {
    const idx = drafts.findIndex((d) => d === draft);
    openPreviewAt(idx >= 0 ? idx : 0);
  };

  const closePreview = () => {
    if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    setPdfBlobUrl(null);
    setPreviewIdx(null);
    setPdfError('');
  };

  const printPreview = () => {
    // Most browsers expose `print()` on a same-origin iframe; the blob URL is
    // same-origin so this works without a popup.
    const iframe = document.getElementById('bulk-preview-pdf-iframe');
    try {
      iframe?.contentWindow?.focus();
      iframe?.contentWindow?.print();
    } catch {
      // Fallback: open in new tab so the user can hit Cmd+P themselves.
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

  const handleGenerateAll = async () => {
    const approved = drafts.filter((d) => d.status === 'approved');
    if (!approved.length) {
      toast.error('No approved invoices. Approve at least one.');
      return;
    }
    setPhase('generating');
    setGenerationProgress(0);
    const results = [];
    for (let i = 0; i < approved.length; i++) {
      try {
        const inv = await commitDraft(approved[i]);
        results.push({ draft: approved[i], ok: true, invoice: inv });
      } catch (e) {
        results.push({ draft: approved[i], ok: false, error: e.response?.data?.message || e.message || 'Failed' });
      }
      setGenerationProgress(i + 1);
    }
    setGenerationResults(results);
    setPhase('done');
    const okCount = results.filter((r) => r.ok).length;
    if (okCount === results.length) toast.success(`${okCount} invoice${okCount === 1 ? '' : 's'} created`);
    else toast.warn(`${okCount} of ${results.length} invoices created — see results`);
  };

  // Modal markup is rendered separately and overlaid on whatever phase is
  // active, so the operator can preview the PDF from anywhere. Includes
  // Prev/Next so they can walk through every draft's final PDF in one go.
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

  if (loading) {
    return <div className="py-16 text-center text-gray-500">Loading previews...</div>;
  }

  // ─── Final review phase ────────────────────────────────────────────────────
  if (phase === 'final') {
    const approved = drafts.filter((d) => d.status === 'approved');
    const approvedTotal = approved.reduce((s, d) => {
      const overrideTds = d.settings.tdsRateId ? tdsRates.find((r) => r._id === d.settings.tdsRateId) : null;
      const t = computeTotals(d.editLines, d.settings, d.previewTotals, overrideTds);
      return s + (t?.grandTotal || 0);
    }, 0);

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
                    <tr key={`${d.hospitalId}-${d.month}`} className="hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium text-gray-800">{d.hospital?.name || '-'}</td>
                      <td className="py-3 px-4 text-gray-600">{monthLabel(d.month)}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{d.claimIds.length}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{d.editLines.length}</td>
                      <td className="py-3 px-4 text-right font-medium text-gray-800 tabular-nums">{formatINR(t?.grandTotal || 0)}</td>
                      <td className="py-3 px-4 text-center">
                        {d.status === 'approved' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-semibold">Approved</span>}
                        {d.status === 'rejected' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-red-50 text-red-700 text-xs font-semibold">Rejected</span>}
                        {d.status === 'pending' && <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-xs font-semibold">Pending</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            onClick={() => openPreview(d)}
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
              disabled={!approved.length}
              className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg"
            >
              Generate {approved.length} Invoice{approved.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </div>
      </>
    );
  }

  // ─── Generating phase ──────────────────────────────────────────────────────
  if (phase === 'generating') {
    const approvedCnt = drafts.filter((d) => d.status === 'approved').length;
    const pct = approvedCnt ? Math.round((generationProgress / approvedCnt) * 100) : 0;
    return (
      <div className="py-20 text-center">
        <p className="text-lg font-medium text-gray-800">Generating invoices…</p>
        <p className="text-sm text-gray-500 mt-1">{generationProgress} of {approvedCnt}</p>
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
          <h1 className="text-xl font-semibold text-gray-800">Generation Complete</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {okResults.length} succeeded, {failResults.length} failed.
          </p>

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

  // ─── Reviewing phase (per-draft editor) ───────────────────────────────────
  return (
    <>
    {previewModal}
    <div>
      <div className="flex items-center justify-between mb-3">
        <button onClick={handleDiscard} className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700 font-medium">
          <HiOutlineArrowLeft className="w-4 h-4" /> Discard Invoice
        </button>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-gray-500">Hospital {currentIdx + 1} of {totalDrafts}</span>
          <span className="text-gray-300">|</span>
          <span className="text-green-700 font-medium">{approvedCount} approved</span>
          <span className="text-gray-300">|</span>
          <span className="text-red-700 font-medium">{rejectedCount} rejected</span>
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

      {/* Stepper dots */}
      <div className="flex items-center gap-1 mb-4 overflow-x-auto">
        {drafts.map((d, i) => (
          <button
            key={`${d.hospitalId}-${d.month}-${i}`}
            onClick={() => setCurrentIdx(i)}
            title={`${d.hospital?.name} — ${monthLabel(d.month)}`}
            className={`shrink-0 h-2.5 rounded-full transition-all ${
              i === currentIdx ? 'w-8 bg-primary-600' :
              d.status === 'approved' ? 'w-2.5 bg-green-500 hover:w-4' :
              d.status === 'rejected' ? 'w-2.5 bg-red-500 hover:w-4' :
              'w-2.5 bg-gray-300 hover:w-4 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">{current.hospital?.name}</h2>
            <p className="text-sm text-gray-500 mt-0.5">{monthLabel(current.month)} • {current.claimIds.length} claim{current.claimIds.length === 1 ? '' : 's'} selected</p>
            {current.existingInvoice && (
              <p className="text-xs text-amber-700 mt-2 inline-flex items-center gap-1 bg-amber-50 px-2 py-1 rounded">
                Existing {current.existingInvoice.status} invoice {current.existingInvoice.invoiceNumber || ''} — generating will reuse the draft or fail.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openPreview(current)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-700 bg-white border border-primary-600 hover:bg-primary-50 rounded-lg"
              title="Preview this draft as the final PDF"
            >
              <HiOutlineEye className="w-4 h-4" /> Preview
            </button>
            {current.status === 'approved' && <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-xs font-semibold">✓ Approved</span>}
            {current.status === 'rejected' && <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-red-50 text-red-700 text-xs font-semibold">✗ Rejected</span>}
          </div>
        </div>

        <div className="mt-4">
          <BulkInvoiceDraftEditor
            draft={current}
            tdsRates={tdsRates}
            loadingTdsRates={loadingTdsRates}
            onChange={(patch) => updateDraft(currentIdx, patch)}
          />
        </div>

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
              onClick={rejectAndNext}
              className="flex items-center gap-2 px-4 py-2.5 text-sm border border-red-300 rounded-lg text-red-700 hover:bg-red-50 font-medium"
            >
              <HiOutlineX className="w-4 h-4" /> Reject
            </button>
            <button
              onClick={approveAndNext}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium"
            >
              <HiOutlineCheck className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={goNext}
              className="flex items-center gap-2 px-4 py-2.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium"
            >
              {currentIdx === totalDrafts - 1 ? 'Review All' : 'Next'} <HiOutlineArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default BulkInvoiceWizard;
