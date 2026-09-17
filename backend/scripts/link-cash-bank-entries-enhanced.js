require('dotenv').config();
const prisma = require('../config/prisma');

async function linkCashBankEntriesEnhanced(limit = 30) {
  try {
    console.log('🔍 Fetching unlinked cash/bank entries...');

    // Get unlinked entries (last 30 by date descending)
    const unlinkedEntries = await prisma.cashBankEntry.findMany({
      where: {
        AND: [
          { invoiceId: null },
          { expenseId: null },
        ],
      },
      orderBy: { date: 'desc' },
      take: limit,
    });

    console.log(`\n📊 Found ${unlinkedEntries.length} unlinked entries\n`);

    const results = {
      processed: 0,
      linked: 0,
      failed: 0,
      details: [],
    };

    // Process each entry
    for (const entry of unlinkedEntries) {
      results.processed++;
      console.log(`[${results.processed}/${unlinkedEntries.length}] Entry ${entry.id.substring(0, 8)}... | Amount: ₹${entry.amount} | Date: ${entry.date.toISOString().split('T')[0]}`);

      try {
        let matched = false;

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 1: Exact Match (amount + same-day)
        // ═══════════════════════════════════════════════════════════════
        let matchedRecord = await findExactMatch(entry);
        if (matchedRecord) {
          if (matchedRecord.type === 'invoice') {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { invoiceId: matchedRecord.id },
            });
            results.details.push({
              entryId: entry.id,
              type: 'invoice_exact',
              linkedId: matchedRecord.id,
              amount: entry.amount,
              date: entry.date,
              linkedNumber: matchedRecord.invoiceNumber,
              matchType: 'Exact Amount Match',
            });
            console.log(`   ✅ [EXACT] Linked to Invoice: ${matchedRecord.invoiceNumber}`);
            results.linked++;
            matched = true;
          } else if (matchedRecord.type === 'expense') {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { expenseId: matchedRecord.id },
            });
            results.details.push({
              entryId: entry.id,
              type: 'expense_exact',
              linkedId: matchedRecord.id,
              amount: entry.amount,
              date: entry.date,
              notes: matchedRecord.notes,
              matchType: 'Exact Amount Match',
            });
            console.log(`   ✅ [EXACT] Linked to Expense: ${matchedRecord.notes}`);
            results.linked++;
            matched = true;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 2: Invoice Payment (for "in" direction, look at invoice amounts)
        // ═══════════════════════════════════════════════════════════════
        if (!matched && entry.direction === 'in') {
          matchedRecord = await findInvoicePaymentMatch(entry);
          if (matchedRecord) {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { invoiceId: matchedRecord.id },
            });
            results.details.push({
              entryId: entry.id,
              type: 'invoice_fuzzy',
              linkedId: matchedRecord.id,
              amount: entry.amount,
              date: entry.date,
              linkedNumber: matchedRecord.invoiceNumber,
              matchType: `Fuzzy Match (amount: ±${matchedRecord.tolerance}%, date: ±${matchedRecord.dateDays}d)`,
            });
            console.log(
              `   ✅ [FUZZY] Linked to Invoice: ${matchedRecord.invoiceNumber} (amount tolerance: ±${matchedRecord.tolerance}%, date tolerance: ±${matchedRecord.dateDays} days)`
            );
            results.linked++;
            matched = true;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 3: Expense Amount Tolerance (±5%)
        // ═══════════════════════════════════════════════════════════════
        if (!matched && entry.direction === 'out') {
          matchedRecord = await findExpenseWithTolerance(entry, 5);
          if (matchedRecord) {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { expenseId: matchedRecord.id },
            });
            results.details.push({
              entryId: entry.id,
              type: 'expense_fuzzy',
              linkedId: matchedRecord.id,
              amount: entry.amount,
              date: entry.date,
              notes: matchedRecord.notes,
              matchType: `Fuzzy Match (amount: ±5%, date: ±${matchedRecord.dateDays}d)`,
            });
            console.log(`   ✅ [FUZZY] Linked to Expense: ${matchedRecord.notes}`);
            results.linked++;
            matched = true;
          }
        }

        if (!matched) {
          results.details.push({
            entryId: entry.id,
            type: 'not_found',
            amount: entry.amount,
            date: entry.date,
          });
          console.log(`   ⚠️  No matching invoice/expense found`);
        }
      } catch (error) {
        results.failed++;
        results.details.push({
          entryId: entry.id,
          type: 'error',
          error: error.message,
        });
        console.error(`   ❌ Error: ${error.message}`);
      }
    }

    // Print summary
    printSummary(results);

    return results;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHING STRATEGIES
// ═══════════════════════════════════════════════════════════════════════════

