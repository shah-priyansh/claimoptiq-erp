import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { HiOutlineX, HiOutlineExclamationCircle } from 'react-icons/hi';
import { StatusAutomationEditor } from './MasterContactFormModal';

// Bulk-apply a single Status Automation config to many selected insurers / TPAs.
// Reuses the same StatusAutomationEditor as the single-edit modal. The config
// REPLACES each selected row's existing automation (parent confirms first).
const BulkStatusAutomationModal = ({ open, count = 0, entityLabel = 'company', entityLabelPlural, claimStatuses = [], applying = false, onClose, onApply }) => {
  const [rules, setRules] = useState([{ claimTypes: [], status: '' }]);

  useEffect(() => {
    if (open) setRules([{ claimTypes: [], status: '' }]);
  }, [open]);

  if (!open) return null;

  const validRules = (rules || []).filter(
    (r) => Array.isArray(r.claimTypes) && r.claimTypes.length > 0 && r.status
  );
  const willClear = validRules.length === 0;
  const plural = entityLabelPlural || `${entityLabel}s`;
  const target = `${count} ${count === 1 ? entityLabel : plural}`;

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Apply Status Automation</h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Applies to <span className="font-medium text-gray-600">{target}</span> — replaces existing rules.
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          <StatusAutomationEditor value={rules} onChange={setRules} claimStatuses={claimStatuses} />

          {willClear && (
            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
              <HiOutlineExclamationCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-700">
                No complete rules set — applying now will <span className="font-semibold">clear</span> status automation on the selected {plural}.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} disabled={applying}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 font-medium disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={() => onApply(validRules)} disabled={applying}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded-lg font-semibold disabled:opacity-50">
            {applying && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            {willClear ? `Clear on ${count}` : `Apply to ${count}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default BulkStatusAutomationModal;
