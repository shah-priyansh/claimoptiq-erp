// Salary Finalize -> Expense Auto Flow.
//
// When a SalaryRecord is finalized, write a single Expense row against the
// seeded 'salary' ExpenseCategory so payroll shows up in Expenses / P&L /
// Cash-Bank reports (mirrors the reference-commission auto flow in
// referenceCommissionFlow.js). Reverting a record to draft removes that row.
// Idempotent via the @@unique([sourceType, sourceLineId]) index on Expense —
// the SalaryRecord id is the dedupe key (one record -> one expense row).

const SOURCE_TYPE = 'staff_salary';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (month) => `${MONTH_NAMES[month.getUTCMonth()]} ${month.getUTCFullYear()}`;

const writeSalaryExpenseFlow = async (tx, record, actorId) => {
  const category = await tx.expenseCategory.findUnique({ where: { slug: 'salary' } });
  if (!category) {
    const err = new Error('expense category "salary" not found — re-run seed');
    err.status = 500;
    throw err;
  }

  const y = record.month.getUTCFullYear();
  const m = record.month.getUTCMonth();
  // Booked on the last day of the paid month (accrual date), not the day it
  // happens to be finalized.
  const monthEnd = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));

  try {
    await tx.expense.create({
      data: {
        date: monthEnd,
        categoryId: category.id,
        amount: record.totalAmount,
        notes: `Auto: Salary — ${record.employee.name} (${monthLabel(record.month)})`,
        partyName: record.employee.name,
        sourceType: SOURCE_TYPE,
        sourceId: record.id,
        sourceLineId: record.id,
        createdById: actorId || null,
      },
    });
  } catch (err) {
    // P2002 = unique-constraint violation on (sourceType, sourceLineId) ->
    // idempotency hit, row already written.
    if (err.code !== 'P2002') throw err;
  }
};

// Called when a finalized record is reverted to draft. Removes the auto-row
// this flow previously wrote for it.
const clearSalaryExpenseFlow = async (tx, recordId) => {
  await tx.expense.deleteMany({ where: { sourceType: SOURCE_TYPE, sourceId: recordId } });
};

module.exports = { SOURCE_TYPE, writeSalaryExpenseFlow, clearSalaryExpenseFlow };
