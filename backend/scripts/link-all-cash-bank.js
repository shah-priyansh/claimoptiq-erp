require('dotenv').config();
const prisma = require('../config/prisma');

async function linkAllCashBankEntries(limit = null) {
  try {
    console.log('🔍 Fetching unlinked cash/bank entries...\n');

    // Get unlinked entries (all if limit is null, or first N if limit is set)
    const where = {
      AND: [{ invoiceId: null }, { expenseId: null }],
    };

    const findOptions = {
      where,
      orderBy: { date: 'desc' },
    };

    if (limit) findOptions.take = limit;

    const unlinkedEntries = await prisma.cashBankEntry.findMany(findOptions);

    console.log(
      `📊 Found ${unlinkedEntries.length} unlinked entries${limit ? ` (showing first ${limit})` : ''}\n`
    );

    const results = {
      processed: 0,
      linked: 0,
      failed: 0,
      details: [],
    };

    // Process each entry
    for (const entry of unlinkedEntries) {
      results.processed++;
      const progressStr = limit ? `[${results.processed}/${unlinkedEntries.length}]` : `[${results.processed}]`;
      process.stdout.write(
        `\r${progressStr} Processed: ${results.linked} linked | Entry Amount: ₹${entry.amount.toString().padStart(8)}`
      );

      try {
        let matched = false;

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 1: Exact Match
        // ═══════════════════════════════════════════════════════════════
        let matchedRecord = await findExactMatch(entry);
        if (matchedRecord) {
          await linkEntry(entry, matchedRecord);
          results.linked++;
          results.details.push({
            entryId: entry.id,
            type: matchedRecord.type,
            linkedId: matchedRecord.id,
            amount: entry.amount,
            matchType: 'Exact',
            linkedRef: matchedRecord.ref,
          });
          matched = true;
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 2: Fuzzy Match (amount tolerance + date tolerance)
        // ═══════════════════════════════════════════════════════════════
        if (!matched) {
          // For larger entries, use wider date range
          const dateRangeDays = entry.amount > 10000 ? 7 : 3;
          const tolerancePercent = entry.amount > 10000 ? 10 : 5;

          matchedRecord = await findFuzzyMatch(entry, tolerancePercent, dateRangeDays);
          if (matchedRecord) {
            await linkEntry(entry, matchedRecord);
            results.linked++;
            results.details.push({
              entryId: entry.id,
              type: matchedRecord.type,
              linkedId: matchedRecord.id,
              amount: entry.amount,
              matchType: `Fuzzy (±${tolerancePercent}%, ±${dateRangeDays}d)`,
              linkedRef: matchedRecord.ref,
            });
            matched = true;
          }
        }

        // ═══════════════════════════════════════════════════════════════
        // STRATEGY 3: Amount with GST/TDS Variation
        // ═══════════════════════════════════════════════════════════════
        if (!matched && entry.direction === 'in') {
          matchedRecord = await findInvoiceWithTaxVariation(entry);
          if (matchedRecord) {
            await linkEntry(entry, matchedRecord);
            results.linked++;
            results.details.push({
              entryId: entry.id,
              type: matchedRecord.type,
              linkedId: matchedRecord.id,
              amount: entry.amount,
              matchType: `Fuzzy (GST/TDS variation)`,
              linkedRef: matchedRecord.ref,
            });
            matched = true;
          }
        }
      } catch (error) {
        results.failed++;
      }
    }

    console.log('\n\n════════════════════════════════════════════════════════════');
    console.log('📈 FINAL SUMMARY');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`Total Processed: ${results.processed}`);
    console.log(`Successfully Linked: ${results.linked} (${((results.linked / results.processed) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Not Found: ${results.processed - results.linked - results.failed}`);
    console.log('════════════════════════════════════════════════════════════\n');

    // Show statistics by type
    const byType = {};
    results.details.forEach(d => {
      byType[d.type] = (byType[d.type] || 0) + 1;
    });
    console.log('📊 Linked by Type:');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`   ${type}: ${count}`);
    });

    console.log('\n✅ Linking complete!');
    return results;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// ═══════════════════════════════════════════════════════════════════════════

