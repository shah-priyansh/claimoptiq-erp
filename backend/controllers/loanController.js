const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');
const { buildSchedule, outstandingPrincipal, round } = require('../utils/loanSchedule');

const loanInclude = {
  employee: { select: { id: true, name: true, empNumber: true } },
  party: { select: { id: true, name: true } },
  installments: { orderBy: { installmentNo: 'asc' } },
};

const VALID_MODES = ['cash', 'bank', 'upi'];

// Resolve how loan money moves through the cashbook (mirror of the expense flow):
// bank/upi need a bank account (falls back to the default), cash never carries one.
const resolveCashMode = async (body) => {
  const raw = String(body.mode ?? 'cash').trim().toLowerCase();
  const mode = VALID_MODES.includes(raw) ? raw : 'cash';
  let bankAccountId = body.bankAccountId || null;
  if (mode === 'bank' || mode === 'upi') {
    if (!bankAccountId) {
      const def = await prisma.bankAccount.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
      bankAccountId = def?.id || null;
    }
    if (!bankAccountId) throw { status: 400, message: 'Bank / UPI needs a bank account. Add one in Settings → Bank Accounts.' };
    const acct = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { id: true, isActive: true } });
    if (!acct || !acct.isActive) throw { status: 400, message: 'Bank account not found or inactive' };
  } else {
    bankAccountId = null;
  }
  return { mode, bankAccountId };
};

// Display name for a loan's counterparty.
const counterpartyLabel = (loan) =>
  loan.employee?.name || loan.party?.name || loan.counterpartyName || (loan.direction === 'given' ? 'Borrower' : 'Lender');

// Shape a loan for the API: attach computed outstanding + progress.
const shape = (loan) => {
  const outstanding = outstandingPrincipal(loan);
  const paidCount = (loan.installments || []).filter((i) => i.status === 'paid').length;
  const totalInterest = (loan.installments || []).reduce((s, i) => s + (i.interestComponent || 0), 0);
  return {
    ...toResponse(loan),
    counterparty: counterpartyLabel(loan),
    outstanding,
    paidInstallments: paidCount,
    totalInstallments: (loan.installments || []).length,
    totalInterest: round(totalInterest),
    totalPayable: round(loan.principal) + round(totalInterest),
  };
};

