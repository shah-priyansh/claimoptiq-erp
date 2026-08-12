import React, { useEffect, useMemo, useState } from 'react';
import { HiOutlineX, HiOutlinePlus, HiOutlineTrash } from 'react-icons/hi';
import { getLedgerOptionsAPI } from '../../services/api';

const todayIso = () => new Date().toISOString().slice(0, 10);
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const formatINR = (n) => '₹' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-IN');
const emptyLine = () => ({ accountKind: '', accountId: null, debit: '', credit: '' });

// A flat option value encodes kind + id so the <select> stays a single string.
const optValue = (a) => `${a.kind}:${a.id ?? ''}`;
const parseOpt = (v) => { const i = v.indexOf(':'); return { kind: v.slice(0, i), id: v.slice(i + 1) || null }; };

const JournalEntryModal = ({ open, initial, onClose, onSave }) => {
  const [date, setDate] = useState(todayIso());
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState([emptyLine(), emptyLine()]);
  const [groups, setGroups] = useState([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    getLedgerOptionsAPI().then((r) => setGroups(r.data.groups)).catch(() => setGroups([]));
    if (initial) {
      setDate((initial.date || '').slice(0, 10) || todayIso());
      setDescription(initial.description || '');
      setLines((initial.lines || []).map((l) => ({
        accountKind: l.accountKind, accountId: l.accountId,
        debit: l.debit ? String(l.debit) : '', credit: l.credit ? String(l.credit) : '',
      })));
    } else {
      setDate(todayIso()); setDescription(''); setLines([emptyLine(), emptyLine()]);
    }
  }, [open, initial]);

  // Map "kind:id" -> account (for Cur Bal display).
  const optIndex = useMemo(() => {
    const m = new Map();
    for (const g of groups) for (const a of g.accounts) m.set(optValue(a), a);
    return m;
  }, [groups]);

  const totals = useMemo(() => {
    const debit = round2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const credit = round2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    return { debit, credit, balanced: debit > 0 && Math.abs(debit - credit) < 0.005 };
  }, [lines]);

  const everyLineValid = lines.every((l) =>
    l.accountKind && (l.accountKind === 'cash' || l.accountId) &&
    ((Number(l.debit) > 0) !== (Number(l.credit) > 0)));

  const canSave = totals.balanced && lines.length >= 2 && everyLineValid && !saving;

  if (!open) return null;

  const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const onPickAccount = (i, v) => { const { kind, id } = parseOpt(v); setLine(i, { accountKind: kind, accountId: id }); };
  const onDebit = (i, v) => setLine(i, { debit: v, credit: '' });
  const onCredit = (i, v) => setLine(i, { credit: v, debit: '' });
  const addLine = () => setLines((ls) => [...ls, emptyLine()]);
  const removeLine = (i) => setLines((ls) => (ls.length <= 2 ? ls : ls.filter((_, idx) => idx !== i)));

  const submit = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({
        date, description,
        lines: lines.map((l) => ({
          accountKind: l.accountKind, accountId: l.accountKind === 'cash' ? null : l.accountId,
          debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
        })),
      });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-lg font-semibold text-gray-800">{initial ? `Edit Journal Entry ${initial.refNumber || ''}` : 'Journal Entry'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex justify-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Journal Date *</label>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <div className="grid grid-cols-[1fr_140px_140px_36px] bg-gray-50 text-xs font-semibold uppercase text-gray-500 px-3 py-2">
              <span>Account</span><span className="text-right">Credit</span><span className="text-right">Debit</span><span />
            </div>
            {lines.map((l, i) => {
              const acct = optIndex.get(`${l.accountKind}:${l.accountId ?? ''}`);
              return (
                <div key={i} className="grid grid-cols-[1fr_140px_140px_36px] items-center px-3 py-2 border-t border-gray-100 gap-2">
                  <div>
                    <select value={l.accountKind ? `${l.accountKind}:${l.accountId ?? ''}` : ''} onChange={(e) => onPickAccount(i, e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm">
                      <option value="">Select A/C</option>
                      {groups.map((g) => (
                        <optgroup key={g.key} label={g.label}>
                          {g.accounts.map((a) => <option key={optValue(a)} value={optValue(a)}>{a.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    {acct && <p className="text-[11px] text-gray-400 mt-0.5">Cur Bal: {formatINR(acct.balance)} {acct.side}</p>}
                  </div>
                  <input type="number" min="0" step="0.01" value={l.credit} onChange={(e) => onCredit(i, e.target.value)}
                    placeholder="0.00" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                  <input type="number" min="0" step="0.01" value={l.debit} onChange={(e) => onDebit(i, e.target.value)}
                    placeholder="0.00" className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm text-right" />
                  <button type="button" onClick={() => removeLine(i)} disabled={lines.length <= 2}
                    className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-30"><HiOutlineTrash className="w-4 h-4" /></button>
                </div>
              );
            })}
            <div className="grid grid-cols-[1fr_140px_140px_36px] items-center px-3 py-2 border-t border-gray-200 bg-gray-50 text-sm font-semibold">
              <button type="button" onClick={addLine} className="flex items-center gap-1 text-primary-600 hover:text-primary-700 justify-self-start">
                <HiOutlinePlus className="w-4 h-4" /> Add row
              </button>
              <span className="text-right">{formatINR(totals.credit)}</span>
              <span className="text-right">{formatINR(totals.debit)}</span>
              <span />
            </div>
          </div>

          {!totals.balanced && (totals.debit > 0 || totals.credit > 0) && (
            <p className="text-xs text-red-600">Total Debit and Credit must be equal to save.</p>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter description here" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={!canSave}
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default JournalEntryModal;
