import React, { useEffect, useState } from 'react';
import { HiOutlineX, HiOutlinePlus, HiOutlineTrash, HiOutlineDownload } from 'react-icons/hi';
import { toast } from 'react-toastify';
import DateInput from '../../components/ui/DateInput';
import SearchableSelect from '../../components/ui/SearchableSelect';
import AmountInput from '../../components/AmountInput';
import { getHospitalFinalBillAPI, saveHospitalFinalBillAPI, getRoomTypeValuesAPI, getHospitalFinalBillPdfURL, getNextHospitalBillNumberAPI } from '../../services/api';
import { formatCurrency, formatINRWords, round2 } from '../../utils/format';

const todayIso = () => new Date().toISOString().slice(0, 10);
const blankItem = () => ({ particulars: '', rate: 0, qtyRaw: '1' });

// Same rule as the backend (hospitalFinalBillController.parseLineQty): a
// value with "%" computes that percent of Rate, otherwise it's a plain
// multiplier. Mirrored here purely for live totals while the operator types —
// the server always recomputes from scratch on save.
const parseQty = (raw) => {
  const s = String(raw ?? '1').trim();
  const isPercent = s.includes('%');
  const n = parseFloat(s.replace('%', ''));
  const value = Number.isFinite(n) ? n : (isPercent ? 0 : 1);
  return { isPercent, value };
};
const lineAmount = (rate, qtyRaw) => {
  const { isPercent, value } = parseQty(qtyRaw);
  const r = Number(rate) || 0;
  return round2(isPercent ? (r * value) / 100 : r * value);
};

const labelCls = 'block text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5';
const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 bg-white transition-colors';
const roInputCls = `${inputCls} bg-gray-50 text-gray-600`;

