import React, { useState, useEffect, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx-js-style';
import {
  HiOutlineX, HiOutlineDownload, HiOutlineUpload, HiOutlineDocumentText,
  HiOutlineCheckCircle, HiOutlineInformationCircle,
} from 'react-icons/hi';
import { dateCellToIso, ISSUE_COLORS } from './importHelpers';

/**
 * Generic bulk-import modal for transactional (append-only) records —
 * Expenses, Cash/Bank, Account Entries. Driven entirely by a `config`:
 *
 * config = {
 *   title, entityLabel, sheetName, templateName, maxRows = 2000,
 *   columns:        [{ key, label, width, required?, note? }],
 *   sampleRows:     [{ key: value }, ...],
 *   refSheets:      [{ name, header, values: [] }],        // optional
 *   dateKeys:       ['date'],                               // cells to coerce to ISO
 *   previewColumns: [{ key, label, align?, render? }],
 *   validateRow:    (row) => [{ type, label }],             // client-side issues
 *   uploadAPI:      (rows) => Promise<{ data }>,
 * }
 */
const TransactionImportModal = ({ open, onClose, onImported, config }) => {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState('upload'); // upload | preview | result
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [previewLimit, setPreviewLimit] = useState(200);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const maxRows = config.maxRows || 2000;

  useEffect(() => {
    if (!open) {
      setStep('upload'); setRows([]); setFileName(''); setResult(null);
      setPreviewLimit(200); setOnlyIssues(false);
    }
  }, [open]);

  const labelToKey = (label) => {
    const cleaned = String(label || '').replace(/\*/g, '').trim().toLowerCase();
    if (!cleaned) return null;
    const col = config.columns.find((c) =>
      c.label.replace(/\*/g, '').trim().toLowerCase() === cleaned ||
      (c.aliases || []).some((a) => String(a).trim().toLowerCase() === cleaned));
    return col?.key || null;
  };

  // ── Pre-validate rows (mirrors backend) ──
  const validation = useMemo(() => {
    if (!rows.length) return { rowIssues: [], summary: { ok: 0, badRows: 0, byType: {} } };
    const summary = { ok: 0, badRows: 0, byType: {} };
    const rowIssues = rows.map((r) => {
      const issues = config.validateRow(r) || [];
      issues.forEach((iss) => { summary.byType[iss.type] = (summary.byType[iss.type] || 0) + 1; });
      if (issues.length) summary.badRows += 1; else summary.ok += 1;
      return issues;
    });
    return { rowIssues, summary };
  }, [rows, config]);

  // ── Build & download template ──
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headerRow = config.columns.map((c) => c.label);
    const noteRow = config.columns.map((c) => c.note || '');
    const sampleRows = (config.sampleRows || []).map((s) => config.columns.map((c) => s[c.key] ?? ''));
    const blanks = Array.from({ length: 10 }, () => config.columns.map(() => ''));
    const aoa = [headerRow, noteRow, ...sampleRows, ...blanks];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = config.columns.map((c) => ({ wch: c.width || 18 }));
    const thin = { style: 'thin', color: { auto: 1 } };
    const border = { top: thin, bottom: thin, left: thin, right: thin };
    config.columns.forEach((c, i) => {
      const hRef = XLSX.utils.encode_cell({ r: 0, c: i });
      ws[hRef].s = {
        font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: c.required ? 'DC2626' : '2563EB' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border,
      };
      const nRef = XLSX.utils.encode_cell({ r: 1, c: i });
      if (ws[nRef]) ws[nRef].s = {
        font: { italic: true, sz: 8, color: { rgb: '6B7280' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F9FAFB' } },
        alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
        border,
      };
    });
    ws['!rows'] = [{ hpt: 28 }, { hpt: 36 }];
    XLSX.utils.book_append_sheet(wb, ws, config.sheetName);

    (config.refSheets || []).forEach((rs) => {
      const refWs = XLSX.utils.aoa_to_sheet([[rs.header], ...(rs.values.length ? rs.values : ['—']).map((v) => [v])]);
      refWs['!cols'] = [{ wch: 42 }];
      const ref = XLSX.utils.encode_cell({ r: 0, c: 0 });
      if (refWs[ref]) refWs[ref].s = {
        font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
        fill: { patternType: 'solid', fgColor: { rgb: '2563EB' } },
        alignment: { horizontal: 'center', vertical: 'center' },
      };
      XLSX.utils.book_append_sheet(wb, refWs, rs.name);
    });

    XLSX.writeFile(wb, config.templateName);
    toast.success('Template downloaded');
  };

  // ── Parse uploaded file ──
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        const sheetName = wb.SheetNames.find((n) => n.toLowerCase() === config.sheetName.toLowerCase()) || wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        if (!ws) { toast.error('No data found in file'); return; }
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: true });
        if (aoa.length < 2) { toast.error('File is empty or missing header row'); return; }
        // Locate the header row. Most files put it first, but some exports
        // (e.g. a Sale Report) prepend a title/summary row — scan the first few
        // rows and pick the one that matches the most known columns.
        let headerIdx = 0;
        let bestMatches = -1;
        for (let i = 0; i < Math.min(aoa.length - 1, 8); i++) {
          const matches = (aoa[i] || []).map((h) => labelToKey(h)).filter(Boolean).length;
          if (matches > bestMatches) { bestMatches = matches; headerIdx = i; }
        }
        const headers = aoa[headerIdx].map((h) => labelToKey(h));
        if (headers.filter(Boolean).length < 2) {
          toast.error('Could not match columns — make sure you used the downloaded template');
          return;
        }
        let dataStart = headerIdx + 1;
        const noteRow = aoa[dataStart] || [];
        if (noteRow.some((cell) => /YYYY-MM-DD|see .* sheet|Numbers only|cash \/ bank|general \/ contra/i.test(String(cell)))) dataStart += 1;

        const dateKeys = config.dateKeys || [];
        const allKeys = config.columns.map((c) => c.key);
        const parsed = [];
        for (let i = dataStart; i < aoa.length; i++) {
          const row = aoa[i];
          if (!row || row.every((v) => v === '' || v === null || v === undefined)) continue;
          const obj = {};
          headers.forEach((key, idx) => {
            if (!key) return;
            obj[key] = dateKeys.includes(key) ? dateCellToIso(row[idx]) : row[idx];
          });
          if (!allKeys.some((k) => String(obj[k] ?? '').trim())) continue;
          parsed.push(obj);
        }
        if (!parsed.length) { toast.error('No valid data rows found'); return; }
        if (parsed.length > maxRows) { toast.error(`Maximum ${maxRows} rows per import`); return; }
        setRows(parsed); setFileName(file.name); setStep('preview');
      } catch {
        toast.error('Failed to parse file — make sure it is a valid xlsx/csv');
      }
    };
    reader.onerror = () => toast.error('Failed to read file');
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const { data } = await config.uploadAPI(rows);
      setResult(data);
      setStep('result');
      if ((data.successCount || 0) > 0) {
        toast.success(`${data.successCount} ${config.entityLabel}(s) imported`);
        onImported?.();
      } else {
        toast.error('Nothing was imported — check the error list');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const resetAndUploadAgain = () => { setStep('upload'); setRows([]); setFileName(''); };
  const clearImportResult = () => { setResult(null); setStep('upload'); setRows([]); setFileName(''); };

  const downloadFailedRows = () => {
    if (!result?.errors?.length) return;
    const headers = ['Errors', ...config.columns.map((c) => c.label.replace(/\*/g, '').trim())];
    const data = result.errors.map((e) => {
      const src = rows[e.row - 2] || {};
      return [(e.errors || []).join(' | '), ...config.columns.map((c) => {
        const v = src[c.key];
        return v === null || v === undefined ? '' : v;
      })];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 50 }, ...config.columns.map((c) => ({ wch: c.width || 16 }))];
    const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE2E2' } } };
    headers.forEach((_, idx) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
      if (ws[addr]) ws[addr].s = headerStyle;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows');
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (config.entityLabel || 'record').replace(/\s+/g, '-').toLowerCase();
    XLSX.writeFile(wb, `${slug}-import-failed-${stamp}.xlsx`);
  };

  if (!open) return null;

  const cellVal = (r, col) => {
    if (col.render) return col.render(r);
    const v = r[col.key];
    return v === null || v === undefined || String(v).trim() === '' ? '-' : String(v);
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center">
              <HiOutlineUpload className="w-5 h-5 text-primary-600" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-gray-900">{config.title}</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {step === 'upload' && 'Download the sample template, fill it in, then upload'}
                {step === 'preview' && `${rows.length} row(s) ready from ${fileName}`}
                {step === 'result' && 'Import complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} disabled={importing}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 disabled:opacity-40">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {step === 'upload' && (
            <div className="space-y-5">
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-3">
                <HiOutlineInformationCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-blue-900 space-y-1.5">
                  <p className="font-medium">How it works</p>
                  <ol className="list-decimal pl-4 space-y-0.5 text-xs text-blue-800">
                    <li>Download the sample <code className="px-1 py-0.5 bg-blue-100 rounded">.xlsx</code> template{config.refSheets?.length ? ' (includes reference sheets)' : ''}.</li>
                    <li>{config.rowInstruction || `Fill in one ${config.entityLabel} per row.`} Required columns are highlighted in red.</li>
                    <li>Upload the file. Valid rows are added; invalid rows are listed and skipped.</li>
                  </ol>
                </div>
              </div>

              <button onClick={downloadTemplate}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl text-sm font-semibold transition-colors">
                <HiOutlineDownload className="w-5 h-5" /> Download Sample Template
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
                <div className="relative flex justify-center text-xs"><span className="px-2 bg-white text-gray-400">then upload your file</span></div>
              </div>

              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv"
                onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }} className="hidden" />
              <div onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-primary-400', 'bg-primary-50'); }}
                onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-400', 'bg-primary-50'); }}
                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-primary-400', 'bg-primary-50'); handleFile(e.dataTransfer.files?.[0]); }}
                className="border-2 border-dashed border-gray-300 rounded-xl px-6 py-10 text-center cursor-pointer hover:border-primary-400 hover:bg-primary-50 transition-colors">
                <HiOutlineDocumentText className="w-10 h-10 text-gray-400 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">Click to choose a file, or drag &amp; drop</p>
                <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, or .csv</p>
              </div>
            </div>
          )}

          {step === 'preview' && (() => {
            const { rowIssues, summary } = validation;
            const visible = rows
              .map((r, i) => ({ r, i, issues: rowIssues[i] || [] }))
              .filter((x) => !onlyIssues || x.issues.length > 0);
            const shown = visible.slice(0, previewLimit);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3">
                    <p className="text-emerald-700 font-semibold">Ready to import</p>
                    <p className="text-2xl font-bold text-emerald-700 mt-0.5">{summary.ok}</p>
                  </div>
                  <div className="bg-rose-50 border border-rose-100 rounded-lg p-3">
                    <p className="text-rose-700 font-semibold">Need fixes</p>
                    <p className="text-2xl font-bold text-rose-700 mt-0.5">{summary.badRows}</p>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-gray-600 font-semibold">Total rows</p>
                    <p className="text-2xl font-bold text-gray-800 mt-0.5">{rows.length}</p>
                  </div>
                </div>

                {summary.badRows > 0 && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-900 flex items-center justify-between gap-3">
                    <div className="flex flex-wrap gap-1.5 items-center">
                      <span className="font-semibold">{summary.badRows} row(s) need fixes:</span>
                      {Object.entries(summary.byType).map(([t, n]) => (
                        <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${ISSUE_COLORS[t] || 'bg-gray-100 text-gray-700'}`}>{t}: {n}</span>
                      ))}
                    </div>
                    <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer">
                      <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} className="rounded" />
                      Only issues
                    </label>
                  </div>
                )}

                <div className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-[48vh]">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                        <tr>
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                          {config.previewColumns.map((c) => (
                            <th key={c.key} className={`px-2 py-2 font-semibold text-gray-500 ${c.align === 'right' ? 'text-right' : 'text-left'}`}>{c.label}</th>
                          ))}
                          <th className="px-2 py-2 text-left font-semibold text-gray-500">Issues</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {shown.map(({ r, i, issues }) => (
                          <tr key={i} className={`hover:bg-gray-50 ${issues.length ? 'bg-rose-50/40' : ''}`}>
                            <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                            {config.previewColumns.map((c) => (
                              <td key={c.key} className={`px-2 py-1.5 text-gray-700 whitespace-nowrap ${c.align === 'right' ? 'text-right' : ''}`}>{cellVal(r, c)}</td>
                            ))}
                            <td className="px-2 py-1.5">
                              {issues.length === 0 ? (
                                <span className="inline-flex items-center gap-1 text-emerald-600"><HiOutlineCheckCircle className="w-3.5 h-3.5" /> OK</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {issues.map((iss, j) => (
                                    <span key={j} className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${ISSUE_COLORS[iss.type] || 'bg-gray-100 text-gray-700'}`}>{iss.label}</span>
                                  ))}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {visible.length > previewLimit && (
                    <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t border-gray-200 flex items-center justify-between">
                      <span>Showing first {previewLimit} of {visible.length} rows</span>
                      <button onClick={() => setPreviewLimit(visible.length)}
                        className="px-2.5 py-1 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-medium">Show all {visible.length}</button>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Rows</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{result.totalRows}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-700">Added</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{result.createdCount ?? result.successCount ?? 0}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-700">Failed</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">{result.errorCount ?? 0}</p>
                </div>
              </div>

              {result.errors?.length > 0 && (
                <div className="border border-red-100 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 border-b border-red-100">
                    Rows skipped ({result.errors.length})
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                    {result.errors.map((e, i) => (
                      <div key={i} className="px-3 py-2 text-xs">
                        <p className="font-medium text-gray-800">Row {e.row}{e.name ? ` — ${e.name}` : ''}</p>
                        <ul className="list-disc pl-4 mt-1 text-red-600 space-y-0.5">
                          {e.errors.map((msg, j) => <li key={j}>{msg}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.successCount > 0 && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 flex gap-2 text-xs text-emerald-800">
                  <HiOutlineCheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{result.successCount} {config.entityLabel}(s) added successfully.</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          {step === 'upload' && (
            <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Cancel</button>
          )}
          {step === 'preview' && (
            <>
              <button onClick={resetAndUploadAgain} disabled={importing}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50">Back</button>
              <button onClick={handleImport} disabled={importing || validation.summary.ok === 0}
                title={validation.summary.ok === 0 ? 'No valid rows to import' : `Import ${validation.summary.ok} valid row(s)`}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50">
                {importing ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Importing…</>
                ) : (
                  <><HiOutlineUpload className="w-4 h-4" /> Import {validation.summary.ok} Row(s)</>
                )}
              </button>
            </>
          )}
          {step === 'result' && (
            <>
              {result?.errors?.length > 0 && (
                <button onClick={downloadFailedRows}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-medium">
                  <HiOutlineDownload className="w-4 h-4" /> Download Failed Rows ({result.errors.length})
                </button>
              )}
              <button onClick={clearImportResult}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Import Another File</button>
              <button onClick={onClose}
                className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold">Done</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TransactionImportModal;