async function findExactMatch(entry) {
  const startOfDay = new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate());
  const endOfDay = new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate() + 1);

  // Exact expense match
  const expense = await prisma.expense.findFirst({
    where: {
      amount: entry.amount,
      date: { gte: startOfDay, lt: endOfDay },
    },
  });

  if (expense) {
    return { type: 'expense', id: expense.id, ref: expense.notes };
  }

  // Exact invoice match for "in" direction
  if (entry.direction === 'in') {
    const invoice = await prisma.invoice.findFirst({
      where: {
        grandTotal: entry.amount,
        issuedAt: { gte: startOfDay, lt: endOfDay },
      },
    });
    if (invoice) {
      return { type: 'invoice', id: invoice.id, ref: invoice.invoiceNumber };
    }
  }

  return null;
}

async function findFuzzyMatch(entry, tolerancePercent, dateRangeDays) {
  const startDate = new Date(entry.date);
  startDate.setDate(startDate.getDate() - dateRangeDays);
  const endDate = new Date(entry.date);
  endDate.setDate(endDate.getDate() + dateRangeDays);

  const minAmount = entry.amount * (1 - tolerancePercent / 100);
  const maxAmount = entry.amount * (1 + tolerancePercent / 100);

  // Expense fuzzy match
  const expense = await prisma.expense.findFirst({
    where: {
      date: { gte: startDate, lte: endDate },
      amount: { gte: minAmount, lte: maxAmount },
    },
    orderBy: { amount: 'asc' },
  });

  if (expense) {
    return { type: 'expense', id: expense.id, ref: expense.notes };
  }

  // Invoice fuzzy match for "in" direction
  if (entry.direction === 'in') {
    const invoice = await prisma.invoice.findFirst({
      where: {
        issuedAt: { gte: startDate, lte: endDate },
        grandTotal: { gte: minAmount, lte: maxAmount },
      },
      orderBy: { grandTotal: 'asc' },
    });

    if (invoice) {
      return { type: 'invoice', id: invoice.id, ref: invoice.invoiceNumber };
    }
  }

  return null;
}

async function findInvoiceWithTaxVariation(entry) {
  // For larger "in" entries, match with invoices considering GST/TDS
  // Entry amount = Invoice netTotal + GST - TDS (approximately)
  const dateRangeDays = 7;
  const startDate = new Date(entry.date);
  startDate.setDate(startDate.getDate() - dateRangeDays);
  const endDate = new Date(entry.date);
  endDate.setDate(endDate.getDate() + dateRangeDays);

  // Look for invoices where netTotal is close to entry amount (within 15% to account for tax)
  const invoices = await prisma.invoice.findMany({
    where: {
      issuedAt: { gte: startDate, lte: endDate },
      netTotal: {
        gte: entry.amount * 0.85,
        lte: entry.amount * 1.15,
      },
    },
    orderBy: { netTotal: 'asc' },
    take: 1,
  });

  if (invoices.length > 0) {
    return { type: 'invoice', id: invoices[0].id, ref: invoices[0].invoiceNumber };
  }

  return null;
}

async function linkEntry(entry, matchedRecord) {
  if (matchedRecord.type === 'invoice') {
    return await prisma.cashBankEntry.update({
      where: { id: entry.id },
      data: { invoiceId: matchedRecord.id },
    });
  } else if (matchedRecord.type === 'expense') {
    return await prisma.cashBankEntry.update({
      where: { id: entry.id },
      data: { expenseId: matchedRecord.id },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════

// Parse command line arguments
const args = process.argv.slice(2);
const limit = args[0] ? parseInt(args[0]) : null;

linkAllCashBankEntries(limit)
  .then(results => {
    console.log('\n✅ Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