const HospitalFinalBillModal = ({ open, claim, onClose, onSaved }) => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existingBillNo, setExistingBillNo] = useState('');
  const [nextBillPreview, setNextBillPreview] = useState('');
  const [roomTypeValues, setRoomTypeValues] = useState([]);
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (!open || !claim?._id) return;
    let cancelled = false;
    setLoading(true);
    setNextBillPreview('');
    getRoomTypeValuesAPI().then(({ data }) => { if (!cancelled) setRoomTypeValues(data || []); }).catch(() => {});
    getHospitalFinalBillAPI(claim._id)
      .then(({ data }) => {
        if (cancelled) return;
        setExistingBillNo(data.billNoFormatted || '');
        setForm({
          billDate: (data.billDate || '').slice(0, 10) || todayIso(),
          opdNo: data.opdNo || '',
          indoorNo: data.indoorNo || '',
          roomType: data.roomType || '',
          patientDob: (data.patientDob || '').slice(0, 10) || '',
          patientAge: data.patientAge != null ? String(data.patientAge) : '',
          admitTime: data.admitTime || '',
          dischargeTime: data.dischargeTime || '',
          discount: data.discount || 0,
          items: (data.items || []).length
            ? data.items.map(it => ({ particulars: it.particulars, rate: it.rate, qtyRaw: it.qtyRaw }))
            : [blankItem()],
        });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err.response?.status === 404) {
          setExistingBillNo('');
          setForm({
            billDate: todayIso(), opdNo: '', indoorNo: '', roomType: '',
            patientDob: '', patientAge: '', admitTime: '', dischargeTime: '',
            discount: 0, items: [blankItem()],
          });
          getNextHospitalBillNumberAPI(claim._id)
            .then(({ data }) => { if (!cancelled) setNextBillPreview(data.billNoFormatted || ''); })
            .catch(() => {});
        } else {
          toast.error(err.response?.data?.message || 'Failed to load Hospital Final Bill');
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, claim?._id]);

  if (!open) return null;
  // Keep the same modal shell mounted through the load — swapping it for a
  // differently-sized "Loading…" box and back caused a jarring blink. An
  // overlay + safe fallback data (never rendered, since the overlay blocks
  // interaction) keeps size/position stable instead.
  const ready = !loading && !!form;
  const f = form || { billDate: todayIso(), opdNo: '', indoorNo: '', roomType: '', patientDob: '', patientAge: '', admitTime: '', dischargeTime: '', discount: 0, items: [blankItem()] };

  const setField = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const setItem = (idx, key, value) => setForm(prev => ({
    ...prev, items: prev.items.map((it, i) => (i === idx ? { ...it, [key]: value } : it)),
  }));
  const addItem = () => setForm(prev => ({ ...prev, items: [...prev.items, blankItem()] }));
  const removeItem = (idx) => setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const totalAmount = round2(f.items.reduce((s, it) => s + lineAmount(it.rate, it.qtyRaw), 0));
  const discount = round2(Number(f.discount) || 0);
  const finalAmount = round2(totalAmount - discount);
  const wordsText = finalAmount > 0 ? `Rupees ${formatINRWords(finalAmount)} Only` : 'Zero Rupees Only';

  const submit = async () => {
    const items = form.items
      .map(it => ({ ...it, particulars: (it.particulars || '').trim() }))
      .filter(it => it.particulars);
    if (!items.length) { toast.error('Add at least one bill item'); return; }
    setSaving(true);
    try {
      await saveHospitalFinalBillAPI(claim._id, {
        billDate: form.billDate,
        opdNo: form.opdNo,
        indoorNo: form.indoorNo,
        roomType: form.roomType,
        patientDob: form.patientDob || null,
        patientAge: form.patientAge === '' ? null : form.patientAge,
        admitTime: form.admitTime,
        dischargeTime: form.dischargeTime,
        discount,
        items,
      });
      toast.success('Hospital Final Bill saved');
      await onSaved?.();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save Hospital Final Bill');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="relative bg-white w-full max-w-4xl rounded-2xl shadow-xl max-h-[90vh] flex flex-col">
        {!ready && (
          <div className="absolute inset-0 bg-white/80 flex items-center justify-center rounded-2xl z-10">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="w-4 h-4 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
              Loading…
            </div>
          </div>
        )}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Hospital Final Bill</h3>
            <p className="text-xs text-gray-400 mt-0.5">{claim.hospital?.name} · {claim.patientName}</p>
          </div>
          <div className="flex items-center gap-2">
            {existingBillNo && (
              <a href={getHospitalFinalBillPdfURL(claim._id)} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-primary-600 border border-primary-200 rounded-lg hover:bg-primary-50">
                <HiOutlineDownload className="w-3.5 h-3.5" /> PDF
              </a>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-gray-100">
              <HiOutlineX className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          {/* Patient / bill meta grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <label className={labelCls}>Patient Name</label>
              <div className={roInputCls}>{claim.patientName || '—'}</div>
            </div>
            <div>
              <label className={labelCls}>Bill No.</label>
              <div className={roInputCls}>
                {existingBillNo || (nextBillPreview ? `${nextBillPreview} (assigned on save)` : '—')}
              </div>
            </div>
            <div>
              <label className={labelCls}>Credit By</label>
              <div className={roInputCls}>{claim.insuranceCompany?.name || '—'}</div>
            </div>
            <div>
              <label className={labelCls}>Bill Date</label>
              <DateInput type="date" value={f.billDate} onChange={e => setField('billDate', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>TPA</label>
              <div className={roInputCls}>{claim.tpa?.name || '—'}</div>
            </div>
            <div>
              <label className={labelCls}>OPD No.</label>
              <input value={f.opdNo} onChange={e => setField('opdNo', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Doctor Name</label>
              <div className={roInputCls}>{claim.doctorName || '—'}</div>
            </div>
            <div>
              <label className={labelCls}>Indoor No.</label>
              <input value={f.indoorNo} onChange={e => setField('indoorNo', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>D.O.A. / D.O.D.</label>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <span className={`${roInputCls} flex-1`}>{(claim.dateOfAdmit || '').slice(0, 10) || '—'}</span>
                  <input type="time" value={f.admitTime} onChange={e => setField('admitTime', e.target.value)} className={`${inputCls} w-28`} />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`${roInputCls} flex-1`}>{(claim.dateOfDischarge || '').slice(0, 10) || '—'}</span>
                  <input type="time" value={f.dischargeTime} onChange={e => setField('dischargeTime', e.target.value)} className={`${inputCls} w-28`} />
                </div>
              </div>
            </div>
            <div>
              <label className={labelCls}>Room Type</label>
              <SearchableSelect
                value={f.roomType}
                onChange={v => setField('roomType', v)}
                options={roomTypeValues.map(v => ({ value: v, label: v }))}
                placeholder="Select or type a room type"
                searchPlaceholder="Search or add room type..."
                allowCustom
                allowClear
              />
            </div>
            <div>
              <label className={labelCls}>Birth Date <span className="font-normal normal-case text-gray-300">(optional)</span></label>
              {/* Plain native input, not the shared DateInput — DateInput
                  force-opens the picker on any click anywhere in the field
                  (not just the calendar icon), which was committing "today"
                  from a stray click instead of leaving this optional field
                  blank. A bare input only opens the picker via its own
                  calendar-glyph click, like any other date field's default. */}
              <div className="relative">
                <input type="date" value={f.patientDob} onChange={e => setField('patientDob', e.target.value)} className={inputCls} />
                {f.patientDob && (
                  <button type="button" onClick={() => setField('patientDob', '')}
                    title="Clear"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                    <HiOutlineX className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className={labelCls}>Age</label>
              <input type="number" min="0" value={f.patientAge} onChange={e => setField('patientAge', e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelCls}>Particulars</label>
              <button type="button" onClick={addItem}
                className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700">
                <HiOutlinePlus className="w-3.5 h-3.5" /> Add Row
              </button>
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <div className="grid grid-cols-[1fr_110px_130px_130px_32px] gap-2 bg-gray-50 px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                <span>Particulars</span><span>Qty / %</span><span>Rate (₹)</span><span className="text-right">Amount</span><span />
              </div>
              {f.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_110px_130px_130px_32px] gap-2 px-3 py-2 border-t border-gray-100 items-center">
                  <input value={it.particulars} onChange={e => setItem(idx, 'particulars', e.target.value)}
                    placeholder="e.g. Room Charges With Nursing Charges" className={inputCls} />
                  <input value={it.qtyRaw} onChange={e => setItem(idx, 'qtyRaw', e.target.value)}
                    placeholder='2 or 50%' className={inputCls} />
                  <AmountInput value={it.rate} allowDecimal showWords={false}
                    onChange={v => setItem(idx, 'rate', v)} className={inputCls} />
                  <div className="text-sm text-right font-semibold text-gray-700 px-1">
                    {formatCurrency(lineAmount(it.rate, it.qtyRaw))}
                  </div>
                  <button type="button" onClick={() => removeItem(idx)}
                    disabled={f.items.length === 1}
                    className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent">
                    <HiOutlineTrash className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full max-w-xs space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Total Amount</span>
                <span className="font-semibold text-gray-800">{formatCurrency(totalAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm gap-3">
                <label className="text-gray-500">Discount (₹)</label>
                <AmountInput value={f.discount} allowDecimal showWords={false}
                  onChange={v => setField('discount', v)}
                  className="w-32 px-2 py-1 border border-gray-200 rounded-lg text-sm text-right focus:ring-2 focus:ring-primary-500 focus:border-primary-500" />
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-100">
                <span className="font-semibold text-gray-800">Final Bill Amount</span>
                <span className="font-bold text-primary-700 text-base">{formatCurrency(finalAmount)}</span>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-lg p-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Total Final Bill Amount In Words</p>
            <p className="text-sm font-semibold text-gray-700">{wordsText}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600 hover:bg-white font-medium">
            Cancel
          </button>
          <button onClick={submit} disabled={saving}
            className="px-4 py-2 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg font-medium shadow-sm">
            {saving ? 'Saving…' : 'Save Bill'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default HospitalFinalBillModal;
