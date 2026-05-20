import React, { useState, useEffect, useCallback } from 'react';
import { computeSalaryAPI, getSalaryRecordsAPI, getMySalaryAPI, updateSalaryRecordAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-toastify';
import { formatCurrency } from '../../utils/format';
import { HiOutlinePlus, HiOutlineTrash, HiOutlineDocumentDownload, HiOutlineLockClosed, HiChevronDown } from 'react-icons/hi';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const NativeSelect = ({ value, onChange, children }) => (
  <div className="relative inline-flex items-center">
    <select
      value={value}
      onChange={onChange}
      className="appearance-none pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
    >
      {children}
    </select>
    <HiChevronDown className="pointer-events-none absolute right-2.5 w-4 h-4 text-gray-400" />
  </div>
);

const fmtMin = (m) => { const h = Math.floor(m / 60); const mn = m % 60; return `${h}h ${String(mn).padStart(2, '0')}m`; };

const OT_DAILY = 1.5, OT_SUN = 2.0, OT_HOL = 2.0;

const computeBreakdown = (r) => {
  const basicPerDay = r.basicSalary / r.calendarDays;
  const earnedBasic = basicPerDay * r.presentDays;
  const hourlyRate = r.basicSalary / (r.calendarDays * r.employee.standardHours);
  const dailyOtAmt = (r.dailyOtMinutes / 60) * hourlyRate * OT_DAILY;
  const sundayOtAmt = (r.sundayOtMinutes / 60) * hourlyRate * OT_SUN;
  const holidayOtAmt = (r.holidayOtMinutes / 60) * hourlyRate * OT_HOL;
  const fixedAllow = r.employee.allowances.reduce((s, a) => s + a.amount, 0);
  const extraAllow = (r.extraAllowances || []).reduce((s, a) => s + parseFloat(a.amount || 0), 0);
  return { earnedBasic, dailyOtAmt, sundayOtAmt, holidayOtAmt, fixedAllow, extraAllow, totalOt: dailyOtAmt + sundayOtAmt + holidayOtAmt };
};

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

const SalaryRow = ({ r, canEdit, onUpdate, onFinalize }) => {
  const [expanded, setExpanded] = useState(false);
  const [changing, setChanging] = useState(false);
  const bd = computeBreakdown(r);

  const handleStatusChange = async (newValue) => {
    setChanging(true);
    try {
      await onFinalize(r.id, newValue);
    } finally {
      setChanging(false);
    }
  };

  return (
    <>
      <tr className="hover:bg-gray-50 text-sm cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <td className="py-3 px-4 font-semibold text-primary-600">{r.employee.empNumber}</td>
        <td className="py-3 px-4 font-medium text-gray-800">{r.employee.name}</td>
        <td className="py-3 px-4 text-gray-600">{r.presentDays}/{r.calendarDays}</td>
        <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.earnedBasic)}</td>
        <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.fixedAllow + bd.extraAllow)}</td>
        <td className="py-3 px-4">
          <div className="text-xs space-y-0.5">
            {r.dailyOtMinutes > 0 && <div><span className="text-yellow-600 font-medium">{fmtMin(r.dailyOtMinutes)}</span> <span className="text-gray-400">daily</span></div>}
            {r.sundayOtMinutes > 0 && <div><span className="text-purple-600 font-medium">{fmtMin(r.sundayOtMinutes)}</span> <span className="text-gray-400">sunday</span></div>}
            {r.holidayOtMinutes > 0 && <div><span className="text-red-500 font-medium">{fmtMin(r.holidayOtMinutes)}</span> <span className="text-gray-400">holiday</span></div>}
            {!r.dailyOtMinutes && !r.sundayOtMinutes && !r.holidayOtMinutes && <span className="text-gray-400">—</span>}
          </div>
        </td>
        <td className="py-3 px-4 text-gray-600">{formatCurrency(bd.totalOt)}</td>
        <td className="py-3 px-4 font-bold text-gray-900">{formatCurrency(r.totalAmount)}</td>
        <td className="py-3 px-4">
          {changing
            ? <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full font-semibold animate-pulse">Updating...</span>
            : r.isFinalized
              ? <span className="flex items-center gap-1 text-xs text-green-700 font-semibold bg-green-100 px-2 py-0.5 rounded-full"><HiOutlineLockClosed className="w-3 h-3" />Finalized</span>
              : <span className="text-xs text-yellow-700 bg-yellow-100 px-2 py-0.5 rounded-full font-semibold">Draft</span>}
        </td>
        <td className="py-3 px-4 text-right">
          {canEdit && (
            r.isFinalized ? (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange(false); }}
                disabled={changing}
                className="text-xs bg-yellow-500 hover:bg-yellow-600 text-white px-2.5 py-1 rounded font-medium disabled:opacity-50"
              >
                {changing ? 'Updating...' : 'Revert to Draft'}
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); handleStatusChange(true); }}
                disabled={changing}
                className="text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded font-medium disabled:opacity-50"
              >
                {changing ? 'Updating...' : 'Finalize'}
              </button>
            )
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-blue-50/40">
          <td colSpan={10} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mb-3">
              <div><span className="text-gray-500">Basic Salary:</span> <span className="font-semibold">{formatCurrency(r.basicSalary)}</span></div>
              <div><span className="text-gray-500">Calendar Days:</span> <span className="font-semibold">{r.calendarDays}</span></div>
              <div><span className="text-gray-500">Per Day Rate:</span> <span className="font-semibold">{formatCurrency(r.basicSalary / r.calendarDays)}</span></div>
              <div><span className="text-gray-500">Earned Basic:</span> <span className="font-semibold">{formatCurrency(bd.earnedBasic)}</span></div>
              <div><span className="text-gray-500">Fixed Allow:</span> <span className="font-semibold">{formatCurrency(bd.fixedAllow)}</span></div>
              <div><span className="text-gray-500">Extra Allow:</span> <span className="font-semibold">{formatCurrency(bd.extraAllow)}</span></div>
              <div><span className="text-gray-500">OT Total:</span> <span className="font-semibold text-green-600">{formatCurrency(bd.totalOt)}</span></div>
              <div><span className="text-gray-500">Daily OT:</span> <span className="font-semibold">{formatCurrency(bd.dailyOtAmt)} <span className="text-gray-400">(×1.5)</span></span></div>
              <div><span className="text-gray-500">Sunday OT:</span> <span className="font-semibold">{formatCurrency(bd.sundayOtAmt)} <span className="text-gray-400">(×2.0)</span></span></div>
              <div><span className="text-gray-500">Holiday OT:</span> <span className="font-semibold">{formatCurrency(bd.holidayOtAmt)} <span className="text-gray-400">(×2.0)</span></span></div>
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
    const headers = ['EMP No', 'Name', 'Basic Salary', 'Calendar Days', 'Present Days', 'Earned Basic',
      'Fixed Allow', 'Extra Allow', 'Daily OT Min', 'Sunday OT Min', 'Holiday OT Min', 'OT Amount', 'Total Salary', 'Status'];

    const r2 = (v) => Math.round(v * 100) / 100;
    const rows = records.map(r => {
      const bd = computeBreakdown(r);
      return [r.employee.empNumber, r.employee.name, r2(r.basicSalary), r.calendarDays, r.presentDays,
        r2(bd.earnedBasic), r2(bd.fixedAllow), r2(bd.extraAllow), r.dailyOtMinutes, r.sundayOtMinutes, r.holidayOtMinutes,
        r2(bd.totalOt), r2(r.totalAmount), r.isFinalized ? 'Finalized' : 'Draft'];
    });

    // Totals row — sum numeric columns, blank for non-numeric
    const tot = records.reduce((acc, r) => {
      const bd = computeBreakdown(r);
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

    const totalsRow = ['', 'TOTAL', '', '', '',
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
      const bd = computeBreakdown(r);
      acc.earnedBasic  += bd.earnedBasic;
      acc.allowances   += bd.fixedAllow + bd.extraAllow;
      acc.totalOt      += bd.totalOt;
      acc.totalAmount  += r.totalAmount;
      return acc;
    }, { earnedBasic: 0, allowances: 0, totalOt: 0, totalAmount: 0 });

    autoTable(doc, {
      startY: 25,
      head: [['EMP', 'Name', 'Days', 'Earned Basic', 'Allowances', 'Daily OT', 'Sun OT', 'Hol OT', 'OT Amt', 'Total', 'Status']],
      body: records.map(r => {
        const bd = computeBreakdown(r);
        return [r.employee.empNumber, r.employee.name, `${r.presentDays}/${r.calendarDays}`,
          formatCurrency(bd.earnedBasic), formatCurrency(bd.fixedAllow + bd.extraAllow),
          fmtMin(r.dailyOtMinutes), fmtMin(r.sundayOtMinutes), fmtMin(r.holidayOtMinutes),
          formatCurrency(bd.totalOt), formatCurrency(r.totalAmount), r.isFinalized ? 'Final' : 'Draft'];
      }),
      foot: [[
        '', `TOTAL (${records.length})`, '',
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
        <div className="bg-white rounded-xl border border-gray-200 p-4 flex gap-6">
          <div><p className="text-xs text-gray-400 font-semibold uppercase">Employees</p><p className="text-xl font-bold text-gray-800">{records.length}</p></div>
          <div><p className="text-xs text-gray-400 font-semibold uppercase">Total Payroll</p><p className="text-xl font-bold text-primary-600">{formatCurrency(total)}</p></div>
          <div><p className="text-xs text-gray-400 font-semibold uppercase">Finalized</p><p className="text-xl font-bold text-green-600">{records.filter(r => r.isFinalized).length}/{records.length}</p></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {['EMP No','Name','Days','Earned Basic','Allowances','OT Hours','OT Amount','Total','Status',''].map(h => (
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
                <SalaryRow key={r.id} r={r} canEdit={canEdit} onUpdate={handleUpdate} onFinalize={handleFinalize} />
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
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  useEffect(() => {
    getMySalaryAPI().then(r => setRecords(r.data)).catch(() => toast.error('Failed to load')).finally(() => setLoading(false));
  }, []);

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {['Month','Days Present','Basic Earned','Allowances','OT Amount','Total'].map(h => (
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
              const bd = computeBreakdown(r);
              const m = new Date(r.month);
              return (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-800">{months[m.getMonth()]} {m.getFullYear()}</td>
                  <td className="py-3 px-4 text-gray-600">{r.presentDays}/{r.calendarDays}</td>
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
