import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX, HiOutlineSearch, HiOutlineCog } from 'react-icons/hi';
import { toast } from 'react-toastify';
import { getPublicStatsAPI, updateSiteSettingsAPI } from '../../services/api';

// Mirror of backend/utils/invoiceSummaryFields.js — keep keys/labels/groups in sync.
const FIELD_DEFS = [
  // Patient
  { key: 'patientName',  label: 'Patient Name',  group: 'Patient' },
  { key: 'doctorName',   label: 'Doctor Name',   group: 'Patient' },
  { key: 'patientMobile',label: 'Patient Mobile',group: 'Patient' },
  { key: 'claimType',    label: 'Claim Type',    group: 'Patient' },
  { key: 'policyNo',     label: 'Policy No',     group: 'Patient' },
  { key: 'clientId',     label: 'Client ID',     group: 'Patient' },
  { key: 'directPatient',label: 'Direct Patient',group: 'Patient' },

  // Hospital
  { key: 'hospital',     label: 'Hospital',      group: 'Hospital' },

  // Payor
  { key: 'insuranceCompany', label: 'Company Name', group: 'Payor' },
  { key: 'tpa',              label: 'TPA Name',     group: 'Payor' },
  { key: 'ccnNo',            label: 'CCN No',       group: 'Payor' },

  // Treatment
  { key: 'treatmentType',label: 'Treatment Type',group: 'Treatment' },
  { key: 'diagnosis',    label: 'Diagnosis',     group: 'Treatment' },
  { key: 'surgeryName',  label: 'Surgery Name',  group: 'Treatment' },

  // Dates
  { key: 'month',             label: 'Month',                group: 'Dates' },
  { key: 'dateOfAdmit',       label: 'D.O.A.',               group: 'Dates' },
  { key: 'dateOfDischarge',   label: 'D.O.D.',               group: 'Dates' },
  { key: 'finalApprovalDate', label: 'Final Approval Date',  group: 'Dates' },
  { key: 'fileReceivedDate',  label: 'File Received Date',   group: 'Dates' },
  { key: 'settlementDate',    label: 'Settlement Date',      group: 'Dates' },

  // Submission
  { key: 'submitMode',        label: 'Submit Mode',     group: 'Submission' },
  { key: 'courierSubmitDate', label: 'Courier Submit Date', group: 'Submission' },
  { key: 'onlineSubmitDate',  label: 'Online Submit Date',  group: 'Submission' },
  { key: 'courierCompanyName',label: 'Courier Company', group: 'Submission' },
  { key: 'podNumber',         label: 'POD Number',      group: 'Submission' },

  // Financials
  { key: 'hospitalFinalBill',         label: 'Hospital Bill',           group: 'Financials' },
  { key: 'mouDiscount',               label: 'MOU Discount',            group: 'Financials' },
  { key: 'deduction',                 label: 'Deduction',               group: 'Financials' },
  { key: 'finalApprovalAmount',       label: 'Final Approval Amount',   group: 'Financials' },
  { key: 'settlementAmount',          label: 'Settlement Amount',       group: 'Financials' },
  { key: 'settlementAmountDeduction', label: 'Settlement Deduction',    group: 'Financials' },
  { key: 'mouDiscountOnSettlement',   label: 'MOU Disc on Settlement',  group: 'Financials' },
  { key: 'tds',                       label: 'TDS',                     group: 'Financials' },
  { key: 'bankTransferAmount',        label: 'Bank Transfer Amount',    group: 'Financials' },
  { key: 'tpaFee',                    label: 'File Price',              group: 'Financials' },

  // Other
  { key: 'neftNo',         label: 'NEFT No',         group: 'Other' },
  { key: 'remarks',        label: 'Remarks',         group: 'Other' },
  { key: 'rejectedReason', label: 'Rejected Reason', group: 'Other' },
  { key: 'status',         label: 'Status',          group: 'Other' },
];

