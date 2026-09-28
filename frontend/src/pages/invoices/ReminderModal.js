import React, { useEffect, useState } from 'react';
import { HiOutlineX, HiOutlineClipboardCopy } from 'react-icons/hi';
import { toast } from 'react-toastify';
import { useAuth } from '../../context/AuthContext';
import { getPublicStatsAPI } from '../../services/api';
import { buildReminderMessage } from '../../utils/invoice';

// Payment-reminder text for one overdue invoice. Pulls the admin-configured
// template (Settings → Payment Reminder) each time it opens, fills in this
// invoice's details, and lets the operator tweak + copy it to paste into
// WhatsApp themselves — no message is sent from here.
const ReminderModal = ({ open, invoice, onClose }) => {
  const { roleSlug } = useAuth();
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getPublicStatsAPI()
      .then(({ data }) => {
        setText(buildReminderMessage(data.invoice_reminder_message, invoice, data.invoice_company_name));
      })
      .catch(() => toast.error('Failed to load reminder template'))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoice]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied - paste it into WhatsApp');
    } catch {
      toast.error('Could not copy — select the text and copy manually');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">Payment Reminder</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
            <HiOutlineX className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">
          {loading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Edit if needed, then copy and paste into WhatsApp.
                {roleSlug === 'super_admin' && (
                  <> Edit the template itself under <a href="/settings" className="text-primary-600 hover:underline">Settings → Payment Reminder</a>.</>
                )}
              </p>
              <textarea
                rows={9}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y"
              />
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg">
            Close
          </button>
          <button
            onClick={copy}
            disabled={loading}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg disabled:opacity-50"
          >
            <HiOutlineClipboardCopy className="w-4 h-4" /> Copy Message
          </button>
        </div>
      </div>
    </div>
  );
};

export default ReminderModal;
