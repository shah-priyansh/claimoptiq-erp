import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { HiOutlineArrowLeft, HiOutlineX } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { formatINR, formatDate } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Loader from '../../components/ui/Loader';
import { getLoanAPI, recordLoanPaymentAPI, getBankAccountsAPI } from '../../services/api';

const rs = (n) => '₹' + formatINR(Math.round(Number(n) || 0));
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

  const load = () => {
    getLoanAPI(id).then(({ data }) => setLoan(data)).catch(() => { toast.error('Loan not found'); navigate('/loans'); }).finally(() => setLoading(false));
  };
  useEffect(() => { load(); getBankAccountsAPI({ active: 'true' }).then(({ data }) => setBankAccounts(data || [])).catch(() => {}); /* eslint-disable-next-line */ }, [id]);

  if (loading || !loan) return <Loader label="Loading loan…" className="h-64" />;

  const isSalary = loan.repaymentSource === 'salary';
  const dirColor = loan.direction === 'given' ? 'text-green-700' : 'text-red-700';

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
            </div>
            <p className="text-sm text-gray-400 mt-1">{loan.annualInterestRate || 0}% / yr · {loan.tenureMonths} months · started {formatDate(loan.startDate)}{isSalary ? ' · repaid from salary' : ''}</p>
          </div>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${loan.status === 'closed' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>{(loan.status || '').toUpperCase()}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5">
          <Stat label="Principal" value={rs(loan.principal)} />
          <Stat label="Monthly EMI" value={rs(loan.emiAmount)} />
          <Stat label="Total interest" value={rs(loan.totalInterest)} />
          <Stat label="Total payable" value={rs(loan.totalPayable)} />
          <Stat label="Outstanding" value={rs(loan.outstanding)} cls={dirColor} />
        </div>
      </div>

      {isSalary && (
        <div className="mb-4 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-800 text-sm px-4 py-2">
          This staff loan's EMIs are deducted from the monthly salary — installments are marked paid automatically when salary is calculated.
        </div>
      )}

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

      <PayModal open={!!payInst} installment={payInst} loan={loan} bankAccounts={bankAccounts}
        onClose={() => setPayInst(null)} onPaid={() => { setPayInst(null); load(); }} />
    </div>
  );
};

export default LoanDetail;
