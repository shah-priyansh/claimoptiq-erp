import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  clockInAPI, clockOutAPI, getTodayAttendanceAPI,
  getMyAttendanceAPI, getAllAttendanceAPI, addAttendanceAPI, addMyAttendanceAPI, deleteAttendanceRecordAPI,
  getEmployeesAPI, getHolidaysAPI,
} from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlineClock, HiOutlineCheck, HiOutlineExclamation, HiChevronDown } from 'react-icons/hi';
import SearchableSelect from '../../components/ui/SearchableSelect';

const NativeSelect = ({ value, onChange, children, className = '' }) => (
  <div className={`relative inline-flex items-center ${className}`}>
    <select
      value={value}
      onChange={onChange}
      className="appearance-none bg-none w-full pl-3 pr-8 py-2 border border-gray-300 rounded-lg text-sm bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 cursor-pointer"
    >
      {children}
    </select>
    <HiChevronDown className="pointer-events-none absolute right-2.5 w-4 h-4 text-gray-400" />
  </div>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Always display in IST (UTC+5:30) regardless of browser timezone
const toIST = (dt) => {
  const d = new Date(new Date(dt).getTime() + 330 * 60 * 1000);
  return { h: d.getUTCHours(), m: d.getUTCMinutes() };
};

const fmtTime = (dt) => {
  if (!dt) return '—';
  const { h, m } = toIST(dt);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
};

const fmtMinutes = (mins) => {
  if (mins == null || mins <= 0) return '—';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
};

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const getOtTypeLocal = (date, holidays) => {
  if (date.getDay() === 0) return 'sunday';
  const ds = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  if (holidays.some(h => h.date?.slice(0, 10) === ds)) return 'holiday';
  return 'daily';
};

const computeDuration = (inStr, outStr, standardHours) => {
  if (!inStr || !outStr) return { totalMinutes: null, extraMinutes: null };
  const [ih, im] = inStr.split(':').map(Number);
  const [oh, om] = outStr.split(':').map(Number);
  const total = (oh * 60 + om) - (ih * 60 + im);
  if (total <= 0) return { totalMinutes: null, extraMinutes: null };
  const extra = Math.max(0, total - Math.round(standardHours * 60));
  return { totalMinutes: total, extraMinutes: extra };
};

const OT_BADGE = {
  sunday:  { label: 'Sunday OT',  cls: 'bg-purple-100 text-purple-700' },
  holiday: { label: 'Holiday OT', cls: 'bg-orange-100 text-orange-700' },
  daily:   { label: 'Daily OT',   cls: 'bg-yellow-100 text-yellow-700' },
};

// ── Monthly attendance grid (admin) ──────────────────────────────────────────

const MonthGrid = ({ employee, month, year, holidays, fetchFn, saveFn, deleteFn }) => {
  const [records, setRecords] = useState([]);
  const [rows, setRows] = useState([]);
  const [savingIdx, setSavingIdx] = useState({});
  const [savedIdx, setSavedIdx] = useState({});
  const timerRef = useRef({});

  // Fetch records only when employee/month/year changes
  useEffect(() => {
    const fetcher = fetchFn
      ? fetchFn({ month, year })
      : getAllAttendanceAPI({ employeeId: employee.id, month, year }).then(r => r.data);
    fetcher.then(setRecords).catch(() => toast.error('Failed to load attendance'));
  }, [employee.id, month, year, fetchFn]);

  // Rebuild rows whenever records or holidays change (no extra fetch)
  useEffect(() => {
    const total = daysInMonth(year, month);
    setRows(Array.from({ length: total }, (_, i) => {
      const date = new Date(year, month - 1, i + 1);
      const ds = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      const rec = records.find(r => r.date?.slice(0, 10) === ds);
      const isSunday = date.getDay() === 0;
      const isHoliday = holidays.some(h => h.date?.slice(0, 10) === ds);
      const holidayName = holidays.find(h => h.date?.slice(0, 10) === ds)?.name || null;
      const toISTStr = (dt) => {
        const { h, m } = toIST(dt);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      };
      return {
        date,
        ds,
        dayName: DAY_NAMES[date.getDay()],
        inTime:  rec?.inTime  ? toISTStr(rec.inTime)  : '',
        outTime: rec?.outTime ? toISTStr(rec.outTime) : '',
        totalMinutes:  rec?.totalMinutes  ?? null,
        extraMinutes:  rec?.extraMinutes  ?? null,
        otType:        rec?.otType || (isSunday ? 'sunday' : isHoliday ? 'holiday' : 'none'),
        recordId:      rec?.id || null,
        isSunday,
        isHoliday,
        holidayName,
        isDirty: false,
      };
    }));
  }, [records, holidays, year, month]);

  const updateRow = (idx, field, value) => {
    setRows(prev => {
      const next = [...prev];
      const row = { ...next[idx], [field]: value, isDirty: true };
      // Recompute duration whenever either time changes
      const { totalMinutes, extraMinutes } = computeDuration(
        field === 'inTime' ? value : row.inTime,
        field === 'outTime' ? value : row.outTime,
        employee.standardHours
      );
      row.totalMinutes = totalMinutes;
      row.extraMinutes = extraMinutes;
      // Set OT type from local detection if extra hours exist
      if (row.inTime) {
        const baseOt = getOtTypeLocal(row.date, holidays);
        row.otType = (extraMinutes > 0 || baseOt !== 'daily') ? baseOt : 'none';
      }
      next[idx] = row;
      return next;
    });
  };

  const saveRow = useCallback(async (idx) => {
    const row = rows[idx];
    if (!row || !row.isDirty) return;

    // In time cleared: delete the existing record (if any)
    if (!row.inTime) {
      if (!row.recordId) {
        setRows(prev => {
          const next = [...prev];
          next[idx] = { ...next[idx], isDirty: false };
          return next;
        });
        return;
      }
      const doDelete = deleteFn || deleteAttendanceRecordAPI;
      setSavingIdx(s => ({ ...s, [idx]: true }));
      try {
        await doDelete(row.recordId);
        setRows(prev => {
          const next = [...prev];
          const r = next[idx];
          next[idx] = {
            ...r,
            recordId: null,
            totalMinutes: null,
            extraMinutes: null,
            otType: r.isSunday ? 'sunday' : r.isHoliday ? 'holiday' : 'none',
            isDirty: false,
          };
          return next;
        });
        setSavedIdx(s => ({ ...s, [idx]: true }));
        clearTimeout(timerRef.current[idx]);
        timerRef.current[idx] = setTimeout(() => {
          setSavedIdx(s => { const n = { ...s }; delete n[idx]; return n; });
        }, 2000);
      } catch (err) {
        toast.error(err.response?.data?.message || 'Failed to delete');
      } finally {
        setSavingIdx(s => { const n = { ...s }; delete n[idx]; return n; });
      }
      return;
    }

    setSavingIdx(s => ({ ...s, [idx]: true }));
    try {
      const inDateTime  = `${row.ds}T${row.inTime}:00+05:30`;
      const outDateTime = row.outTime ? `${row.ds}T${row.outTime}:00+05:30` : null;
      const payload = { date: row.ds, inTime: inDateTime, outTime: outDateTime };
      const doSave = saveFn || ((p) => addAttendanceAPI({ employeeId: employee.id, ...p }));
      const { data } = await doSave(payload);
      setRows(prev => {
        const next = [...prev];
        next[idx] = { ...next[idx], recordId: data.id, isDirty: false };
        return next;
      });
      setSavedIdx(s => ({ ...s, [idx]: true }));
      clearTimeout(timerRef.current[idx]);
      timerRef.current[idx] = setTimeout(() => {
        setSavedIdx(s => { const n = { ...s }; delete n[idx]; return n; });
      }, 2000);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally {
      setSavingIdx(s => { const n = { ...s }; delete n[idx]; return n; });
    }
  }, [rows, employee.id, saveFn, deleteFn]);

  const handleBlur = (idx) => saveRow(idx);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase w-10">#</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase w-28">Date</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase w-16">Day</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase w-36">In Time</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase w-36">Out Time</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase">Duty Hours</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase">OT / Short Hrs</th>
              <th className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase">OT</th>
              <th className="py-2.5 px-3 w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isToday = row.ds === todayStr;
              const isFuture = row.date > today;
              const bg = row.isSunday
                ? 'bg-purple-50 hover:bg-purple-100/60'
                : row.isHoliday
                ? 'bg-orange-50 hover:bg-orange-100/60'
                : isToday
                ? 'bg-blue-50 hover:bg-blue-100/60'
                : 'hover:bg-gray-50';
              const badge = row.otType !== 'none' && row.inTime ? OT_BADGE[row.otType] : null;

              return (
                <tr key={row.ds} className={`border-b border-gray-100 transition-colors ${bg} ${isFuture ? 'opacity-40' : ''}`}>
                  <td className="py-1.5 px-4 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  <td className="py-1.5 px-4 text-gray-700 font-medium text-xs whitespace-nowrap">
                    {row.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    {isToday && <span className="ml-1.5 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-semibold">TODAY</span>}
                    {row.isHoliday && <div className="text-[10px] text-orange-600 font-medium mt-0.5">{row.holidayName}</div>}
                  </td>
                  <td className={`py-1.5 px-4 text-xs font-semibold ${row.isSunday ? 'text-purple-600' : 'text-gray-500'}`}>
                    {row.dayName}
                  </td>
                  <td className="py-1 px-3">
                    {isFuture ? (
                      <span className="text-gray-300 text-xs px-2">—</span>
                    ) : (
                      <input
                        type="time"
                        value={row.inTime}
                        onChange={e => updateRow(idx, 'inTime', e.target.value)}
                        onBlur={() => handleBlur(idx)}
                        className="w-32 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                      />
                    )}
                  </td>
                  <td className="py-1 px-3">
                    {isFuture ? (
                      <span className="text-gray-300 text-xs px-2">—</span>
                    ) : (
                      <input
                        type="time"
                        value={row.outTime}
                        onChange={e => updateRow(idx, 'outTime', e.target.value)}
                        onBlur={() => handleBlur(idx)}
                        className="w-32 px-2 py-1 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white"
                      />
                    )}
                  </td>
                  <td className="py-1.5 px-4 text-gray-600 text-xs font-medium">
                    {row.totalMinutes ? fmtMinutes(row.totalMinutes) : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-1.5 px-4 text-xs font-medium">
                    {row.extraMinutes > 0 ? (
                      <span className="text-green-600">+{fmtMinutes(row.extraMinutes)}</span>
                    ) : row.totalMinutes != null && row.totalMinutes < Math.round(employee.standardHours * 60) ? (
                      <span className="text-red-500">-{fmtMinutes(Math.round(employee.standardHours * 60) - row.totalMinutes)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-1.5 px-4">
                    {badge
                      ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                  <td className="py-1.5 px-3 text-center">
                    {savingIdx[idx] && (
                      <div className="w-3.5 h-3.5 border-2 border-gray-300 border-t-primary-500 rounded-full animate-spin inline-block" />
                    )}
                    {savedIdx[idx] && !savingIdx[idx] && (
                      <HiOutlineCheck className="w-4 h-4 text-green-500 inline-block" />
                    )}
                    {row.isDirty && !savingIdx[idx] && !savedIdx[idx] && (
                      <div className="w-2 h-2 bg-yellow-400 rounded-full inline-block" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="px-4 py-2.5 border-t border-gray-100 bg-gray-50/50 flex items-center gap-4 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-purple-100 border border-purple-200 inline-block" /> Sunday</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-orange-100 border border-orange-200 inline-block" /> Holiday</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-100 border border-blue-200 inline-block" /> Today</span>
        <span className="flex items-center gap-1.5"><div className="w-2 h-2 bg-yellow-400 rounded-full" /> Unsaved</span>
        <span className="flex items-center gap-1.5"><HiOutlineCheck className="w-3.5 h-3.5 text-green-500" /> Saved</span>
        <span className="ml-auto italic">Changes save automatically on blur</span>
      </div>
    </div>
  );
};

// ── Admin view ────────────────────────────────────────────────────────────────

const AdminAttendanceView = () => {
  const now = new Date();
  const [employees, setEmployees] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [employeesLoading, setEmployeesLoading] = useState(true);

  useEffect(() => {
    setEmployeesLoading(true);
    getEmployeesAPI({ active: 'true' })
      .then(r => setEmployees(r.data))
      .catch(() => {})
      .finally(() => setEmployeesLoading(false));
  }, []);

  useEffect(() => {
    getHolidaysAPI({ year }).then(r => setHolidays(r.data)).catch(() => {});
  }, [year]);

  const selectedEmployee = employees.find(e => e.id === selectedId);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-64">
          <SearchableSelect
            options={employees.map(e => ({ value: e.id, label: `${e.empNumber} — ${e.name}` }))}
            value={selectedId}
            onChange={setSelectedId}
            placeholder="Select employee..."
            searchPlaceholder="Search employee..."
            allowClear
            isLoading={employeesLoading}
          />
        </div>
        <NativeSelect value={month} onChange={e => setMonth(Number(e.target.value))}>
          {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </NativeSelect>
        <NativeSelect value={year} onChange={e => setYear(Number(e.target.value))}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </NativeSelect>
        {selectedEmployee && (
          <div className="ml-2 text-sm text-gray-600">
            <span className="font-semibold text-gray-800">{selectedEmployee.name}</span>
            <span className="text-gray-400 ml-2">{selectedEmployee.shiftStart}–{selectedEmployee.shiftEnd} · {selectedEmployee.standardHours}h/day</span>
          </div>
        )}
      </div>

      {!selectedId ? (
        <div className="bg-white rounded-xl border border-gray-200 py-16 text-center text-gray-400">
          <HiOutlineClock className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="text-sm font-medium">Select an employee to view and enter attendance</p>
          <p className="text-xs mt-1">All days of the month will be shown as an editable grid</p>
        </div>
      ) : (
        <MonthGrid
          key={`${selectedId}-${month}-${year}`}
          employee={selectedEmployee}
          month={month}
          year={year}
          holidays={holidays}
          deleteFn={deleteAttendanceRecordAPI}
        />
      )}
    </div>
  );
};

// ── Employee self-service view ────────────────────────────────────────────────

const MyAttendanceView = () => {
  const [today, setToday] = useState(null);
  const [employee, setEmployee] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [clocking, setClocking] = useState(false);
  const now = new Date();
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());

  const loadToday = useCallback(async () => {
    try {
      const { data } = await getTodayAttendanceAPI();
      setToday(data.record);
      setEmployee(data.employee);
    } catch { }
  }, []);

  useEffect(() => { loadToday(); }, [loadToday]);
  useEffect(() => {
    getHolidaysAPI({ year: selYear }).then(r => setHolidays(r.data)).catch(() => {});
  }, [selYear]);

  const handleClockIn = async () => {
    setClocking(true);
    try { await clockInAPI(); toast.success('Clocked in'); loadToday(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setClocking(false); }
  };

  const handleClockOut = async () => {
    setClocking(true);
    try { await clockOutAPI(); toast.success('Clocked out'); loadToday(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed'); }
    finally { setClocking(false); }
  };

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  return (
    <div className="space-y-6">
      {/* Today clock-in/out card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <HiOutlineClock className="w-5 h-5 text-primary-600" />
          <h3 className="font-semibold text-gray-800">Today</h3>
          <span className="text-sm text-gray-400">
            {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[130px] bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">In Time</p>
            <p className="text-lg font-bold text-gray-800">{today ? fmtTime(today.inTime) : '—'}</p>
          </div>
          <div className="flex-1 min-w-[130px] bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Out Time</p>
            <p className="text-lg font-bold text-gray-800">{today?.outTime ? fmtTime(today.outTime) : '—'}</p>
          </div>
          <div className="flex-1 min-w-[130px] bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Duty Hours</p>
            <p className="text-lg font-bold text-gray-800">{today?.totalMinutes ? fmtMinutes(today.totalMinutes) : '—'}</p>
          </div>
          <div className="flex-1 min-w-[130px] bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide mb-1">Extra Hours</p>
            <p className={`text-lg font-bold ${today?.extraMinutes > 0 ? 'text-green-600' : 'text-gray-800'}`}>
              {today?.extraMinutes > 0 ? fmtMinutes(today.extraMinutes) : '—'}
            </p>
          </div>
          <div>
            {!today
              ? <button onClick={handleClockIn} disabled={clocking}
                  className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {clocking ? '...' : 'Clock In'}
                </button>
              : !today.outTime
              ? <button onClick={handleClockOut} disabled={clocking}
                  className="px-6 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium text-sm disabled:opacity-50">
                  {clocking ? '...' : 'Clock Out'}
                </button>
              : <span className="px-4 py-2.5 bg-gray-100 text-gray-500 rounded-lg text-sm font-medium">Day Complete</span>}
          </div>
        </div>
      </div>

      {/* Monthly attendance grid (editable) */}
      {employee && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h3 className="font-semibold text-gray-700 text-sm">Attendance</h3>
            <NativeSelect value={selMonth} onChange={e => setSelMonth(Number(e.target.value))}>
              {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </NativeSelect>
            <NativeSelect value={selYear} onChange={e => setSelYear(Number(e.target.value))}>
              {[now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
            </NativeSelect>
          </div>
          <MonthGrid
            key={`${employee.id}-${selMonth}-${selYear}`}
            employee={employee}
            month={selMonth}
            year={selYear}
            holidays={holidays}
            fetchFn={({ month, year }) => getMyAttendanceAPI({ month, year }).then(r => r.data.records)}
            saveFn={addMyAttendanceAPI}
          />
        </div>
      )}
    </div>
  );
};

// ── Read-only grid for employee self-service ──────────────────────────────────

const ReadOnlyMonthGrid = ({ employee, month, year, holidays }) => {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    getMyAttendanceAPI({ month, year }).then(({ data }) => {
      const total = daysInMonth(year, month);
      setRows(Array.from({ length: total }, (_, i) => {
        const date = new Date(year, month - 1, i + 1);
        const ds = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
        const rec = data.records?.find(r => r.date?.slice(0, 10) === ds);
        const isSunday = date.getDay() === 0;
        const isHoliday = holidays.some(h => h.date?.slice(0, 10) === ds);
        const holidayName = holidays.find(h => h.date?.slice(0, 10) === ds)?.name || null;
        return { date, ds, dayName: DAY_NAMES[date.getDay()], rec, isSunday, isHoliday, holidayName };
      }));
    }).catch(() => {});
  }, [employee.id, month, year, holidays]);

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {['#', 'Date', 'Day', 'In Time', 'Out Time', 'Duty Hours', 'OT / Short Hrs', 'OT'].map(h => (
                <th key={h} className="text-left py-2.5 px-4 text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isToday = row.ds === todayStr;
              const bg = row.isSunday ? 'bg-purple-50' : row.isHoliday ? 'bg-orange-50' : isToday ? 'bg-blue-50' : 'hover:bg-gray-50';
              const otType = row.rec?.otType;
              const badge = otType && otType !== 'none' ? OT_BADGE[otType] : null;
              return (
                <tr key={row.ds} className={`border-b border-gray-100 ${bg}`}>
                  <td className="py-2 px-4 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  <td className="py-2 px-4 text-xs font-medium text-gray-700 whitespace-nowrap">
                    {row.date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    {isToday && <span className="ml-1.5 text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-semibold">TODAY</span>}
                    {row.isHoliday && <div className="text-[10px] text-orange-600 font-medium">{row.holidayName}</div>}
                  </td>
                  <td className={`py-2 px-4 text-xs font-semibold ${row.isSunday ? 'text-purple-600' : 'text-gray-500'}`}>{row.dayName}</td>
                  <td className="py-2 px-4 text-gray-700 text-xs">{row.rec ? fmtTime(row.rec.inTime) : <span className="text-gray-300">—</span>}</td>
                  <td className="py-2 px-4 text-gray-700 text-xs">{row.rec?.outTime ? fmtTime(row.rec.outTime) : <span className="text-gray-300">—</span>}</td>
                  <td className="py-2 px-4 text-xs text-gray-600">{row.rec?.totalMinutes ? fmtMinutes(row.rec.totalMinutes) : <span className="text-gray-300">—</span>}</td>
                  <td className="py-2 px-4 text-xs font-medium">
                    {row.rec?.extraMinutes > 0 ? (
                      <span className="text-green-600">+{fmtMinutes(row.rec.extraMinutes)}</span>
                    ) : row.rec?.totalMinutes != null && row.rec.totalMinutes < Math.round(employee.standardHours * 60) ? (
                      <span className="text-red-500">-{fmtMinutes(Math.round(employee.standardHours * 60) - row.rec.totalMinutes)}</span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2 px-4">
                    {badge
                      ? <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${badge.cls}`}>{badge.label}</span>
                      : <span className="text-gray-300 text-xs">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Export ────────────────────────────────────────────────────────────────────

const AttendanceTab = ({ isAdmin }) => {
  return isAdmin ? <AdminAttendanceView /> : <MyAttendanceView />;
};

export default AttendanceTab;
