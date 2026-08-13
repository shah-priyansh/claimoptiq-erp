import React, { useState, useEffect } from 'react';
import Loader from '../../components/ui/Loader';
import { getClaimStatusesAPI, createClaimStatusAPI, updateClaimStatusAPI, deleteClaimStatusAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { toast } from 'react-toastify';
import {
  HiOutlinePlus, HiOutlinePencil, HiOutlineTrash,
  HiOutlineLockClosed, HiOutlineX, HiOutlineCheck, HiOutlineDownload
} from 'react-icons/hi';
import Toggle from '../../components/ui/Toggle';
import { exportRowsXlsx } from '../reports/reportUtils';

// Preset swatches offered as quick-picks in the color picker. Each `key`
// doubles as the legacy value stored for statuses created before the picker
// existed, so this name -> hex map keeps those old rows rendering correctly.
// Hex values are the Tailwind -500 shades the presets used to map to.
const COLOR_OPTIONS = [
  { key: 'blue',    hex: '#3b82f6' },
  { key: 'green',   hex: '#22c55e' },
  { key: 'red',     hex: '#ef4444' },
  { key: 'yellow',  hex: '#eab308' },
  { key: 'purple',  hex: '#a855f7' },
  { key: 'orange',  hex: '#f97316' },
  { key: 'pink',    hex: '#ec4899' },
  { key: 'indigo',  hex: '#6366f1' },
  { key: 'teal',    hex: '#14b8a6' },
  { key: 'cyan',    hex: '#06b6d4' },
  { key: 'sky',     hex: '#0ea5e9' },
  { key: 'emerald', hex: '#10b981' },
  { key: 'lime',    hex: '#84cc16' },
  { key: 'amber',   hex: '#f59e0b' },
  { key: 'rose',    hex: '#f43f5e' },
  { key: 'fuchsia', hex: '#d946ef' },
  { key: 'violet',  hex: '#8b5cf6' },
  { key: 'gray',    hex: '#6b7280' },
];

const NAMED_COLOR_HEX = Object.fromEntries(COLOR_OPTIONS.map(c => [c.key, c.hex]));

// Resolve a stored status color to a normalized 6-digit hex. Accepts both the
// new picker values (`#rrggbb` / `#rgb`) and the legacy named keys (blue,
// green, …) so historical rows keep their colors.
export const hexFromStatusColor = (color) => {
  if (typeof color === 'string') {
    const v = color.trim();
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
    if (m) {
      let hx = m[1];
      if (hx.length === 3) hx = hx.split('').map(c => c + c).join('');
      return ('#' + hx).toLowerCase();
    }
    if (NAMED_COLOR_HEX[v]) return NAMED_COLOR_HEX[v];
  }
  return NAMED_COLOR_HEX.gray;
};

const hexToHsl = (color) => {
  const hex = hexFromStatusColor(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  let s = 0, h = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
};

// Inline style for a status pill: a pastel tint + dark, readable text derived
// from any hue — mirrors the old Tailwind `bg-*-100 text-*-700` pairing so
// pills look consistent whether the color is a preset or a custom pick.
export const statusBadgeStyle = (color) => {
  const { h, s } = hexToHsl(color);
  return {
    backgroundColor: `hsl(${h} ${Math.min(s, 92)}% 93%)`,
    color: `hsl(${h} ${Math.min(s, 90)}% 32%)`,
  };
};

// Inline colors for a dashboard status card (accent bar / background / label /
// number), mirroring the old `-500 / -50 / -700 / -800` shade ramp.
export const statusCardStyle = (color) => {
  const { h, s } = hexToHsl(color);
  return {
    bar:  `hsl(${h} ${Math.min(s, 90)}% 55%)`,
    bg:   `hsl(${h} ${Math.min(s, 85)}% 97%)`,
    text: `hsl(${h} ${Math.min(s, 90)}% 34%)`,
    num:  `hsl(${h} ${Math.min(s, 90)}% 27%)`,
  };
};

// Claim types a status can be restricted to. Values match Claim.claimType.
export const CLAIM_TYPE_OPTIONS = [
  { value: 'cashless',          label: 'Cashless' },
  { value: 'cashless_anywhere', label: 'Cashless Anywhere' },
  { value: 'reimbursement',     label: 'Reimbursement' },
  { value: 'grievance',         label: 'Grievance' },
];
export const CLAIM_TYPE_LABEL = Object.fromEntries(CLAIM_TYPE_OPTIONS.map(o => [o.value, o.label]));

// A status is selectable for a claim when it has no claim-type restriction
// (empty = universal) or explicitly lists the claim's type.
export const statusAppliesToType = (status, claimType) => {
  const list = Array.isArray(status?.claimTypes) ? status.claimTypes : [];
  return list.length === 0 || list.includes(claimType);
};

// Toggle-pill selector for claim types. Empty selection = "applies to all".
const ClaimTypeSelector = ({ value, onChange }) => {
  const list = Array.isArray(value) ? value : [];
  const toggle = (v) => {
    if (list.includes(v)) onChange(list.filter(x => x !== v));
    else onChange([...list, v]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {CLAIM_TYPE_OPTIONS.map(o => {
        const active = list.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => toggle(o.value)}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
              active
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400 hover:text-primary-700'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

const emptyForm = { label: '', slug: '', color: '#3b82f6', order: '', claimTypes: [] };

const Modal = ({ title, form, setForm, onSave, onClose, saving }) => {
  const handleLabelChange = (val) => {
    setForm(f => ({
      ...f,
      label: val,
      slug: f._id ? f.slug : val.toLowerCase().replace(/\s+/g, '_'),
    }));
  };

  const pickedHex = hexFromStatusColor(form.color);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white rounded-t-2xl sm:rounded-xl shadow-xl w-full sm:max-w-md max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white rounded-t-2xl sm:rounded-t-xl flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-800">{title}</h2>
          <button onClick={onClose} className="p-2.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
            <input
              value={form.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. Under Review"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              value={form.slug}
              onChange={(e) => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/\s+/g, '_') }))}
              placeholder="e.g. under_review"
              disabled={form.isSystem}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 font-mono disabled:bg-gray-50 disabled:text-gray-400"
            />
            <p className="text-xs text-gray-400 mt-1">Used internally — cannot be changed after creation</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Color</label>
            <div className="flex items-center gap-3">
              {/* Native color picker — click the swatch to pick any color */}
              <label
                className="relative w-11 h-11 rounded-lg border border-gray-300 shadow-sm cursor-pointer flex-shrink-0 overflow-hidden"
                style={{ backgroundColor: pickedHex }}
                title="Pick a color"
              >
                <input
                  type="color"
                  value={pickedHex}
                  onChange={(e) => setForm(f => ({ ...f, color: e.target.value }))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </label>
              {/* Hex value, editable directly */}
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">#</span>
                <input
                  value={pickedHex.replace('#', '').toUpperCase()}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
                    setForm(f => ({ ...f, color: '#' + v }));
                  }}
                  placeholder="3B82F6"
                  maxLength={6}
                  className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm font-mono uppercase focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>
            </div>
            {/* Preset quick-picks */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {COLOR_OPTIONS.map(c => {
                const active = pickedHex === c.hex;
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, color: c.hex }))}
                    title={c.key}
                    className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${active ? 'ring-2 ring-offset-1 ring-gray-800' : 'ring-1 ring-black/10'}`}
                    style={{ backgroundColor: c.hex }}
                  />
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Display Order</label>
            <input
              type="number"
              value={form.order}
              onChange={(e) => setForm(f => ({ ...f, order: e.target.value }))}
              placeholder="e.g. 7"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Claim Types</label>
            <ClaimTypeSelector
              value={form.claimTypes}
              onChange={(claimTypes) => setForm(f => ({ ...f, claimTypes }))}
            />
            <p className="text-xs text-gray-400 mt-1.5">Leave empty to make this status available for all claim types.</p>
          </div>

          {/* Preview */}
          {form.label && (
            <div className="pt-2">
              <p className="text-xs text-gray-500 mb-2">Preview:</p>
              <span className="px-2.5 py-1 rounded-full text-xs font-medium capitalize" style={statusBadgeStyle(form.color)}>
                {form.label}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving || !form.label.trim()}
            className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50">
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ClaimStatusMaster = () => {
  const { can } = useAuth();
  const confirm = useConfirm();
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [modal, setModal] = useState(null); // null | 'create' | 'edit'
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const fetch = async () => {
    try {
      const { data } = await getClaimStatusesAPI();
      setStatuses(data);
    } catch { toast.error('Failed to fetch statuses'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetch(); }, []);

  const openCreate = () => { setForm(emptyForm); setModal('create'); };
  const openEdit = (s) => { setForm({ ...s, color: hexFromStatusColor(s.color), order: s.order ?? '', claimTypes: Array.isArray(s.claimTypes) ? s.claimTypes : [] }); setModal('edit'); };
  const closeModal = () => { setModal(null); setForm(emptyForm); };

  const handleSave = async () => {
    if (!form.label.trim()) return toast.error('Label is required');
    setSaving(true);
    const color = hexFromStatusColor(form.color); // normalize half-typed hex before persisting
    try {
      if (modal === 'create') {
        await createClaimStatusAPI({ label: form.label, slug: form.slug, color, order: form.order || undefined, claimTypes: form.claimTypes });
        toast.success('Status created');
      } else {
        await updateClaimStatusAPI(form._id, { label: form.label, color, order: form.order || undefined, claimTypes: form.claimTypes });
        toast.success('Status updated');
      }
      closeModal();
      fetch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save');
    } finally { setSaving(false); }
  };

  const handleToggleActive = async (s) => {
    setTogglingId(s._id);
    try {
      await updateClaimStatusAPI(s._id, { isActive: !s.isActive });
      toast.success(`Status ${s.isActive ? 'deactivated' : 'activated'}`);
      fetch();
    } catch { toast.error('Failed to update'); }
    finally { setTogglingId(null); }
  };

  const handleDelete = async (s) => {
    if (!await confirm(`Delete status "${s.label}"?`, { title: 'Delete Status', confirmLabel: 'Delete' })) return;
    try {
      await deleteClaimStatusAPI(s._id);
      toast.success('Status deleted');
      fetch();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to delete');
    }
  };

  // Export the status list so users know exactly what to type in the Status
  // column of the claim import file. The importer accepts either the slug or
  // the display label; the Active column flags which statuses are usable.
  const handleExport = () => {
    exportRowsXlsx(
      statuses,
      [
        { label: 'Status Slug (use this in import Status column)', field: 'slug' },
        { label: 'Display Label', field: 'label' },
        {
          label: 'Claim Types',
          field: 'claimTypes',
          format: (v) => {
            const list = Array.isArray(v) ? v : [];
            return list.length === 0 ? 'All' : list.map((ct) => CLAIM_TYPE_LABEL[ct] || ct).join(', ');
          },
        },
        { label: 'Active', field: 'isActive', format: (v) => (v ? 'Yes' : 'No') },
      ],
      'claim_statuses'
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-4 mb-6">
        <button
          onClick={handleExport}
          disabled={loading || statuses.length === 0}
          title="Download the status list to reference when preparing an import file"
          className="flex items-center gap-2 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <HiOutlineDownload className="w-4 h-4" /> Export
        </button>
        {can('claim_statuses', 'create') && (
          <button
            onClick={openCreate}
            className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
          >
            <HiOutlinePlus className="w-4 h-4" /> Add Status
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase w-12">Order</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Slug</th>
              <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Claim Types</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Active</th>
              <th className="text-center py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="py-8"><Loader label="Loading…" /></td></tr>
            ) : statuses.length === 0 ? (
              <tr><td colSpan={7} className="py-10 text-center text-gray-400">No statuses found. Run seed to add defaults.</td></tr>
            ) : statuses.map((s) => (
              <tr key={s._id} className="hover:bg-gray-50">
                <td className="py-3 px-4 text-sm text-gray-400 font-mono">{s.order}</td>
                <td className="py-3 px-4">
                  <span className="px-2.5 py-1 rounded-full text-xs font-medium capitalize" style={statusBadgeStyle(s.color)}>
                    {s.label}
                  </span>
                </td>
                <td className="py-3 px-4 text-sm text-gray-500 font-mono">{s.slug}</td>
                <td className="py-3 px-4">
                  {(() => {
                    const list = Array.isArray(s.claimTypes) ? s.claimTypes : [];
                    if (list.length === 0) return <span className="text-xs text-gray-400 italic">All types</span>;
                    return (
                      <div className="flex flex-wrap gap-1">
                        {list.map(ct => (
                          <span key={ct} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">
                            {CLAIM_TYPE_LABEL[ct] || ct}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </td>
                <td className="py-3 px-4 text-center">
                  <Toggle checked={s.isActive} onChange={() => handleToggleActive(s)} loading={togglingId === s._id} size="sm" />
                </td>
                <td className="py-3 px-4 text-center">
                  {s.isSystem ? (
                    <span className="inline-flex items-center gap-1 text-xs text-gray-400">
                      <HiOutlineLockClosed className="w-3.5 h-3.5" /> System
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">Custom</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center justify-end gap-1">
                    {can('claim_statuses', 'edit') && (
                      <button onClick={() => openEdit(s)}
                        className="p-1.5 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors">
                        <HiOutlinePencil className="w-4 h-4" />
                      </button>
                    )}
                    {can('claim_statuses', 'delete') && !s.isSystem && (
                      <button onClick={() => handleDelete(s)}
                        className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                        <HiOutlineTrash className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <Modal
          title={modal === 'create' ? 'Add New Status' : 'Edit Status'}
          form={form}
          setForm={setForm}
          onSave={handleSave}
          onClose={closeModal}
          saving={saving}
        />
      )}
    </div>
  );
};

export default ClaimStatusMaster;
