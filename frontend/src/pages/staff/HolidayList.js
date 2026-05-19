import React, { useState, useEffect } from 'react';
import { getHolidaysAPI, createHolidayAPI, updateHolidayAPI, deleteHolidayAPI, getOtSettingsAPI, updateOtSettingsAPI } from '../../services/api';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineX, HiChevronDown } from 'react-icons/hi';

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

const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
const dayName = (d) => new Date(d).toLocaleDateString('en-IN', { weekday: 'long' });

const HolidayForm = ({ holiday, onSave, onClose }) => {
  const [form, setForm] = useState({ date: holiday?.date?.slice(0, 10) || '', name: holiday?.name || '' });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (holiday) {
        await updateHolidayAPI(holiday.id, form);
        toast.success('Holiday updated');
      } else {
        await createHolidayAPI(form);
        toast.success('Holiday added');
      }
      onSave();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">{holiday ? 'Edit Holiday' : 'Add Holiday'}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><HiOutlineX className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Date *</label>
            <input required type="date" value={form.date} onChange={e => set('date', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Holiday Name *</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)}
              placeholder="e.g. Diwali, Republic Day..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-primary-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : holiday ? 'Update' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const OtSettingsCard = ({ canEdit }) => {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState({ dailyMultiplier: '', sundayMultiplier: '', holidayMultiplier: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getOtSettingsAPI()
      .then(({ data }) => {
        setSettings(data);
        setForm({
          dailyMultiplier: data.dailyMultiplier,
          sundayMultiplier: data.sundayMultiplier,
          holidayMultiplier: data.holidayMultiplier,
        });
      })
      .catch(() => toast.error('Failed to load OT settings'));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data } = await updateOtSettingsAPI(form);
      setSettings(data);
      toast.success('OT settings saved');
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const rows = [
    { key: 'dailyMultiplier',   label: 'Daily OT',   hint: 'Extra hours on regular weekdays' },
    { key: 'sundayMultiplier',  label: 'Sunday OT',  hint: 'All hours worked on Sundays' },
    { key: 'holidayMultiplier', label: 'Holiday OT', hint: 'All hours worked on holidays' },
  ];

  return (
    <div className="max-w-2xl mt-8">
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
          <div>
            <p className="text-sm font-semibold text-gray-700">OT Rate Settings</p>
            <p className="text-xs text-gray-400 mt-0.5">Multipliers applied on hourly rate for overtime</p>
          </div>
          {canEdit && (
            <button
              onClick={handleSave}
              disabled={saving || !settings}
              className="px-4 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>

        <div className="divide-y divide-gray-100">
          {rows.map(({ key, label, hint }) => (
            <div key={key} className="flex items-center justify-between px-4 py-3 gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800">{label}</p>
                <p className="text-xs text-gray-400">{hint}</p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm text-gray-500">×</span>
                {canEdit ? (
                  <input
                    type="number"
                    min="1"
                    step="0.1"
                    value={form[key]}
                    onChange={e => set(key, e.target.value)}
                    className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right font-semibold text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                ) : (
                  <span className="w-20 px-2 py-1.5 text-right text-sm font-semibold text-gray-900">
                    {settings ? settings[key] : '—'}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const HolidayList = ({ canEdit }) => {
  const confirm = useConfirm();
  const now = new Date();
  const [holidays, setHolidays] = useState([]);
  const [year, setYear] = useState(now.getFullYear());
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editH, setEditH] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await getHolidaysAPI({ year });
      setHolidays(data);
    } catch { toast.error('Failed to load holidays'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [year]);

  const handleDelete = async (h) => {
    const ok = await confirm(`Delete "${h.name}"?`, { title: 'Delete Holiday', confirmLabel: 'Delete', variant: 'danger' });
    if (!ok) return;
    try {
      await deleteHolidayAPI(h.id);
      toast.success('Deleted');
      load();
    } catch { toast.error('Failed'); }
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <NativeSelect value={year} onChange={e => setYear(Number(e.target.value))}>
          {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </NativeSelect>
        {canEdit && (
          <button onClick={() => { setEditH(null); setShowForm(true); }}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium ml-auto">
            <HiOutlinePlus className="w-4 h-4" /> Add Holiday
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Day</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Holiday Name</th>
              {canEdit && <th className="py-3 px-4" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={4} className="py-10 text-center text-gray-400">Loading...</td></tr>
            ) : holidays.length === 0 ? (
              <tr><td colSpan={4} className="py-10 text-center text-gray-400">No holidays for {year}</td></tr>
            ) : holidays.map(h => (
              <tr key={h.id} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-gray-700 font-medium">{fmtDate(h.date)}</td>
                <td className="py-3 px-4 text-gray-500">{dayName(h.date)}</td>
                <td className="py-3 px-4 text-gray-800 font-medium">{h.name}</td>
                {canEdit && (
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => { setEditH(h); setShowForm(true); }}
                        className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg">
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDelete(h)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg">
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <HolidayForm
          holiday={editH}
          onSave={() => { setShowForm(false); load(); }}
          onClose={() => setShowForm(false)}
        />
      )}

      <OtSettingsCard canEdit={canEdit} />
    </div>
  );
};

export default HolidayList;