exports.list = async (req, res) => {
  try {
    const { direction, status } = req.query;
    const where = {};
    if (direction) where.direction = direction;
    if (status) where.status = status;
    const loans = await prisma.loan.findMany({ where, include: loanInclude, orderBy: { createdAt: 'desc' } });
    const rows = loans.map(shape);
    const totals = {
      given: rows.filter((l) => l.direction === 'given').reduce((s, l) => s + l.outstanding, 0),
      taken: rows.filter((l) => l.direction === 'taken').reduce((s, l) => s + l.outstanding, 0),
      count: rows.length,
    };
    res.json({ loans: rows, totals });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const loan = await prisma.loan.findUnique({ where: { id: req.params.id }, include: loanInclude });
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    const out = shape(loan);
    // Surface the disbursement's cash mode / bank so the edit form can prefill it
    // (the mode lives on the linked cashbook entry, not the loan row).
    if (loan.disburseEntryId) {
      const entry = await prisma.cashBankEntry.findUnique({ where: { id: loan.disburseEntryId }, select: { mode: true, bankAccountId: true } });
      out.disburseMode = entry?.mode || 'cash';
      out.disburseBankAccountId = entry?.bankAccountId || null;
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

exports.create = async (req, res) => {
  try {
    const b = req.body;
    const direction = b.direction === 'taken' ? 'taken' : 'given';
    const principal = round(b.principal);
    const tenureMonths = Math.round(Number(b.tenureMonths) || 0);
    const annualInterestRate = Number(b.annualInterestRate) || 0;
    if (!(principal > 0)) return res.status(400).json({ message: 'Principal must be greater than 0' });
    if (tenureMonths < 0) return res.status(400).json({ message: 'Tenure (months) cannot be negative' });
    if (!b.startDate) return res.status(400).json({ message: 'Start date is required' });

    const employeeId = b.employeeId || null;
    const partyId = employeeId ? null : (b.partyId || null);
    // Salary repayment only makes sense for a staff loan we gave out.
    const repaymentSource = (employeeId && direction === 'given' && b.repaymentSource === 'salary') ? 'salary' : 'manual';

    const { emi, rows } = buildSchedule({ principal, annualInterestRate, tenureMonths, startDate: b.startDate });

    // Disburse: mirror the principal into the cashbook. 'given' = money OUT,
    // 'taken' = money IN. Only when the caller opts in (disburse !== false) —
    // salary repayment loans and off-book loans can skip it.
    const disburse = b.disburse !== false && b.disburse !== 'false';
    const payment = disburse ? await resolveCashMode(b) : null;

    const loan = await prisma.$transaction(async (tx) => {
      const created = await tx.loan.create({
        data: {
          direction, principal, annualInterestRate, tenureMonths,
          startDate: new Date(b.startDate), emiAmount: emi, repaymentSource,
          employeeId, partyId, counterpartyName: String(b.counterpartyName || '').slice(0, 200),
          notes: String(b.notes || '').slice(0, 1000),
          status: 'active', createdById: req.user?.id || null,
        },
      });
      await tx.loanInstallment.createMany({ data: rows.map((r) => ({ ...r, loanId: created.id })) });

      if (payment) {
        const full = await tx.loan.findUnique({ where: { id: created.id }, include: { employee: true, party: true } });
        const name = counterpartyLabel(full);
        const entry = await tx.cashBankEntry.create({
          data: {
            date: new Date(b.startDate),
            direction: direction === 'given' ? 'out' : 'in',
            mode: payment.mode, amount: principal, bankAccountId: payment.bankAccountId,
            notes: `[Loan] ${direction === 'given' ? 'Disbursed to' : 'Received from'} ${name}`.slice(0, 1000),
            createdById: req.user?.id || null,
          },
        });
        await tx.loan.update({ where: { id: created.id }, data: { disbursedAt: new Date(b.startDate), disburseEntryId: entry.id } });
      }
      return tx.loan.findUnique({ where: { id: created.id }, include: loanInclude });
    });
    res.status(201).json(shape(loan));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Edit a loan — only while nothing has been repaid (same guard as delete), so we
// can safely rebuild the whole installment schedule. Keeps the disbursement
// cashbook entry in sync: updates it in place, creates it if newly disbursed, or
// removes it if disbursement was turned off.
exports.update = async (req, res) => {
  try {
    const existing = await prisma.loan.findUnique({ where: { id: req.params.id }, include: { installments: true } });
    if (!existing) return res.status(404).json({ message: 'Loan not found' });
    if (existing.installments.some((i) => i.status === 'paid')) {
      return res.status(400).json({ message: 'Cannot edit a loan with recorded EMI payments. Reverse the payments first.' });
    }

    const b = req.body;
    const direction = b.direction === 'taken' ? 'taken' : 'given';
    const principal = round(b.principal);
    const tenureMonths = Math.round(Number(b.tenureMonths) || 0);
    const annualInterestRate = Number(b.annualInterestRate) || 0;
    if (!(principal > 0)) return res.status(400).json({ message: 'Principal must be greater than 0' });
    if (tenureMonths < 0) return res.status(400).json({ message: 'Tenure (months) cannot be negative' });
    if (!b.startDate) return res.status(400).json({ message: 'Start date is required' });

    const employeeId = b.employeeId || null;
    const partyId = employeeId ? null : (b.partyId || null);
    const repaymentSource = (employeeId && direction === 'given' && b.repaymentSource === 'salary') ? 'salary' : 'manual';

    const { emi, rows } = buildSchedule({ principal, annualInterestRate, tenureMonths, startDate: b.startDate });

    const disburse = b.disburse !== false && b.disburse !== 'false';
    const payment = disburse ? await resolveCashMode(b) : null;

    const loan = await prisma.$transaction(async (tx) => {
      await tx.loan.update({
        where: { id: existing.id },
        data: {
          direction, principal, annualInterestRate, tenureMonths,
          startDate: new Date(b.startDate), emiAmount: emi, repaymentSource,
          employeeId, partyId, counterpartyName: String(b.counterpartyName || '').slice(0, 200),
          notes: String(b.notes || '').slice(0, 1000),
        },
      });
      // Nothing is paid, so rebuild the schedule from scratch.
      await tx.loanInstallment.deleteMany({ where: { loanId: existing.id } });
      await tx.loanInstallment.createMany({ data: rows.map((r) => ({ ...r, loanId: existing.id })) });

      const full = await tx.loan.findUnique({ where: { id: existing.id }, include: { employee: true, party: true } });
      const name = counterpartyLabel(full);
      if (payment) {
        const entryData = {
          date: new Date(b.startDate),
          direction: direction === 'given' ? 'out' : 'in',
          mode: payment.mode, amount: principal, bankAccountId: payment.bankAccountId,
          notes: `[Loan] ${direction === 'given' ? 'Disbursed to' : 'Received from'} ${name}`.slice(0, 1000),
        };
        if (existing.disburseEntryId) {
          await tx.cashBankEntry.update({ where: { id: existing.disburseEntryId }, data: entryData });
        } else {
          const entry = await tx.cashBankEntry.create({ data: { ...entryData, createdById: req.user?.id || null } });
          await tx.loan.update({ where: { id: existing.id }, data: { disbursedAt: new Date(b.startDate), disburseEntryId: entry.id } });
        }
      } else if (existing.disburseEntryId) {
        // Disbursement turned off — remove its cashbook footprint.
        await tx.cashBankEntry.deleteMany({ where: { id: existing.disburseEntryId } });
        await tx.loan.update({ where: { id: existing.id }, data: { disbursedAt: null, disburseEntryId: null } });
      }
      return tx.loan.findUnique({ where: { id: existing.id }, include: loanInclude });
    });
    res.json(shape(loan));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Record an EMI payment for a single installment. Creates the matching cashbook
// entry: a 'given' loan's EMI comes IN (repayment received), a 'taken' loan's
// EMI goes OUT (we pay). Closes the loan once every installment is paid.
exports.recordPayment = async (req, res) => {
  try {
    const inst = await prisma.loanInstallment.findUnique({ where: { id: req.params.installmentId }, include: { loan: { include: { employee: true, party: true } } } });
    if (!inst) return res.status(404).json({ message: 'Installment not found' });
    if (inst.status === 'paid') return res.status(400).json({ message: 'This installment is already paid' });
    const loan = inst.loan;
    if (loan.repaymentSource === 'salary') {
      return res.status(400).json({ message: 'This is a salary-deducted staff loan — its EMIs are settled from the monthly salary, not here.' });
    }

    const payment = await resolveCashMode(req.body);
    const name = counterpartyLabel(loan);
    const paidDate = req.body.date ? new Date(req.body.date) : new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.cashBankEntry.create({
        data: {
          date: paidDate,
          direction: loan.direction === 'given' ? 'in' : 'out',
          mode: payment.mode, amount: inst.emiAmount, bankAccountId: payment.bankAccountId,
          notes: `[Loan EMI #${inst.installmentNo}] ${loan.direction === 'given' ? 'from' : 'to'} ${name}`.slice(0, 1000),
          createdById: req.user?.id || null,
        },
      });
      await tx.loanInstallment.update({
        where: { id: inst.id },
        data: { status: 'paid', paidAmount: inst.emiAmount, paidDate, cashBankEntryId: entry.id },
      });
      const remaining = await tx.loanInstallment.count({ where: { loanId: loan.id, status: { not: 'paid' } } });
      if (remaining === 0) await tx.loan.update({ where: { id: loan.id }, data: { status: 'closed' } });
      return tx.loan.findUnique({ where: { id: loan.id }, include: loanInclude });
    });
    res.json(shape(updated));
  } catch (e) {
    if (e.status) return res.status(e.status).json({ message: e.message });
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Delete a loan and its cashbook footprint — only while nothing has been repaid
// (beyond a possible disbursement), to keep the books consistent.
exports.remove = async (req, res) => {
  try {
    const loan = await prisma.loan.findUnique({ where: { id: req.params.id }, include: { installments: true } });
    if (!loan) return res.status(404).json({ message: 'Loan not found' });
    if (loan.installments.some((i) => i.status === 'paid')) {
      return res.status(400).json({ message: 'Cannot delete a loan with recorded EMI payments. Reverse the payments first.' });
    }
    await prisma.$transaction(async (tx) => {
      if (loan.disburseEntryId) await tx.cashBankEntry.deleteMany({ where: { id: loan.disburseEntryId } });
      await tx.loan.delete({ where: { id: loan.id } }); // installments cascade
    });
    res.json({ message: 'Loan deleted' });
  } catch (e) {
    res.status(500).json({ message: 'Server error', error: e.message });
  }
};

// Live totals for reports / Balance Sheet: outstanding principal per direction,
// and interest realised (given) / incurred (taken) from PAID installments.
exports.loanTotals = async () => {
  const loans = await prisma.loan.findMany({ include: { installments: true } });
  let receivable = 0, payable = 0, interestIncome = 0, interestExpense = 0;
  for (const l of loans) {
    const out = outstandingPrincipal(l);
    const paidInterest = l.installments.filter((i) => i.status === 'paid').reduce((s, i) => s + (i.interestComponent || 0), 0);
    if (l.direction === 'given') { receivable += out; interestIncome += paidInterest; }
    else { payable += out; interestExpense += paidInterest; }
  }
  return { receivable: round(receivable), payable: round(payable), interestIncome: round(interestIncome), interestExpense: round(interestExpense) };
};
