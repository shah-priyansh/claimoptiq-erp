import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { toast } from 'react-toastify';
import * as XLSX from 'xlsx-js-style';
import {
  HiOutlineX, HiOutlineDownload, HiOutlineUpload, HiOutlineDocumentText,
  HiOutlineCheckCircle, HiOutlineInformationCircle,
} from 'react-icons/hi';

/**
 * Generic bulk-import modal shared by Hospital / Insurance / TPA pages.
 * Pass a `config` describing the columns + label + API uploader.
 *
 * config = {
 *   title:        'Import Insurance Companies',
 *   entityLabel:  'insurance company',  // singular, lowercase
 *   templateName: 'insurance-import-template.xlsx',
 *   columns: [{ key, label, width, required?, note? }],
 *   sampleRow:  { key: value },          // optional second sample row
 *   uploadAPI:  (rows) => Promise<{data}>,
 * }
 */
const MasterImportModal = ({ open, onClose, onImported, config }) => {
  const fileInputRef = useRef(null);
  const [step, setStep] = useState('upload'); // upload | preview | result
  const [rows, setRows] = useState([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importingMode, setImportingMode] = useState(null);
  const [result, setResult] = useState(null);
  const [previewLimit, setPreviewLimit] = useState(200);

  useEffect(() => {
    if (!open) { setStep('upload'); setRows([]); setFileName(''); setResult(null); setPreviewLimit(200); setImportingMode(null); }
  }, [open]);

  const labelToKey = (label) => {
    const cleaned = String(label || '').replace(/\*/g, '').trim().toLowerCase();
    const col = config.columns.find(c => c.label.replace(/\*/g, '').trim().toLowerCase() === cleaned);
    return col?.key || null;
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    const headerRow = config.columns.map(c => c.label);
    const noteRow   = config.columns.map(c => c.note || '');
    const sample1Row = config.columns.map(c => config.sampleRow1?.[c.key] ?? '');
    const sample2Row = config.columns.map(c => config.sampleRow2?.[c.key] ?? '');
    const blankRows = Array.from({ length: 10 }, () => config.columns.map(() => ''));
    const aoa = [headerRow, noteRow, sample1Row, sample2Row, ...blankRows];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = config.columns.map(c => ({ wch: c.width || 18 }));
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
    XLSX.utils.book_append_sheet(wb, ws, 'Data');
    XLSX.writeFile(wb, config.templateName);
    toast.success('Template downloaded');
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'binary', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        if (!ws) { toast.error('No data found in file'); return; }
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false, raw: false });
        if (aoa.length < 2) { toast.error('File is empty or missing header row'); return; }
        const headers = aoa[0].map(h => labelToKey(h));
        if (headers.filter(Boolean).length < 1) {
          toast.error('Could not match columns — make sure you used the downloaded template');
          return;
        }
        let dataStart = 1;
        const possibleNote = aoa[1] || [];
        const looksLikeNote = possibleNote.some(cell => /required|optional|10-digit|6-digit|see Hospitals|see Insurance/i.test(String(cell)));
        if (looksLikeNote) dataStart = 2;

        const parsed = [];
        for (let i = dataStart; i < aoa.length; i++) {
          const row = aoa[i];
          if (!row || row.every(v => v === '' || v == null)) continue;
          const obj = {};
          headers.forEach((k, idx) => { if (k) obj[k] = row[idx]; });
          if (!obj.name || !String(obj.name).trim()) continue;
          parsed.push(obj);
        }
        if (!parsed.length) { toast.error('No valid data rows found'); return; }
        if (parsed.length > 2000) { toast.error('Maximum 2000 rows per import'); return; }
        setRows(parsed); setFileName(file.name); setStep('preview');
      } catch (err) {
        toast.error('Failed to parse file — make sure it is a valid xlsx/csv');
      }
    };
    reader.onerror = () => toast.error('Failed to read file');
    reader.readAsBinaryString(file);
  };

  const handleImport = async (mode = 'skip') => {
    setImporting(true);
    setImportingMode(mode);
    try {
      const { data } = await config.uploadAPI(rows, mode);
      setResult(data);
      setStep('result');
      const changed = (data.successCount || 0);
      if (changed > 0 || (data.skippedCount || 0) > 0) {
        const parts = [];
        if (data.createdCount) parts.push(`${data.createdCount} added`);
        if (data.updatedCount) parts.push(`${data.updatedCount} replaced`);
        if (data.skippedCount) parts.push(`${data.skippedCount} skipped`);
        toast.success(parts.length ? parts.join(', ') : `Imported ${changed} of ${data.totalRows}`);
        if (changed > 0) onImported?.();
      } else {
        toast.error('No records were imported — check the error list');
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Import failed');
    } finally {
      setImporting(false);
      setImportingMode(null);
    }
  };

  const resetAndUploadAgain = () => { setStep('upload'); setRows([]); setFileName(''); setResult(null); };
  const clearImportResult = () => { setResult(null); setStep('upload'); setRows([]); setFileName(''); };

  const classifyError = (msg) => {
    const m = String(msg);
    if (/already exists/i.test(m))             return { type: 'Duplicate', color: 'bg-slate-100 text-slate-700' };
    if (/duplicated in the file/i.test(m))     return { type: 'In-file dup', color: 'bg-amber-100 text-amber-700' };
    if (/is required/i.test(m))                return { type: 'Required', color: 'bg-rose-100 text-rose-700' };
    if (/valid 10-digit|valid email|valid 6-digit/i.test(m)) return { type: 'Invalid', color: 'bg-orange-100 text-orange-700' };
    return { type: 'Other', color: 'bg-gray-100 text-gray-700' };
  };

  const downloadFailedRows = () => {
    if (!result?.errors?.length) return;
    const cols = config.columns;
    const headers = ['Errors', ...cols.map(c => c.label.replace(/\*/g, '').trim())];
    const data = result.errors.map(e => {
      const src = rows[e.row - 2] || {};
      return [
        (e.errors || []).join(' | '),
        ...cols.map(c => {
          const v = src[c.key];
          return v === null || v === undefined ? '' : v;
        }),
      ];
    });
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws['!cols'] = [{ wch: 50 }, ...cols.map(c => ({ wch: c.width || 16 }))];
    const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: 'FFE2E2' } } };
    headers.forEach((_, idx) => {
      const addr = XLSX.utils.encode_cell({ r: 0, c: idx });
      if (ws[addr]) ws[addr].s = headerStyle;
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Failed Rows');
    const stamp = new Date().toISOString().slice(0, 10);
    const slug = (config.entityLabel || 'master').replace(/\s+/g, '-').toLowerCase();
    XLSX.writeFile(wb, `${slug}-import-failed-${stamp}.xlsx`);
  };

  if (!open) return null;
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
                {step === 'preview' && `${rows.length} row(s) ready to import from ${fileName}`}
                {step === 'result' && 'Import complete'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
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
                    <li>Download the sample <code className="px-1 py-0.5 bg-blue-100 rounded">.xlsx</code> template.</li>
                    <li>Fill in one record per row. Required columns are highlighted in red.</li>
                    <li>Upload the file. Valid rows are imported; invalid rows are listed and skipped.</li>
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

          {step === 'preview' && (
            <div className="space-y-3">
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex gap-2 text-xs text-amber-900">
                <HiOutlineInformationCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600" />
                <div className="space-y-0.5">
                  <p><span className="font-semibold">Skip All</span> — existing {config.entityLabel}s (matched by name) are left untouched; only new rows are added.</p>
                  <p><span className="font-semibold">Replace All</span> — existing {config.entityLabel}s are overwritten with the values from this file.</p>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-2 py-2 text-left font-semibold text-gray-500">#</th>
                        {config.columns.slice(0, 5).map(c => (
                          <th key={c.key} className="px-2 py-2 text-left font-semibold text-gray-500">{c.label.replace(/\*/g, '').trim()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows.slice(0, previewLimit).map((r, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-2 py-1.5 text-gray-400">{i + 1}</td>
                          {config.columns.slice(0, 5).map(c => (
                            <td key={c.key} className="px-2 py-1.5 text-gray-700">{r[c.key] || '-'}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {rows.length > previewLimit && (
                  <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t border-gray-200 flex items-center justify-between">
                    <span>Showing first {previewLimit} of {rows.length} rows</span>
                    <button onClick={() => setPreviewLimit(rows.length)}
                      className="px-2.5 py-1 rounded-md bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 font-medium">
                      Show all {rows.length}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Rows</p>
                  <p className="text-2xl font-bold text-gray-800 mt-1">{result.totalRows}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-emerald-700">Added</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{result.createdCount ?? result.successCount ?? 0}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-700">Replaced</p>
                  <p className="text-2xl font-bold text-blue-700 mt-1">{result.updatedCount ?? 0}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-slate-700">Skipped</p>
                  <p className="text-2xl font-bold text-slate-700 mt-1">{result.skippedCount ?? 0}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-700">Failed</p>
                  <p className="text-2xl font-bold text-red-700 mt-1">{result.errorCount}</p>
                </div>
              </div>

              {result.errors?.length > 0 && (() => {
                const grouped = new Map();
                result.errors.forEach(e => {
                  e.errors.forEach(msg => {
                    if (!grouped.has(msg)) grouped.set(msg, []);
                    grouped.get(msg).push({ row: e.row, name: e.name });
                  });
                });
                const summary = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);
                return (
                  <div className="space-y-3">
                    <div className="border border-red-100 rounded-lg overflow-hidden">
                      <div className="bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 border-b border-red-100">
                        Issues to fix ({summary.length} unique, {result.errors.length} row(s) affected)
                      </div>
                      <div className="max-h-64 overflow-y-auto divide-y divide-red-50">
                        {summary.map(([msg, errRows], i) => {
                          const cls = classifyError(msg);
                          return (
                            <div key={i} className="px-3 py-2.5 text-xs">
                              <div className="flex items-start gap-2">
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase flex-shrink-0 ${cls.color}`}>{cls.type}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-gray-800 break-words">{msg}</p>
                                  <p className="text-[11px] text-gray-500 mt-1">
                                    {errRows.length} row{errRows.length > 1 ? 's' : ''}: {errRows.slice(0, 5).map(r => `#${r.row}${r.name ? ` (${r.name})` : ''}`).join(', ')}
                                    {errRows.length > 5 && ` + ${errRows.length - 5} more`}
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <details className="border border-gray-200 rounded-lg overflow-hidden">
                      <summary className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-600 cursor-pointer hover:bg-gray-100">
                        Show full per-row list ({result.errors.length})
                      </summary>
                      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
                        {result.errors.map((e, i) => (
                          <div key={i} className="px-3 py-2 text-xs">
                            <p className="font-medium text-gray-800">Row {e.row}: {e.name || '(no name)'}</p>
                            <ul className="list-disc pl-4 mt-1 text-red-600 space-y-0.5">
                              {e.errors.map((msg, j) => <li key={j}>{msg}</li>)}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </details>
                  </div>
                );
              })()}

              {(result.successCount > 0 || (result.skippedCount ?? 0) > 0) && (
                <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 flex gap-2 text-xs text-emerald-800">
                  <HiOutlineCheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>
                    {(() => {
                      const parts = [];
                      if (result.createdCount) parts.push(`${result.createdCount} added`);
                      if (result.updatedCount) parts.push(`${result.updatedCount} replaced`);
                      if (result.skippedCount) parts.push(`${result.skippedCount} skipped`);
                      const summary = parts.length ? parts.join(', ') : `${result.successCount} added`;
                      return `${summary} (${config.entityLabel}s).`;
                    })()}
                  </span>
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
              <button onClick={() => handleImport('skip')} disabled={importing}
                title="Existing records (matched by name) are left untouched"
                className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 rounded-lg font-semibold disabled:opacity-50">
                {importing && importingMode === 'skip' ? (
                  <><div className="w-3.5 h-3.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> Skipping…</>
                ) : (
                  <>Skip All</>
                )}
              </button>
              <button onClick={() => handleImport('replace')} disabled={importing}
                title="Existing records (matched by name) are overwritten with the new data"
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50">
                {importing && importingMode === 'replace' ? (
                  <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> Replacing…</>
                ) : (
                  <><HiOutlineUpload className="w-4 h-4" /> Replace All</>
                )}
              </button>
            </>
          )}
          {step === 'result' && (
            <>
              {result?.errors?.length > 0 && (
                <button onClick={downloadFailedRows}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg font-medium">
                  <HiOutlineDownload className="w-4 h-4" />
                  Download Failed Rows ({result.errors.length})
                </button>
              )}
              <button onClick={clearImportResult}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Clear</button>
              <button onClick={resetAndUploadAgain}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium">Import Another File</button>
              <button onClick={onClose}
                className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold">Done</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default MasterImportModal;