async function findExactMatch(entry) {
  // Exact amount + same day match for expenses
  const startOfDay = new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate());
  const endOfDay = new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate() + 1);

  // Try expense first
  const expense = await prisma.expense.findFirst({
    where: {
      amount: entry.amount,
      date: { gte: startOfDay, lt: endOfDay },
    },
  });

  if (expense) {
    return { type: 'expense', id: expense.id, notes: expense.notes };
  }

  // Try invoice for "in" direction
  if (entry.direction === 'in') {
    const invoice = await prisma.invoice.findFirst({
      where: {
        grandTotal: entry.amount,
        issuedAt: { gte: startOfDay, lt: endOfDay },
      },
    });
    if (invoice) {
      return { type: 'invoice', id: invoice.id, invoiceNumber: invoice.invoiceNumber };
    }
  }

  return null;
}

async function findInvoicePaymentMatch(entry) {
  // For "in" entries, match with invoices allowing for amount/date tolerance
  const dayRange = 3; // ±3 days
  const tolerancePercent = 5; // ±5%

  const startDate = new Date(entry.date);
  startDate.setDate(startDate.getDate() - dayRange);
  const endDate = new Date(entry.date);
  endDate.setDate(endDate.getDate() + dayRange);

  // Look for invoices with similar grand_total
  const invoices = await prisma.invoice.findMany({
    where: {
      issuedAt: { gte: startDate, lte: endDate },
      grandTotal: {
        gte: entry.amount * (1 - tolerancePercent / 100),
        lte: entry.amount * (1 + tolerancePercent / 100),
      },
    },
    orderBy: {
      grandTotal: 'asc',
    },
    take: 1,
  });

  if (invoices.length > 0) {
    const invoice = invoices[0];
    const actualTolerance = Math.abs(
      ((invoice.grandTotal - entry.amount) / entry.amount) * 100
    ).toFixed(1);
    return {
      type: 'invoice',
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      tolerance: actualTolerance,
      dateDays: dayRange,
    };
  }

  return null;
}

async function findExpenseWithTolerance(entry, tolerancePercent) {
  // For "out" entries, match expenses with tolerance
  const dayRange = 3; // ±3 days

  const startDate = new Date(entry.date);
  startDate.setDate(startDate.getDate() - dayRange);
  const endDate = new Date(entry.date);
  endDate.setDate(endDate.getDate() + dayRange);

  const expenses = await prisma.expense.findMany({
    where: {
      date: { gte: startDate, lte: endDate },
      amount: {
        gte: entry.amount * (1 - tolerancePercent / 100),
        lte: entry.amount * (1 + tolerancePercent / 100),
      },
    },
    orderBy: {
      amount: 'asc',
    },
    take: 1,
  });

  if (expenses.length > 0) {
    const expense = expenses[0];
    const actualTolerance = Math.abs(((expense.amount - entry.amount) / entry.amount) * 100).toFixed(
      1
    );
    return {
      type: 'expense',
      id: expense.id,
      notes: expense.notes,
      tolerance: actualTolerance,
      dateDays: dayRange,
    };
  }

  return null;
}

function printSummary(results) {
  const linked = results.details.filter(d => d.type !== 'not_found' && d.type !== 'error');
  const notFound = results.details.filter(d => d.type === 'not_found');

  console.log('\n════════════════════════════════════════════════════════════');
  console.log('📈 LINKING SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`Total Processed: ${results.processed}`);
  console.log(`Successfully Linked: ${results.linked} (${((results.linked / results.processed) * 100).toFixed(1)}%)`);
  console.log(`Failed: ${results.failed}`);
  console.log(`Not Found: ${notFound.length}`);
  console.log('════════════════════════════════════════════════════════════\n');

  if (linked.length > 0) {
    console.log('📋 LINKED ENTRIES:');
    linked.forEach((detail, idx) => {
      const typeLabel = detail.type.includes('invoice') ? '📄 Invoice' : '💰 Expense';
      console.log(
        `${idx + 1}. ${typeLabel} | Amount: ₹${detail.amount} | Date: ${new Date(detail.date)
          .toISOString()
          .split('T')[0]} | ${detail.matchType}`
      );
      if (detail.linkedNumber) console.log(`   → ${detail.linkedNumber}`);
      if (detail.notes) console.log(`   → ${detail.notes}`);
    });
    console.log();
  }

  if (notFound.length > 0) {
    console.log(`⚠️  UNMATCHED ENTRIES (${notFound.length}):`);
    notFound.slice(0, 5).forEach((detail, idx) => {
      console.log(
        `${idx + 1}. Amount: ₹${detail.amount} | Date: ${new Date(detail.date).toISOString().split('T')[0]}`
      );
    });
    if (notFound.length > 5) {
      console.log(`... and ${notFound.length - 5} more`);
    }
    console.log();
  }

  console.log('✅ Script completed!');
}

// Run
const limit = process.argv[2] ? parseInt(process.argv[2]) : 30;
linkCashBankEntriesEnhanced(limit)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
