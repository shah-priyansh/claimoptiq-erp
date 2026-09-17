require('dotenv').config();
const prisma = require('../config/prisma');

async function linkCashBankEntries(limit = 30) {
  try {
    console.log('🔍 Fetching unlinked cash/bank entries...');

    // Get unlinked entries (last 30 by date descending, which are the most recent)
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

    console.log(`\n📊 Found ${unlinkedEntries.length} unlinked entries`);

    const results = {
      processed: 0,
      linked: 0,
      failed: 0,
      details: [],
    };

    // Process each entry
    for (const entry of unlinkedEntries) {
      results.processed++;
      console.log(`\n[${results.processed}/${unlinkedEntries.length}] Processing entry ${entry.id}`);
      console.log(`   Date: ${entry.date.toISOString().split('T')[0]}, Amount: ₹${entry.amount}`);

      try {
        // Try to match with invoice first
        let matched = false;

        // For "in" direction, match with invoices (money received from hospitals)
        if (entry.direction === 'in') {
          const matchingInvoice = await prisma.invoice.findFirst({
            where: {
              grandTotal: entry.amount,
              issuedAt: {
                gte: new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate()),
                lt: new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate() + 1),
              },
            },
          });

          if (matchingInvoice) {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { invoiceId: matchingInvoice.id },
            });
            results.linked++;
            matched = true;
            results.details.push({
              entryId: entry.id,
              type: 'invoice',
              linkedId: matchingInvoice.id,
              amount: entry.amount,
              date: entry.date,
              linkedNumber: matchingInvoice.invoiceNumber,
            });
            console.log(`   ✅ Linked to Invoice: ${matchingInvoice.invoiceNumber}`);
          }
        }

        // If not matched with invoice, try expense
        if (!matched) {
          const matchingExpense = await prisma.expense.findFirst({
            where: {
              amount: entry.amount,
              date: {
                gte: new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate()),
                lt: new Date(entry.date.getFullYear(), entry.date.getMonth(), entry.date.getDate() + 1),
              },
            },
          });

          if (matchingExpense) {
            await prisma.cashBankEntry.update({
              where: { id: entry.id },
              data: { expenseId: matchingExpense.id },
            });
            results.linked++;
            matched = true;
            results.details.push({
              entryId: entry.id,
              type: 'expense',
              linkedId: matchingExpense.id,
              amount: entry.amount,
              date: entry.date,
              notes: matchingExpense.notes,
            });
            console.log(`   ✅ Linked to Expense: ${matchingExpense.notes}`);
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
        console.error(`   ❌ Error processing entry: ${error.message}`);
      }
    }

    // Print summary
    console.log('\n\n════════════════════════════════════════════════════════════');
    console.log('📈 LINKING SUMMARY');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`Total Processed: ${results.processed}`);
    console.log(`Successfully Linked: ${results.linked} (${((results.linked / results.processed) * 100).toFixed(1)}%)`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Not Found: ${results.details.filter(d => d.type === 'not_found').length}`);
    console.log('════════════════════════════════════════════════════════════\n');

    // Show linked entries
    if (results.details.filter(d => d.type === 'invoice' || d.type === 'expense').length > 0) {
      console.log('📋 LINKED ENTRIES:');
      results.details
        .filter(d => d.type === 'invoice' || d.type === 'expense')
        .forEach((detail, idx) => {
          console.log(`${idx + 1}. Entry ${detail.entryId.substring(0, 8)}... → ${detail.type === 'invoice' ? 'Invoice' : 'Expense'}`);
          console.log(`   Amount: ₹${detail.amount}, Date: ${new Date(detail.date).toISOString().split('T')[0]}`);
          if (detail.linkedNumber) console.log(`   Reference: ${detail.linkedNumber}`);
          if (detail.notes) console.log(`   Notes: ${detail.notes}`);
        });
      console.log('\n');
    }

    // Show entries that couldn't be matched
    const notFound = results.details.filter(d => d.type === 'not_found');
    if (notFound.length > 0) {
      console.log('⚠️  UNMATCHED ENTRIES (no matching invoice/expense):');
      notFound.forEach((detail, idx) => {
        console.log(`${idx + 1}. Entry ${detail.entryId.substring(0, 8)}...`);
        console.log(`   Amount: ₹${detail.amount}, Date: ${new Date(detail.date).toISOString().split('T')[0]}`);
      });
      console.log('\n');
    }

    // Instructions for next steps
    if (results.linked > 0) {
      console.log('✨ Next Steps:');
      console.log('1. Review the linked entries above');
      console.log('2. If satisfied, run this script again to link remaining entries');
      console.log('3. Or modify the script to adjust matching logic if needed\n');
    }

    return results;
  } catch (error) {
    console.error('❌ Fatal error:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
const limit = process.argv[2] ? parseInt(process.argv[2]) : 30;
linkCashBankEntries(limit)
  .then(results => {
    console.log('✅ Script completed!');
    process.exit(0);
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
