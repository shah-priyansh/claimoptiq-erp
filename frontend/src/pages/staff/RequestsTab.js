import React, { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlineCheck, HiOutlineX, HiOutlineTrash } from 'react-icons/hi';
import {
  createMyStaffRequestAPI, getMyStaffRequestsAPI, cancelMyStaffRequestAPI,
  getStaffRequestsAPI, reviewStaffRequestAPI,
} from '../../services/api';

const TYPE_LABEL = { ot: 'Overtime', leave: 'Leave', off_swap: 'Off-day Swap' };
const STATUS = {
  pending:  { label: 'Pending',  cls: 'bg-amber-50 text-amber-700' },
  approved: { label: 'Approved', cls: 'bg-green-50 text-green-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-700' },
};
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const todayIso = () => new Date().toISOString().slice(0, 10);
const detailText = (r) =>
  r.type === 'ot' ? `${r.otHours}h overtime on ${fmt(r.date)}`
    : r.type === 'leave' ? `${r.leavePaid ? 'Paid' : 'Unpaid'} leave on ${fmt(r.date)}`
      : `Worked ${fmt(r.swapWorkedDate)} to cover ${fmt(r.date)}`;

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

const NewRequestModal = ({ onClose, onSaved }) => {
  const [type, setType] = useState('ot');
  const [date, setDate] = useState(todayIso());
  const [swapWorkedDate, setSwapWorkedDate] = useState(todayIso());
  const [otHours, setOtHours] = useState('');
  const [leavePaid, setLeavePaid] = useState(true);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (type === 'ot' && !(parseFloat(otHours) > 0)) { toast.error('Enter OT hours greater than 0'); return; }
    setSaving(true);
    try {
      const payload = { type, date, reason };
      if (type === 'ot') payload.otHours = parseFloat(otHours);
      if (type === 'leave') payload.leavePaid = leavePaid;
      if (type === 'off_swap') payload.swapWorkedDate = swapWorkedDate;
      await createMyStaffRequestAPI(payload);
      toast.success('Request submitted for approval');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to submit');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-900">New Request</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><HiOutlineX className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Request Type</label>
            <select value={type} onChange={e => setType(e.target.value)} className={inputCls}>
              <option value="ot">Overtime (OT)</option>
              <option value="leave">Leave</option>
              <option value="off_swap">Off-day Swap</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">
              {type === 'off_swap' ? 'Day you are taking off (to cover)' : type === 'ot' ? 'OT date' : 'Leave date'}
            </label>
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} className={inputCls} />
          </div>

          {type === 'ot' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Overtime hours</label>
              <input type="number" min="0" step="0.5" value={otHours} onChange={e => setOtHours(e.target.value)} placeholder="e.g. 2" className={inputCls} />
            </div>
          )}

          {type === 'leave' && (
            <div className="flex items-center gap-4">
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" checked={leavePaid} onChange={() => setLeavePaid(true)} /> Paid leave
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="radio" checked={!leavePaid} onChange={() => setLeavePaid(false)} /> Unpaid leave
              </label>
            </div>
          )}

          {type === 'off_swap' && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Off day you worked to cover it</label>
              <input type="date" required value={swapWorkedDate} onChange={e => setSwapWorkedDate(e.target.value)} className={inputCls} />
              <p className="text-[11px] text-gray-400 mt-0.5">e.g. you worked your Sunday so this leave isn't deducted.</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className={inputCls} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg">
              {saving ? 'Submitting…' : 'Submit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const StatusBadge = ({ s }) => {
  const st = STATUS[s] || STATUS.pending;
  return <span className={`text-[11px] px-2 py-0.5 rounded font-medium ${st.cls}`}>{st.label}</span>;
};

const RequestsTab = ({ isSuperAdmin }) => {
  const [mine, setMine] = useState([]);
  const [isEmployee, setIsEmployee] = useState(false);
  const [review, setReview] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState({});

  const load = async () => {
    setLoading(true);
    const tasks = [
      getMyStaffRequestsAPI()
        .then(({ data }) => { setMine(data || []); setIsEmployee(true); })
        .catch(() => { setMine([]); setIsEmployee(false); }),
    ];
    if (isSuperAdmin) {
      tasks.push(
        getStaffRequestsAPI()
          .then(({ data }) => { setReview(data.requests || []); setPendingCount(data.pendingCount || 0); })
          .catch(() => {}),
      );
    }
    await Promise.all(tasks);
    setLoading(false);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const act = async (id, action) => {
    setActing(a => ({ ...a, [id]: true }));
    try {
      await reviewStaffRequestAPI(id, { action });
      toast.success(`Request ${action === 'approve' ? 'approved' : 'rejected'}`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Action failed');
    } finally {
      setActing(a => ({ ...a, [id]: false }));
    }
  };

  const cancel = async (id) => {
    try { await cancelMyStaffRequestAPI(id); toast.success('Request cancelled'); await load(); }
    catch (err) { toast.error(err.response?.data?.message || 'Failed to cancel'); }
  };

  const pendingReview = review.filter(r => r.status === 'pending');

  return (
    <div className="space-y-6">
      {/* Super-admin review */}
      {isSuperAdmin && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">Pending Review</h3>
            {pendingCount > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{pendingCount}</span>}
          </div>
          {loading ? (
            <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : pendingReview.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No requests awaiting review.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {pendingReview.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-gray-800 text-sm">{r.employee?.name}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{TYPE_LABEL[r.type]}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{detailText(r)}{r.reason ? ` · ${r.reason}` : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => act(r.id, 'approve')} disabled={acting[r.id]}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg disabled:opacity-50">
                      <HiOutlineCheck className="w-4 h-4" /> Approve
                    </button>
                    <button onClick={() => act(r.id, 'reject')} disabled={acting[r.id]}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-lg disabled:opacity-50">
                      <HiOutlineX className="w-4 h-4" /> Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* My requests (self-service) */}
      {isEmployee && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">My Requests</h3>
            <button onClick={() => setModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg">
              <HiOutlinePlus className="w-4 h-4" /> New Request
            </button>
          </div>
          {loading ? (
            <div className="py-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : mine.length === 0 ? (
            <div className="py-8 text-center text-gray-400 text-sm">No requests yet. Click “New Request” to raise one.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {mine.map(r => (
                <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{TYPE_LABEL[r.type]}</span>
                      <StatusBadge s={r.status} />
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{detailText(r)}{r.reviewNote ? ` · note: ${r.reviewNote}` : ''}</div>
                  </div>
                  {r.status === 'pending' && (
                    <button onClick={() => cancel(r.id)} title="Cancel request"
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded shrink-0">
                      <HiOutlineTrash className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && !isEmployee && !isSuperAdmin && (
        <div className="py-10 text-center text-gray-400 text-sm">Your account isn’t linked to an employee record, so there’s nothing here.</div>
      )}

      {modalOpen && <NewRequestModal onClose={() => setModalOpen(false)} onSaved={() => { setModalOpen(false); load(); }} />}
    </div>
  );
};

export default RequestsTab;
