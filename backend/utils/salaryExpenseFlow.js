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

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

// The day a salary is finalized (IST calendar day), stored at UTC-midnight to
// match how manual expense dates are stored (see parseImportDate in
// expenseController.js). Booking on the finalize/pay day — rather than the
// salary month-end — makes payroll show up in the month it is actually
// processed, which is where users look for it.
const finalizeDate = () => {
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()));
};

const writeSalaryExpenseFlow = async (tx, record, actorId) => {
  const category = await tx.expenseCategory.findUnique({ where: { slug: 'salary' } });
  if (!category) {
    const err = new Error('expense category "salary" not found — re-run seed');
    err.status = 500;
    throw err;
  }

  try {
    await tx.expense.create({
      data: {
        date: finalizeDate(),
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
