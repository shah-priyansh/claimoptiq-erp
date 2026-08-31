import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import { HiOutlinePlus, HiOutlinePencil, HiOutlineTrash, HiOutlineChevronRight, HiOutlineX } from 'react-icons/hi';
import { useAuth } from '../../context/AuthContext';
import { useConfirm } from '../../context/ConfirmContext';
import { formatINR } from '../../utils/format';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Loader from '../../components/ui/Loader';
import {
  getLoansAPI, getLoanAPI, createLoanAPI, updateLoanAPI, deleteLoanAPI, getEmployeesAPI, getPartiesAPI, getBankAccountsAPI,
} from '../../services/api';

const rs = (n) => '₹' + formatINR(Number(n) || 0);
const todayIso = () => new Date().toISOString().slice(0, 10);

// Client-side reducing-balance EMI (mirrors backend utils/loanSchedule) for a
// live preview in the Add modal. Tenure 0 = lump sum → the full amount at once.
const previewEmi = (principal, annualRate, tenure) => {
  const P = Math.round(Number(principal) || 0);
  const n = Math.max(0, Math.round(Number(tenure) || 0));
  if (n === 0) return P;
  const r = (Number(annualRate) || 0) / 12 / 100;
  const emi = r === 0 ? P / n : (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
  return Math.round(emi || 0);
};

const STATUS_CLS = { active: 'bg-amber-50 text-amber-700', closed: 'bg-green-50 text-green-700' };

const blankForm = {
  direction: 'given', counterKind: 'staff', employeeId: '', partyId: '', counterpartyName: '',
  principal: '', annualInterestRate: '', tenureMonths: '', startDate: todayIso(),
  repaymentSource: 'manual', disburse: true, mode: 'cash', bankAccountId: '', notes: '',
};

// Map a full loan (from getLoanAPI) onto the modal form for editing.
const formFromLoan = (l) => ({
  direction: l.direction || 'given',
  counterKind: l.employeeId ? 'staff' : (l.partyId ? 'party' : 'other'),
  employeeId: l.employeeId || '',
  partyId: l.partyId || '',
  counterpartyName: l.counterpartyName || '',
  principal: l.principal != null ? String(l.principal) : '',
  annualInterestRate: l.annualInterestRate != null ? String(l.annualInterestRate) : '',
  tenureMonths: l.tenureMonths != null ? String(l.tenureMonths) : '',
  startDate: (l.startDate || '').slice(0, 10) || todayIso(),
  repaymentSource: l.repaymentSource || 'manual',
  disburse: !!l.disburseEntryId,
  mode: l.disburseMode || 'cash',
  bankAccountId: l.disburseBankAccountId || '',
  notes: l.notes || '',
});

const LoanModal = ({ open, loan, onClose, onSaved, employees, parties, bankAccounts }) => {
  const isEdit = !!loan;
  const [form, setForm] = useState(blankForm);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setForm(loan ? formFromLoan(loan) : blankForm); }, [open, loan]);
  if (!open) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const tenureN = Math.max(0, Math.round(Number(form.tenureMonths) || 0));
  const isLumpSum = tenureN === 0;
  const emi = previewEmi(form.principal, form.annualInterestRate, tenureN);
  const totalPay = emi * tenureN;
  const isStaffGiven = form.counterKind === 'staff' && form.direction === 'given';
  const needsBank = form.disburse && (form.mode === 'bank' || form.mode === 'upi');

  const submit = async (e) => {
    e.preventDefault();
    if (!(Number(form.principal) > 0)) { toast.error('Enter a principal amount'); return; }
    if (Number(form.tenureMonths) < 0) { toast.error('Tenure cannot be negative'); return; }
    if (form.counterKind === 'staff' && !form.employeeId) { toast.error('Pick a staff member'); return; }
    if (form.counterKind === 'party' && !form.partyId) { toast.error('Pick a party'); return; }
    if (form.counterKind === 'other' && !form.counterpartyName.trim()) { toast.error('Enter a name'); return; }
    setSaving(true);
    const payload = {
      direction: form.direction,
      employeeId: form.counterKind === 'staff' ? form.employeeId : null,
      partyId: form.counterKind === 'party' ? form.partyId : null,
      counterpartyName: form.counterKind === 'other' ? form.counterpartyName : '',
      principal: Number(form.principal), annualInterestRate: Number(form.annualInterestRate) || 0,
      tenureMonths: Number(form.tenureMonths), startDate: form.startDate,
      repaymentSource: isStaffGiven ? form.repaymentSource : 'manual',
      disburse: form.disburse, mode: form.mode, bankAccountId: needsBank ? form.bankAccountId : null,
      notes: form.notes,
    };
    try {
      if (isEdit) { await updateLoanAPI(loan._id, payload); toast.success('Loan updated'); }
      else { await createLoanAPI(payload); toast.success('Loan added'); }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || `Failed to ${isEdit ? 'update' : 'add'} loan`);
    } finally { setSaving(false); }
  };

  const label = 'block text-sm font-medium text-gray-700 mb-1';
  const input = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
  const dirBtn = (active) => `flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${active ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="text-lg font-semibold text-gray-800">{isEdit ? 'Edit Loan' : 'Add Loan'}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><HiOutlineX className="w-5 h-5 text-gray-500" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="flex gap-2">
            <button type="button" className={dirBtn(form.direction === 'given')} onClick={() => set('direction', 'given')}>Given (we lent) — money out</button>
            <button type="button" className={dirBtn(form.direction === 'taken')} onClick={() => set('direction', 'taken')}>Taken (we borrowed) — money in</button>
          </div>

          <div>
            <label className={label}>Counterparty</label>
            <div className="flex gap-2 mb-2">
              {['staff', 'party', 'other'].map((k) => (
                <button key={k} type="button" onClick={() => set('counterKind', k)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.counterKind === k ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-600'}`}>
                  {k === 'staff' ? 'Staff' : k === 'party' ? 'Party' : 'Other'}
                </button>
              ))}
            </div>
            {form.counterKind === 'staff' && (
              <SearchableSelect value={form.employeeId} onChange={(v) => set('employeeId', v)} placeholder="Select staff member"
                searchPlaceholder="Search staff..." options={employees.map((e) => ({ value: e._id, label: `${e.name}${e.empNumber ? ` (${e.empNumber})` : ''}` }))} />
            )}
            {form.counterKind === 'party' && (
              <SearchableSelect value={form.partyId} onChange={(v) => set('partyId', v)} placeholder="Select party"
                searchPlaceholder="Search parties..." options={parties.map((p) => ({ value: p._id, label: p.name }))} />
            )}
            {form.counterKind === 'other' && (
              <input className={input} value={form.counterpartyName} placeholder="Name of borrower / lender"
                onChange={(e) => set('counterpartyName', e.target.value)} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className={label}>Principal (₹) *</label><input type="number" min="0" className={input} value={form.principal} onChange={(e) => set('principal', e.target.value)} /></div>
            <div><label className={label}>Interest Rate (% / year)</label><input type="number" min="0" step="0.01" className={input} value={form.annualInterestRate} onChange={(e) => set('annualInterestRate', e.target.value)} placeholder="0" /></div>
            <div><label className={label}>Tenure (months)</label><input type="number" min="0" className={input} value={form.tenureMonths} onChange={(e) => set('tenureMonths', e.target.value)} placeholder="0 = lump sum (no EMI)" /></div>
            <div><label className={label}>Start Date *</label><input type="date" className={input} value={form.startDate} onChange={(e) => set('startDate', e.target.value)} /></div>
          </div>

          {isStaffGiven && (
            <div>
              <label className={label}>Staff repayment</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => set('repaymentSource', 'manual')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.repaymentSource === 'manual' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-600'}`}>Repaid separately</button>
                <button type="button" onClick={() => set('repaymentSource', 'salary')} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${form.repaymentSource === 'salary' ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-600'}`}>Deduct from salary</button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-gray-200 p-3 bg-gray-50/60">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <input type="checkbox" checked={form.disburse} onChange={(e) => set('disburse', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-primary-600" />
              {form.direction === 'given' ? 'Disburse now (record cash/bank OUT)' : 'Received now (record cash/bank IN)'}
            </label>
            {form.disburse && (
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><label className={label}>Mode</label>
                  <SearchableSelect value={form.mode} onChange={(v) => set('mode', v)} options={[{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'upi', label: 'UPI' }]} /></div>
                {needsBank && (
                  <div><label className={label}>Bank Account</label>
                    <SearchableSelect value={form.bankAccountId} onChange={(v) => set('bankAccountId', v)} placeholder="Select bank"
                      options={bankAccounts.map((b) => ({ value: b._id, label: `${b.bankName}${b.accountNumber ? ` — ${b.accountNumber}` : ''}` }))} /></div>
                )}
              </div>
            )}
          </div>

          <div><label className={label}>Notes</label><textarea rows={2} className={input} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>

          <div className="flex items-center justify-between rounded-lg bg-primary-50 px-4 py-3">
            <span className="text-sm text-primary-700 font-medium">{isLumpSum ? 'Total (lump sum)' : 'Monthly EMI'}</span>
            <span className="text-lg font-bold text-primary-700">{rs(emi)}</span>
          </div>
          {isLumpSum
            ? (emi > 0 && <p className="text-xs text-gray-400 -mt-2">One-time repayment — no EMI schedule. Set a tenure above 0 to split into monthly EMIs.</p>)
            : (emi > 0 && <p className="text-xs text-gray-400 -mt-2">Total payable over {form.tenureMonths || 0} months ≈ {rs(totalPay)} (reducing balance).</p>)}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 rounded-lg">{saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Add Loan')}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

const LoansPage = () => {
  const { can } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const canCreate = can('loans', 'create');
  const canEdit = can('loans', 'edit');
  const canDelete = can('loans', 'delete');

  const [loans, setLoans] = useState([]);
  const [totals, setTotals] = useState({ given: 0, taken: 0, count: 0 });
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editLoan, setEditLoan] = useState(null);
  const [filter, setFilter] = useState({ direction: '', status: '' });
  const [employees, setEmployees] = useState([]);
  const [parties, setParties] = useState([]);
  const [bankAccounts, setBankAccounts] = useState([]);

  const load = () => {
    setLoading(true);
    const params = {};
    if (filter.direction) params.direction = filter.direction;
    if (filter.status) params.status = filter.status;
    getLoansAPI(params)
      .then(({ data }) => { setLoans(data.loans || []); setTotals(data.totals || { given: 0, taken: 0, count: 0 }); })
      .catch(() => toast.error('Failed to load loans'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);
  useEffect(() => {
    getEmployeesAPI({ active: 'true' }).then(({ data }) => setEmployees(Array.isArray(data) ? data : data.employees || [])).catch(() => {});
    getPartiesAPI().then(({ data }) => setParties(data || [])).catch(() => {});
    getBankAccountsAPI({ active: 'true' }).then(({ data }) => setBankAccounts(data || [])).catch(() => {});
  }, []);

  const del = async (loan) => {
    if (!(await confirm(`Delete the ${rs(loan.principal)} loan for ${loan.counterparty}?`, { title: 'Delete Loan', confirmLabel: 'Delete' }))) return;
    try { await deleteLoanAPI(loan._id); toast.success('Loan deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to delete'); }
  };

  // Fetch full loan details (incl. disburse mode/bank) before opening the editor.
  const openEdit = async (loan) => {
    try { const { data } = await getLoanAPI(loan._id); setEditLoan(data); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed to load loan'); }
  };

  const fCls = (active) => `px-3 py-1.5 rounded-lg text-sm font-medium border ${active ? 'bg-primary-50 border-primary-300 text-primary-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-800">Loans</h1>
        {canCreate && (
          <button onClick={() => setAddOpen(true)} className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium">
            <HiOutlinePlus className="w-4 h-4" /> Add Loan
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-wide text-gray-400">Receivable (given)</p><p className="text-2xl font-bold text-green-700 mt-1">{rs(totals.given)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-wide text-gray-400">Payable (taken)</p><p className="text-2xl font-bold text-red-700 mt-1">{rs(totals.taken)}</p></div>
        <div className="bg-white rounded-xl border border-gray-200 p-4"><p className="text-xs uppercase tracking-wide text-gray-400">Active loans</p><p className="text-2xl font-bold text-gray-800 mt-1">{totals.count}</p></div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <button className={fCls(!filter.direction)} onClick={() => setFilter((f) => ({ ...f, direction: '' }))}>All</button>
        <button className={fCls(filter.direction === 'given')} onClick={() => setFilter((f) => ({ ...f, direction: 'given' }))}>Given</button>
        <button className={fCls(filter.direction === 'taken')} onClick={() => setFilter((f) => ({ ...f, direction: 'taken' }))}>Taken</button>
        <span className="w-px bg-gray-200 mx-1" />
        <button className={fCls(!filter.status)} onClick={() => setFilter((f) => ({ ...f, status: '' }))}>Any status</button>
        <button className={fCls(filter.status === 'active')} onClick={() => setFilter((f) => ({ ...f, status: 'active' }))}>Active</button>
        <button className={fCls(filter.status === 'closed')} onClick={() => setFilter((f) => ({ ...f, status: 'closed' }))}>Closed</button>
      </div>

      {loading ? <Loader className="py-16" /> : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr className="text-left text-xs font-semibold text-gray-500 uppercase">
                  <th className="py-3 px-4">Counterparty</th><th className="py-3 px-4">Dir</th>
                  <th className="py-3 px-4 text-right">Principal</th><th className="py-3 px-4 text-right">Rate</th>
                  <th className="py-3 px-4 text-right">EMI</th><th className="py-3 px-4 text-right">Outstanding</th>
                  <th className="py-3 px-4 text-center">EMIs</th><th className="py-3 px-4">Status</th><th className="py-3 px-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {loans.length === 0 ? (
                  <tr><td colSpan={9} className="py-10 text-center text-sm text-gray-400">No loans yet.</td></tr>
                ) : loans.map((l) => (
                  <tr key={l._id} className="hover:bg-gray-50 cursor-pointer" onClick={() => navigate(`/loans/${l._id}`)}>
                    <td className="py-3 px-4"><span className="text-sm font-medium text-gray-800">{l.counterparty}</span>{l.employee && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">Staff</span>}</td>
                    <td className="py-3 px-4"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${l.direction === 'given' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>{l.direction === 'given' ? 'GIVEN' : 'TAKEN'}</span></td>
                    <td className="py-3 px-4 text-right tabular-nums">{rs(l.principal)}</td>
                    <td className="py-3 px-4 text-right tabular-nums text-gray-500">{l.annualInterestRate || 0}%</td>
                    <td className="py-3 px-4 text-right tabular-nums">{rs(l.emiAmount)}</td>
                    <td className="py-3 px-4 text-right tabular-nums font-medium">{rs(l.outstanding)}</td>
                    <td className="py-3 px-4 text-center text-xs text-gray-500">{l.paidInstallments}/{l.totalInstallments}</td>
                    <td className="py-3 px-4"><span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_CLS[l.status] || ''}`}>{(l.status || '').toUpperCase()}</span></td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {canEdit && l.paidInstallments === 0 && (
                        <button onClick={(e) => { e.stopPropagation(); openEdit(l); }} title="Edit" className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded"><HiOutlinePencil className="w-4 h-4" /></button>
                      )}
                      {canDelete && l.paidInstallments === 0 && (
                        <button onClick={(e) => { e.stopPropagation(); del(l); }} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"><HiOutlineTrash className="w-4 h-4" /></button>
                      )}
                      <HiOutlineChevronRight className="w-4 h-4 text-gray-300 inline-block ml-1" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <LoanModal open={addOpen || !!editLoan} loan={editLoan}
        onClose={() => { setAddOpen(false); setEditLoan(null); }}
        onSaved={() => { setAddOpen(false); setEditLoan(null); load(); }}
        employees={employees} parties={parties} bankAccounts={bankAccounts} />
    </div>
  );
};

export default LoansPage;
