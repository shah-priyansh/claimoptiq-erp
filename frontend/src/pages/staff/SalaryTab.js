import React, { useState, useEffect, useCallback } from 'react';
import { computeSalaryAPI, getSalaryRecordsAPI, getMySalaryAPI, updateSalaryRecordAPI, getOtSettingsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { formatCurrency } from '../../utils/format';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineDocumentDownload, HiOutlineLockClosed, HiChevronDown, HiOutlineInformationCircle } from 'react-icons/hi';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const NativeSelect = ({ value, onChange, children }) => (
  <div className="relative inline-flex items-center">
    <select
      value={value}
      onChange={onChange}
      className="appearance-none bg-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
    >
      {children}
    </select>
    <HiChevronDown className="pointer-events-none absolute right-2.5 w-4 h-4 text-gray-400" />
  </div>
);

const fmtMin = (m) => { const h = Math.floor(m / 60); const mn = m % 60; return `${h}h ${String(mn).padStart(2, '0')}m`; };

const countSundays = (year, monthIdx0) => {
  const days = new Date(year, monthIdx0 + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (new Date(year, monthIdx0, d).getDay() === 0) count++;
  }
  return count;
};

const sundaysInRecord = (r) => {
  const d = new Date(r.month);
  return countSundays(d.getUTCFullYear(), d.getUTCMonth());
};

const DEFAULT_OT_MULTS = { dailyMultiplier: 1.5, sundayMultiplier: 2.0, holidayMultiplier: 2.0 };

const computeBreakdown = (r, otMults = DEFAULT_OT_MULTS) => {
  const basicPerDay = r.basicSalary / r.calendarDays;
  const earnedBasic = basicPerDay * r.presentDays;
  const hourlyRate = r.basicSalary / (r.calendarDays * r.employee.standardHours);
  const dailyOtAmt = (r.dailyOtMinutes / 60) * hourlyRate * otMults.dailyMultiplier;
  const sundayOtAmt = (r.sundayOtMinutes / 60) * hourlyRate * otMults.sundayMultiplier;
  const holidayOtAmt = (r.holidayOtMinutes / 60) * hourlyRate * otMults.holidayMultiplier;
  const fixedAllow = r.employee.allowances.reduce((s, a) => s + a.amount, 0);
  const extraAllow = (r.extraAllowances || []).reduce((s, a) => s + parseFloat(a.amount || 0), 0);
  return { earnedBasic, dailyOtAmt, sundayOtAmt, holidayOtAmt, fixedAllow, extraAllow, totalOt: dailyOtAmt + sundayOtAmt + holidayOtAmt };
};

const fmtMult = (n) => `×${Number(n).toFixed(1)}`;

const ExtraAllowanceEditor = ({ record, onUpdate }) => {
  const [items, setItems] = useState(record.extraAllowances || []);
  const [saving, setSaving] = useState(false);
  const add = () => setItems(i => [...i, { name: '', amount: '' }]);
  const remove = (idx) => setItems(i => i.filter((_, j) => j !== idx));
  const set = (idx, k, v) => setItems(i => i.map((a, j) => j === idx ? { ...a, [k]: v } : a));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await updateSalaryRecordAPI(record.id, { extraAllowances: items });
      toast.success('Allowances saved');
      onUpdate(data);
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 mt-2">
      {items.map((a, i) => (
        <div key={i} className="flex gap-2 items-center">
          <input placeholder="Name (e.g. Bonus)" value={a.name} onChange={e => set(i, 'name', e.target.value)}
            className="flex-1 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-primary-500" />
          <input placeholder="₹" type="number" value={a.amount} onChange={e => set(i, 'amount', e.target.value)}
            className="w-24 px-2 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-primary-500" />
          <button onClick={() => remove(i)} className="text-red-400 hover:text-red-600"><HiOutlineTrash className="w-3.5 h-3.5" /></button>
        </div>
      ))}
      <div className="flex gap-2 mt-1">
        <button onClick={add} className="text-xs text-primary-600 hover:text-primary-700 font-medium">+ Add</button>
        <button onClick={save} disabled={saving}
          className="text-xs text-white bg-primary-600 hover:bg-primary-700 px-3 py-1 rounded font-medium disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  );
};

