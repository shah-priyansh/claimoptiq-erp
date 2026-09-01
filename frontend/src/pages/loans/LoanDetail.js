import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { HiOutlineArrowLeft, HiOutlineX } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatDate } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Loader from '../../components/ui/Loader';
import {
  getLoanAPI, recordLoanPaymentAPI, recordLoanInterestAPI, recordLoanPrincipalAPI, getBankAccountsAPI,
} from '../../services/api';

const rs = (n) => '₹' + formatINR(Number(n) || 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

const PayModal = ({ open, installment, loan, bankAccounts, onClose, onPaid }) => {
  const [mode, setMode] = useState('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setMode('cash'); setBankAccountId(''); setDate(todayIso()); } }, [open]);
  if (!open || !installment) return null;
  const needsBank = mode === 'bank' || mode === 'upi';
  const inLabel = loan.direction === 'given' ? 'received from' : 'paid to';

  const submit = async () => {
    if (needsBank && !bankAccountId && !bankAccounts.length) { toast.error('No bank accounts configured'); return; }
    setSaving(true);
    try {
      await recordLoanPaymentAPI(installment._id, { mode, bankAccountId: needsBank ? bankAccountId : null, date });
      toast.success('EMI payment recorded');
      onPaid();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to record'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">Record EMI #{installment.installmentNo}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
            <span className="text-sm text-gray-500">EMI {inLabel}</span>
            <span className="text-lg font-bold text-gray-800">{rs(installment.emiAmount)}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mode</label>
              <SearchableSelect value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          {needsBank && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
              <SearchableSelect value={bankAccountId} onChange={setBankAccountId} placeholder="Select bank"
                options={bankAccounts.map((b) => ({ value: b._id, label: `${b.bankName}${b.accountNumber ? ` — ${b.accountNumber}` : ''}` }))} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">{saving ? 'Saving…' : 'Record Payment'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

// Record an interest collection or a principal repayment on an open loan.
const MovementModal = ({ open, kind, loan, bankAccounts, onClose, onSaved }) => {
  const isInterest = kind === 'interest';
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('cash');
  const [bankAccountId, setBankAccountId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      // Default the interest amount to the suggested accrued/monthly figure.
      setAmount(isInterest ? String(loan.interestAccrued || loan.monthlyInterest || '') : '');
      setMode('cash'); setBankAccountId(''); setDate(todayIso());
    }
  }, [open, kind, loan, isInterest]);
  if (!open) return null;
  const needsBank = mode === 'bank' || mode === 'upi';
  const inLabel = loan.direction === 'given' ? 'received from' : 'paid to';
  const title = isInterest ? 'Record Interest' : 'Record Principal Repayment';

  const submit = async () => {
    const amt = Number(amount);
    if (!(amt > 0)) { toast.error('Enter an amount greater than 0'); return; }
    if (!isInterest && amt > (loan.outstanding || 0)) { toast.error(`Repayment can't exceed the outstanding principal (${rs(loan.outstanding)})`); return; }
    if (needsBank && !bankAccountId && !bankAccounts.length) { toast.error('No bank accounts configured'); return; }
    setSaving(true);
    const payload = { amount: amt, mode, bankAccountId: needsBank ? bankAccountId : null, date };
    try {
      if (isInterest) await recordLoanInterestAPI(loan._id, payload);
      else await recordLoanPrincipalAPI(loan._id, payload);
      toast.success(isInterest ? 'Interest recorded' : 'Principal repayment recorded');
      onSaved();
    } catch (e) { toast.error(e.response?.data?.message || 'Failed to record'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600 space-y-1">
            <div className="flex justify-between"><span>Outstanding principal</span><span className="font-semibold text-gray-800">{rs(loan.outstanding)}</span></div>
            {isInterest && <div className="flex justify-between"><span>Interest accrued to date</span><span className="font-semibold text-gray-800">{rs(loan.interestAccrued)}</span></div>}
            {isInterest && <div className="flex justify-between text-xs text-gray-400"><span>Monthly interest @ {loan.annualInterestRate || 0}%/yr</span><span>{rs(loan.monthlyInterest)}</span></div>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{isInterest ? `Interest ${inLabel} (₹)` : `Principal ${inLabel} (₹)`}</label>
            <input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Mode</label>
              <SearchableSelect value={mode} onChange={setMode} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
            </div>
          </div>
          {needsBank && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bank Account</label>
              <SearchableSelect value={bankAccountId} onChange={setBankAccountId} placeholder="Select bank"
                options={bankAccounts.map((b) => ({ value: b._id, label: `${b.bankName}${b.accountNumber ? ` — ${b.accountNumber}` : ''}` }))} />
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">{saving ? 'Saving…' : 'Record'}</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, cls }) => (
  <div><p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p><p className={`text-lg font-semibold ${cls || 'text-gray-800'}`}>{value}</p></div>
);

const LoanDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const canEdit = can('loans', 'edit');
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bankAccounts, setBankAccounts] = useState([]);
  const [payInst, setPayInst] = useState(null);
  const [movementKind, setMovementKind] = useState(null); // 'interest' | 'principal'

  const load = () => {
    getLoanAPI(id).then(({ data }) => setLoan(data)).catch(() => { toast.error('Loan not found'); navigate('/loans'); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); getBankAccountsAPI({ active: 'true' }).then(({ data }) => setBankAccounts(data || [])).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  if (loading || !loan) return <Loader label="Loading loan…" className="h-64" />;

  const isSalary = loan.repaymentSource === 'salary';
  const isOpen = loan.isOpen;
  const dirColor = loan.direction === 'given' ? 'text-green-700' : 'text-red-700';
  // For an open loan, its installments are ad-hoc movements (interest / principal),
  // always recorded as settled. Ignore any pending rows (e.g. a legacy bullet row).
  const movements = (loan.installments || []).filter((m) => m.status === 'paid');
  const moveType = (m) => ((m.interestComponent || 0) > 0 && (m.principalComponent || 0) === 0 ? 'interest' : 'principal');

  return (
    <div>
      <button onClick={() => navigate('/loans')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><HiOutlineArrowLeft className="w-4 h-4" /> Back to loans</button>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold text-gray-800">{loan.counterparty}</h1>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${loan.direction === 'given' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{loan.direction === 'given' ? 'GIVEN' : 'TAKEN'}</span>
              {loan.employee && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Staff</span>}
              {isOpen && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">Interest loan</span>}
            </div>
            <p className="text-sm text-gray-400 mt-1">
              {loan.annualInterestRate || 0}% / yr · {isOpen ? 'no fixed tenure (repay on demand)' : `${loan.tenureMonths} months`} · started {formatDate(loan.startDate)}{isSalary ? ' · repaid from salary' : ''}
            </p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${loan.status === 'closed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{(loan.status || '').toUpperCase()}</span>
        </div>
        {isOpen ? (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5">
            <Stat label="Principal" value={rs(loan.principal)} />
            <Stat label="Outstanding" value={rs(loan.outstanding)} cls={dirColor} />
            <Stat label={`Interest / month`} value={rs(loan.monthlyInterest)} />
            <Stat label="Interest accrued" value={rs(loan.interestAccrued)} cls="text-amber-700" />
            <Stat label="Interest collected" value={rs(loan.interestCollected)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5">
            <Stat label="Principal" value={rs(loan.principal)} />
            <Stat label="Monthly EMI" value={rs(loan.emiAmount)} />
            <Stat label="Total interest" value={rs(loan.totalInterest)} />
            <Stat label="Total payable" value={rs(loan.totalPayable)} />
            <Stat label="Outstanding" value={rs(loan.outstanding)} cls={dirColor} />
          </div>
        )}
      </div>

      {isSalary && (
        <div className="mb-4 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-sm px-4 py-2">
          This staff loan's EMIs are deducted from the monthly salary — installments are marked paid automatically when salary is calculated.
        </div>
      )}

      {isOpen ? (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Movements</h2>
              {loan.status !== 'closed' && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {rs(loan.interestAccrued)} interest accrued since {formatDate(loan.lastInterestDate)} · principal outstanding {rs(loan.outstanding)}
                </p>
              )}
            </div>
            {canEdit && loan.status !== 'closed' && (
              <div className="flex gap-2">
                <button onClick={() => setMovementKind('interest')} className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg">Record Interest</button>
                <button onClick={() => setMovementKind('principal')} className="px-3 py-1.5 text-xs font-medium text-primary-700 bg-primary-50 hover:bg-primary-100 border border-primary-200 rounded-lg">Record Principal Repayment</button>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="py-2.5 px-4">Date</th><th className="py-2.5 px-4">Type</th>
                  <th className="py-2.5 px-4 text-right">Amount</th><th className="py-2.5 px-4 text-right">Principal</th>
                  <th className="py-2.5 px-4 text-right">Interest</th><th className="py-2.5 px-4 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {movements.length === 0 ? (
                  <tr><td colSpan={6} className="py-10 text-center text-sm text-gray-400">No interest or repayments recorded yet.</td></tr>
                ) : movements.map((m) => {
                  const kind = moveType(m);
                  return (
                    <tr key={m._id}>
                      <td className="py-2.5 px-4 text-sm text-gray-600">{formatDate(m.paidDate || m.dueDate)}</td>
                      <td className="py-2.5 px-4">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${kind === 'interest' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'}`}>{kind === 'interest' ? 'INTEREST' : 'PRINCIPAL'}</span>
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-sm font-medium">{rs(m.emiAmount)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(m.principalComponent)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(m.interestComponent)}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(m.outstandingAfter)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100"><h2 className="text-sm font-semibold text-gray-700">EMI Schedule</h2></div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="py-2.5 px-4">#</th><th className="py-2.5 px-4">Due</th>
                  <th className="py-2.5 px-4 text-right">EMI</th><th className="py-2.5 px-4 text-right">Principal</th>
                  <th className="py-2.5 px-4 text-right">Interest</th><th className="py-2.5 px-4 text-right">Balance</th>
                  <th className="py-2.5 px-4">Status</th><th className="py-2.5 px-4 text-right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(loan.installments || []).map((i) => (
                  <tr key={i._id} className={i.status === 'paid' ? 'bg-green-50/30' : ''}>
                    <td className="py-2.5 px-4 text-gray-400 text-sm">{i.installmentNo}</td>
                    <td className="py-2.5 px-4 text-sm text-gray-600">{formatDate(i.dueDate)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-sm font-medium">{rs(i.emiAmount)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(i.principalComponent)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(i.interestComponent)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-sm text-gray-500">{rs(i.outstandingAfter)}</td>
                    <td className="py-2.5 px-4">
                      {i.status === 'paid'
                        ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">PAID{i.paidDate ? ` · ${formatDate(i.paidDate)}` : ''}</span>
                        : <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">PENDING</span>}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {i.status !== 'paid' && !isSalary && canEdit && (
                        <button onClick={() => setPayInst(i)} className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline">Record Payment</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <PayModal open={!!payInst} installment={payInst} loan={loan} bankAccounts={bankAccounts}
        onClose={() => setPayInst(null)} onPaid={() => { setPayInst(null); load(); }} />
      <MovementModal open={!!movementKind} kind={movementKind} loan={loan} bankAccounts={bankAccounts}
        onClose={() => setMovementKind(null)} onSaved={() => { setMovementKind(null); load(); }} />
    </div>
  );
};

export default LoanDetail;