const GROUPS = ['Patient', 'Hospital', 'Payor', 'Treatment', 'Dates', 'Submission', 'Financials', 'Other'];
const DEFAULT_KEYS = [
  'patientName',
  'doctorName',
  'insuranceCompany',
  'ccnNo',
  'tpa',
  'dateOfDischarge',
  'finalApprovalDate',
  'tpaFee',
];

const ClaimSummaryColumnsModal = ({ open, onClose }) => {
  const [selected, setSelected] = useState(DEFAULT_KEYS);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSearch('');
    getPublicStatsAPI()
      .then(({ data }) => {
        const raw = data?.invoice_summary_columns;
        const parsed = String(raw || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        setSelected(parsed.length ? parsed : DEFAULT_KEYS);
      })
      .catch(() => setSelected(DEFAULT_KEYS))
      .finally(() => setLoading(false));
  }, [open]);

  const toggle = (key) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const selectAll = () => setSelected(FIELD_DEFS.map((f) => f.key));
  const clearAll  = () => setSelected([]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return GROUPS.map((label) => {
      const groupFields = FIELD_DEFS.filter((f) => f.group === label);
      const filtered = q ? groupFields.filter((f) => f.label.toLowerCase().includes(q)) : groupFields;
      return { label, groupFields, filtered };
    }).filter((g) => g.filtered.length);
  }, [search]);

  const save = async () => {
    setSaving(true);
    try {
      await updateSiteSettingsAPI({ invoice_summary_columns: selected.join(',') });
      toast.success('Claims summary columns saved');
      onClose?.();
    } catch (e) {
      toast.error(e.response?.data?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <HiOutlineCog className="w-5 h-5 text-primary-600" /> Claims Summary Columns
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              Choose which claim fields appear in the summary table appended after the invoice.
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary-50 text-primary-700 text-xs font-semibold">
                {selected.length} / {FIELD_DEFS.length} selected
              </span>
              <button onClick={selectAll} className="text-xs text-primary-600 hover:text-primary-700 font-medium">Select all</button>
              <span className="text-gray-300 text-xs">·</span>
              <button onClick={clearAll} className="text-xs text-gray-500 hover:text-gray-700 font-medium">Clear all</button>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-6 py-3 border-b border-gray-100">
          <div className="relative">
            <HiOutlineSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search fields..."
              className="w-full pl-9 pr-9 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-gray-50 focus:bg-white transition-colors"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              >
                <HiOutlineX className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
          {loading && <div className="text-center py-12 text-sm text-gray-400">Loading...</div>}
          {!loading && !visibleGroups.length && (
            <div className="text-center py-12 text-sm text-gray-500">
              No fields match "<span className="font-medium text-gray-700">{search}</span>"
            </div>
          )}
          {!loading && visibleGroups.map(({ label, groupFields, filtered }) => {
            const groupKeys = groupFields.map((f) => f.key);
            const selectedInGroup = groupKeys.filter((k) => selected.includes(k)).length;
            const allInGroup = selectedInGroup === groupKeys.length && groupKeys.length > 0;
            const toggleGroup = () =>
              allInGroup
                ? setSelected((prev) => prev.filter((k) => !groupKeys.includes(k)))
                : setSelected((prev) => Array.from(new Set([...prev, ...groupKeys])));

            return (
              <div key={label}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-500">{label}</p>
                    <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                      {selectedInGroup}/{groupKeys.length}
                    </span>
                  </div>
                  <button
                    onClick={toggleGroup}
                    className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 uppercase tracking-wide"
                  >
                    {allInGroup ? 'Clear group' : 'Select group'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5">
                  {filtered.map((field) => {
                    const on = selected.includes(field.key);
                    return (
                      <label
                        key={field.key}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer border transition-colors ${
                          on ? 'border-primary-200 bg-primary-50' : 'border-gray-100 hover:border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(field.key)}
                          className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 w-3.5 h-3.5"
                        />
                        <span className={`text-xs font-medium truncate ${on ? 'text-primary-700' : 'text-gray-600'}`}>
                          {field.label}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || loading || !selected.length}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-medium disabled:opacity-50 shadow-sm"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ClaimSummaryColumnsModal;