const SalaryRow = ({ r, canEdit, onUpdate, onFinalize, otMults }) => {
  const [expanded, setExpanded] = useState(false);
  const [changing, setChanging] = useState(false);
  const bd = computeBreakdown(r, otMults);

  const handleStatusChange = async (newValue) => {
    setChanging(true);
    try {
      await onFinalize(r.id, newValue);
    } finally {
      setChanging(false);
    }
  };

  const hasAnyOt = r.dailyOtMinutes > 0 || r.sundayOtMinutes > 0 || r.holidayOtMinutes > 0;

  return (
    <>
      <tr
        className={`text-sm cursor-pointer transition-colors ${expanded ? 'bg-blue-50/40' : 'hover:bg-gray-50'}`}
        onClick={() => setExpanded(e => !e)}
      >
        <td className="py-3 px-4 align-middle">
          <div className="flex items-center gap-2">
            <HiChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            <span className="font-semibold text-primary-600">{r.employee.empNumber}</span>
          </div>
        </td>
        <td className="py-3 px-4 align-middle font-medium text-gray-800">{r.employee.name}</td>
        <td className="py-3 px-4 align-middle">
          <div className="text-gray-700 font-medium tabular-nums">{r.presentDays}<span className="text-gray-400">/{r.calendarDays}</span></div>
          <div className="flex flex-wrap gap-1 mt-1">
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                r.sundayPresentDays > 0
                  ? 'bg-purple-100 border-purple-300 text-purple-800'
                  : 'bg-purple-50 border-purple-200 text-purple-600'
              }`}
              title={`${sundaysInRecord(r)} Sunday(s) in month — ${r.sundayPresentDays || 0} worked`}
            >
              {r.sundayPresentDays > 0 ? `${r.sundayPresentDays}/` : ''}{sundaysInRecord(r)} Sun
            </span>
            {(r.holidayCount > 0 || r.holidayPresentDays > 0) && (
              <span
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
                  r.holidayPresentDays > 0
                    ? 'bg-orange-100 border-orange-300 text-orange-800'
                    : 'bg-orange-50 border-orange-200 text-orange-600'
                }`}
                title={`${r.holidayCount || 0} Holiday(s) in month — ${r.holidayPresentDays || 0} worked`}
              >
                {r.holidayPresentDays > 0 ? `${r.holidayPresentDays}/` : ''}{r.holidayCount || 0} Hol
              </span>
            )}
          </div>
        </td>
        <td className="py-3 px-4 align-middle text-gray-700 tabular-nums">{formatCurrency(bd.earnedBasic)}</td>
        <td className="py-3 px-4 align-middle text-gray-700 tabular-nums">{formatCurrency(bd.fixedAllow + bd.extraAllow)}</td>
        <td className="py-3 px-4 align-middle">
          {hasAnyOt ? (
            <div className="flex flex-wrap gap-1">
              {r.dailyOtMinutes > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-yellow-50 border border-yellow-200 text-[10px] font-semibold text-yellow-800">
                  <span className="w-1 h-1 rounded-full bg-yellow-500" />{fmtMin(r.dailyOtMinutes)} <span className="text-yellow-600/70 font-normal">Daily</span>
                </span>
              )}
              {r.sundayOtMinutes > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-50 border border-purple-200 text-[10px] font-semibold text-purple-800">
                  <span className="w-1 h-1 rounded-full bg-purple-500" />{fmtMin(r.sundayOtMinutes)} <span className="text-purple-600/70 font-normal">Sun</span>
                </span>
              )}
              {r.holidayOtMinutes > 0 && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-orange-50 border border-orange-200 text-[10px] font-semibold text-orange-800">
                  <span className="w-1 h-1 rounded-full bg-orange-500" />{fmtMin(r.holidayOtMinutes)} <span className="text-orange-600/70 font-normal">Hol</span>
                </span>
              )}
            </div>
          ) : (
            <span className="text-[11px] text-gray-400 italic">No OT</span>
          )}
        </td>
        <td className={`py-3 px-4 align-middle tabular-nums ${hasAnyOt ? 'text-green-700 font-semibold' : 'text-gray-400'}`}>
          {hasAnyOt ? formatCurrency(bd.totalOt) : '—'}
        </td>
        <td className="py-3 px-4 align-middle">
          <span className="font-bold text-gray-900 tabular-nums">{formatCurrency(r.totalAmount)}</span>
        </td>
        <td className="py-3 px-4 align-middle">
          {changing
            ? <span className="inline-flex text-[10px] text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full font-semibold animate-pulse">Updating…</span>
            : r.isFinalized
              ? <span className="inline-flex items-center gap-1 text-[10px] text-green-700 font-semibold bg-green-100 px-2 py-0.5 rounded-full"><HiOutlineLockClosed className="w-3 h-3" />Finalized</span>
              : <span className="inline-flex text-[10px] text-yellow-800 bg-yellow-100 px-2 py-0.5 rounded-full font-semibold">Draft</span>}
        </td>
        <td className="py-3 px-4 align-middle text-right">
          {canEdit && (
            r.isFinalized ? (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange(false); }}
                disabled={changing}
                className="text-xs bg-white border border-yellow-400 text-yellow-700 hover:bg-yellow-50 px-2.5 py-1 rounded-md font-semibold disabled:opacity-50 transition-colors"
              >
                {changing ? 'Updating…' : 'Revert'}
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange(true); }}
                disabled={changing}
                className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded-md font-semibold disabled:opacity-50 transition-colors shadow-sm"
              >
                {changing ? 'Updating…' : 'Finalize'}
              </button>
            )
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-blue-50/40">
          <td colSpan={10} className="px-6 py-4">
            {/* Salary breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-4">
              <div><span className="text-gray-500">Basic Salary:</span> <span className="font-semibold">{formatCurrency(r.basicSalary)}</span></div>
              <div><span className="text-gray-500">Calendar Days:</span> <span className="font-semibold">{r.calendarDays}</span></div>
              <div><span className="text-gray-500">Per Day Rate:</span> <span className="font-semibold">{formatCurrency(r.basicSalary / r.calendarDays)}</span></div>
              <div><span className="text-gray-500">Earned Basic:</span> <span className="font-semibold">{formatCurrency(bd.earnedBasic)}</span></div>
              <div><span className="text-gray-500">Fixed Allow:</span> <span className="font-semibold">{formatCurrency(bd.fixedAllow)}</span></div>
              <div><span className="text-gray-500">Extra Allow:</span> <span className="font-semibold">{formatCurrency(bd.extraAllow)}</span></div>
              <div><span className="text-gray-500">Hourly Rate:</span> <span className="font-semibold">{formatCurrency(r.basicSalary / (r.calendarDays * r.employee.standardHours))}</span></div>
              <div><span className="text-gray-500">OT Total:</span> <span className="font-semibold text-green-600">{formatCurrency(bd.totalOt)}</span></div>
            </div>

            {/* Overtime detail panel — helps admin see if employee worked extra/sunday/holiday and at what rate */}
            <div className="bg-white border border-gray-200 rounded-lg p-3 mb-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Overtime Detail</p>
                {bd.totalOt > 0
                  ? <span className="text-[10px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full font-semibold">{formatCurrency(bd.totalOt)} earned</span>
                  : <span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full font-medium">No OT this month</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div className={`rounded-md px-3 py-2 border ${r.dailyOtMinutes > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700">Daily OT</span>
                    <span className="text-[10px] text-gray-500 font-medium">{fmtMult(otMults.dailyMultiplier)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {r.dailyOtMinutes > 0 ? <><span className="text-gray-700 font-semibold">{fmtMin(r.dailyOtMinutes)}</span> on weekdays</> : <span className="italic">Not worked</span>}
                  </div>
                  <div className="text-sm font-bold text-gray-800 mt-0.5">{formatCurrency(bd.dailyOtAmt)}</div>
                </div>
                <div className={`rounded-md px-3 py-2 border ${r.sundayOtMinutes > 0 ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700">Sunday OT</span>
                    <span className="text-[10px] text-gray-500 font-medium">{fmtMult(otMults.sundayMultiplier)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {r.sundayOtMinutes > 0 ? <><span className="text-gray-700 font-semibold">{fmtMin(r.sundayOtMinutes)}</span> on Sundays</> : <span className="italic">Not worked</span>}
                  </div>
                  <div className="text-sm font-bold text-gray-800 mt-0.5">{formatCurrency(bd.sundayOtAmt)}</div>
                </div>
                <div className={`rounded-md px-3 py-2 border ${r.holidayOtMinutes > 0 ? 'bg-orange-50 border-orange-200' : 'bg-gray-50 border-gray-200'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-gray-700">Holiday OT</span>
                    <span className="text-[10px] text-gray-500 font-medium">{fmtMult(otMults.holidayMultiplier)}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 mt-1">
                    {r.holidayOtMinutes > 0 ? <><span className="text-gray-700 font-semibold">{fmtMin(r.holidayOtMinutes)}</span> on holidays</> : <span className="italic">Not worked</span>}
                  </div>
                  <div className="text-sm font-bold text-gray-800 mt-0.5">{formatCurrency(bd.holidayOtAmt)}</div>
                </div>
              </div>
            </div>

            {canEdit && !r.isFinalized && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Extra / Variable Allowances</p>
                <ExtraAllowanceEditor record={r} onUpdate={onUpdate} />
              </div>
            )}
            {r.extraAllowances?.length > 0 && r.isFinalized && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Extra Allowances</p>
                {r.extraAllowances.map((a, i) => (
                  <div key={i} className="text-xs text-gray-600">{a.name}: {formatCurrency(a.amount)}</div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
};

const AdminSalaryView = ({ canEdit }) => {
  const now = new Date();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [computing, setComputing] = useState(false);
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [otMults, setOtMults] = useState(DEFAULT_OT_MULTS);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getSalaryRecordsAPI({ month: selMonth, year: selYear });
      setRecords(data);
    } catch { toast.error('Failed to load salary records'); }
    finally { setLoading(false); }
  }, [selMonth, selYear]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getOtSettingsAPI()
      .then(({ data }) => setOtMults({
        dailyMultiplier: data.dailyMultiplier,
        sundayMultiplier: data.sundayMultiplier,
        holidayMultiplier: data.holidayMultiplier,
      }))
      .catch(() => {});
  }, []);

  const handleCompute = async () => {
    setComputing(true);
    try {
      await computeSalaryAPI({ month: selMonth, year: selYear });
      toast.success('Salary computed');
      load();
    } catch { toast.error('Failed to compute salary'); }
    finally { setComputing(false); }
  };

  const handleFinalize = async (id, isFinalized) => {
    try {
      const { data } = await updateSalaryRecordAPI(id, { isFinalized });
      setRecords(prev => prev.map(r => r.id === id ? data : r));
      toast.success(isFinalized ? 'Salary finalized' : 'Reverted to draft');
    } catch { toast.error(isFinalized ? 'Failed to finalize' : 'Failed to revert to draft'); }
  };

  const handleUpdate = (updated) => {
    setRecords(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const exportExcel = () => {
    const monthLabel = `${months[selMonth - 1]} ${selYear}`;
    const wb = XLSX.utils.book_new();
    const headers = ['EMP No', 'Name', 'Basic Salary', 'Calendar Days', 'Sundays', 'Present Days', 'Earned Basic',
      'Fixed Allow', 'Extra Allow', 'Daily OT Min', 'Sunday OT Min', 'Holiday OT Min', 'OT Amount', 'Total Salary', 'Status'];

    const r2 = (v) => Math.round(v * 100) / 100;
    const rows = records.map(r => {
      const bd = computeBreakdown(r, otMults);
      return [r.employee.empNumber, r.employee.name, r2(r.basicSalary), r.calendarDays, sundaysInRecord(r), r.presentDays,
        r2(bd.earnedBasic), r2(bd.fixedAllow), r2(bd.extraAllow), r.dailyOtMinutes, r.sundayOtMinutes, r.holidayOtMinutes,
        r2(bd.totalOt), r2(r.totalAmount), r.isFinalized ? 'Finalized' : 'Draft'];
    });

    // Totals row — sum numeric columns, blank for non-numeric
    const tot = records.reduce((acc, r) => {
      const bd = computeBreakdown(r, otMults);
      acc.earnedBasic   += bd.earnedBasic;
      acc.fixedAllow    += bd.fixedAllow;
      acc.extraAllow    += bd.extraAllow;
      acc.dailyOtMin    += r.dailyOtMinutes;
      acc.sundayOtMin   += r.sundayOtMinutes;
      acc.holidayOtMin  += r.holidayOtMinutes;
      acc.totalOt       += bd.totalOt;
      acc.totalAmount   += r.totalAmount;
      return acc;
    }, { earnedBasic: 0, fixedAllow: 0, extraAllow: 0, dailyOtMin: 0, sundayOtMin: 0, holidayOtMin: 0, totalOt: 0, totalAmount: 0 });

    const totalsRow = ['', 'TOTAL', '', '', '', '',
      Math.round(tot.earnedBasic * 100) / 100,
      Math.round(tot.fixedAllow * 100) / 100,
      Math.round(tot.extraAllow * 100) / 100,
      tot.dailyOtMin, tot.sundayOtMin, tot.holidayOtMin,
      Math.round(tot.totalOt * 100) / 100,
      Math.round(tot.totalAmount * 100) / 100,
      ''];

    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, [], totalsRow]);
    ws['!cols'] = headers.map((_, i) => ({ wch: i < 2 ? 18 : 14 }));
    XLSX.utils.book_append_sheet(wb, ws, monthLabel);
    XLSX.writeFile(wb, `salary_${months[selMonth-1]}_${selYear}.xlsx`);
  };

  const exportPDF = () => {
    const monthLabel = `${months[selMonth - 1]} ${selYear}`;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(13); doc.setFont('helvetica', 'bold');
    doc.text(`Staff Salary — ${monthLabel}`, 14, 14);
    doc.setFontSize(8); doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')} | ${records.length} employee(s)`, 14, 20);

    const tot = records.reduce((acc, r) => {
      const bd = computeBreakdown(r, otMults);
      acc.earnedBasic  += bd.earnedBasic;
      acc.allowances   += bd.fixedAllow + bd.extraAllow;
      acc.totalOt      += bd.totalOt;
      acc.totalAmount  += r.totalAmount;
      return acc;
    }, { earnedBasic: 0, allowances: 0, totalOt: 0, totalAmount: 0 });

    autoTable(doc, {
      startY: 25,
      head: [['EMP', 'Name', 'Days', 'Sundays', 'Earned Basic', 'Allowances', 'Daily OT', 'Sun OT', 'Hol OT', 'OT Amt', 'Total', 'Status']],
      body: records.map(r => {
        const bd = computeBreakdown(r, otMults);
        return [r.employee.empNumber, r.employee.name, `${r.presentDays}/${r.calendarDays}`,
          sundaysInRecord(r),
          formatCurrency(bd.earnedBasic), formatCurrency(bd.fixedAllow + bd.extraAllow),
          fmtMin(r.dailyOtMinutes), fmtMin(r.sundayOtMinutes), fmtMin(r.holidayOtMinutes),
          formatCurrency(bd.totalOt), formatCurrency(r.totalAmount), r.isFinalized ? 'Final' : 'Draft'];
      }),
      foot: [[
        '', `TOTAL (${records.length})`, '', '',
        formatCurrency(tot.earnedBasic),
        formatCurrency(tot.allowances),
        '', '', '',
        formatCurrency(tot.totalOt),
        formatCurrency(tot.totalAmount),
        '',
      ]],
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 7 },
      footStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
      showFoot: 'lastPage',
      theme: 'grid',
      margin: { left: 14, right: 14 },
    });
    doc.save(`salary_${months[selMonth-1]}_${selYear}.pdf`);
  };

  const total = records.reduce((s, r) => s + r.totalAmount, 0);
  const otTotals = records.reduce((acc, r) => {
    acc.daily   += r.dailyOtMinutes   || 0;
    acc.sunday  += r.sundayOtMinutes  || 0;
    acc.holiday += r.holidayOtMinutes || 0;
    if (r.sundayOtMinutes > 0)  acc.sundayWorkers  += 1;
    if (r.holidayOtMinutes > 0) acc.holidayWorkers += 1;
    if (r.dailyOtMinutes > 0)   acc.dailyWorkers   += 1;
    return acc;
  }, { daily: 0, sunday: 0, holiday: 0, dailyWorkers: 0, sundayWorkers: 0, holidayWorkers: 0 });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <NativeSelect value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
          {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </NativeSelect>
        <NativeSelect value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </NativeSelect>
        {canEdit && (
          <button onClick={handleCompute} disabled={computing}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {computing ? 'Computing...' : 'Compute Salary'}
          </button>
        )}
        {records.length > 0 && (
          <>
            <button onClick={exportExcel} className="flex items-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
              <HiOutlineDocumentDownload className="w-4 h-4" /> XLS
            </button>
            <button onClick={exportPDF} className="flex items-center gap-1 px-3 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg text-sm font-medium">
              <HiOutlineDocumentDownload className="w-4 h-4" /> PDF
            </button>
          </>
        )}
      </div>

      {records.length > 0 && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap gap-6">
            <div><p className="text-xs text-gray-400 font-semibold uppercase">Employees</p><p className="text-xl font-bold text-gray-800">{records.length}</p></div>
            <div><p className="text-xs text-gray-400 font-semibold uppercase">Total Payroll</p><p className="text-xl font-bold text-primary-600">{formatCurrency(total)}</p></div>
            <div><p className="text-xs text-gray-400 font-semibold uppercase">Finalized</p><p className="text-xl font-bold text-green-600">{records.filter(r => r.isFinalized).length}/{records.length}</p></div>
            <div className="border-l border-gray-200 pl-6">
              <p className="text-xs text-gray-400 font-semibold uppercase">Daily OT <span className="text-gray-400 font-medium">{fmtMult(otMults.dailyMultiplier)}</span></p>
              <p className="text-xl font-bold text-yellow-700">{fmtMin(otTotals.daily)}</p>
              <p className="text-[10px] text-gray-500">{otTotals.dailyWorkers} employee(s)</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase">Sunday OT <span className="text-gray-400 font-medium">{fmtMult(otMults.sundayMultiplier)}</span></p>
              <p className="text-xl font-bold text-purple-700">{fmtMin(otTotals.sunday)}</p>
              <p className="text-[10px] text-gray-500">{otTotals.sundayWorkers} employee(s)</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase">Holiday OT <span className="text-gray-400 font-medium">{fmtMult(otMults.holidayMultiplier)}</span></p>
              <p className="text-xl font-bold text-orange-700">{fmtMin(otTotals.holiday)}</p>
              <p className="text-[10px] text-gray-500">{otTotals.holidayWorkers} employee(s)</p>
            </div>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5 text-xs text-blue-900 flex items-start gap-2">
            <HiOutlineInformationCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-600" />
            <div>
              OT is auto-classified by date: <span className="font-semibold">Sundays</span> and <span className="font-semibold">holidays</span> count every worked minute as OT;
              other weekdays count only hours beyond the standard duty. After changing holidays or OT multipliers, click
              <span className="font-semibold"> "Compute Salary"</span> to refresh draft records.
            </div>
          </div>
        </>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['EMP No','Name','Days / Sundays','Earned Basic','Allowances','OT Hours','OT Amount','Total','Status',''].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">Loading...</td></tr>
              ) : records.length === 0 ? (
                <tr><td colSpan={10} className="py-10 text-center text-gray-400">Click "Compute Salary" to generate records</td></tr>
              ) : records.map(r => (
                <SalaryRow key={r.id} r={r} canEdit={canEdit} onUpdate={handleUpdate} onFinalize={handleFinalize} otMults={otMults} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MySalaryView = () => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [otMults, setOtMults] = useState(DEFAULT_OT_MULTS);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  useEffect(() => {
    getMySalaryAPI().then(r => setRecords(r.data)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
    getOtSettingsAPI()
      .then(({ data }) => setOtMults({
        dailyMultiplier: data.dailyMultiplier,
        sundayMultiplier: data.sundayMultiplier,
        holidayMultiplier: data.holidayMultiplier,
      }))
      .catch(() => {});
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Month','Days / Sundays','Basic Earned','Allowances','OT Amount','Total'].map(h => (
                <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">Loading...</td></tr>
            ) : records.length === 0 ? (
              <tr><td colSpan={6} className="py-8 text-center text-gray-400">No salary records yet</td></tr>
            ) : records.map(r => {
              const bd = computeBreakdown(r, otMults);
              const m = new Date(r.month);
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-800">{months[m.getMonth()]} {m.getFullYear()}</td>
                  <td className="py-3 px-4 text-gray-600">
                    <div className="tabular-nums">{r.presentDays}<span className="text-gray-400">/{r.calendarDays}</span></div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${r.sundayPresentDays > 0 ? 'bg-purple-100 border-purple-300 text-purple-800' : 'bg-purple-50 border-purple-200 text-purple-600'}`}>
                        {r.sundayPresentDays > 0 ? `${r.sundayPresentDays}/` : ''}{sundaysInRecord(r)} Sun
                      </span>
                      {(r.holidayCount > 0 || r.holidayPresentDays > 0) && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border ${r.holidayPresentDays > 0 ? 'bg-orange-100 border-orange-300 text-orange-800' : 'bg-orange-50 border-orange-200 text-orange-600'}`}>
                          {r.holidayPresentDays > 0 ? `${r.holidayPresentDays}/` : ''}{r.holidayCount || 0} Hol
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.earnedBasic)}</td>
                  <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.fixedAllow + bd.extraAllow)}</td>
                  <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.totalOt)}</td>
                  <td className="py-3 px-4 font-bold text-gray-900">{formatCurrency(r.totalAmount)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SalaryTab = ({ isAdmin, canEdit }) => {
  return isAdmin ? <AdminSalaryView canEdit={canEdit} /> : <MySalaryView />;
};

export default SalaryTab;
