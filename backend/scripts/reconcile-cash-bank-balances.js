require('dotenv').config();
const prisma = require('../config/prisma');

async function reconcileCashBankBalances() {
  try {
    console.log('🔍 Starting Cash/Bank Balance Reconciliation...\n');

    // ═══════════════════════════════════════════════════════════════
    // CALCULATE EXPECTED BALANCES
    // ═══════════════════════════════════════════════════════════════
    console.log('📊 Calculating expected balances...');

    // Get all cash/bank entries grouped by mode and direction
    const cashBankGrouped = await prisma.cashBankEntry.groupBy({
      by: ['mode', 'direction'],
      _sum: { amount: true },
    });

    // Calculate balance per mode
    const expectedBalances = { cash: 0, bank: 0, upi: 0 };
    const entryCounts = { cash: 0, bank: 0, upi: 0 };
    const directionCounts = { in: 0, out: 0 };

    for (const row of cashBankGrouped) {
      const sign = row.direction === 'in' ? 1 : -1;
      expectedBalances[row.mode] = (expectedBalances[row.mode] || 0) + sign * (row._sum.amount || 0);
      entryCounts[row.mode] += row._sum.amount || 0;
      directionCounts[row.direction] += row._sum.amount || 0;
    }

    // Get AccountEntry contra adjustments
    const contraTo = await prisma.accountEntry.groupBy({
      where: { entryType: 'contra' },
      by: ['toMode'],
      _sum: { amount: true },
    });

    const contraFrom = await prisma.accountEntry.groupBy({
      where: { entryType: 'contra' },
      by: ['fromMode'],
      _sum: { amount: true },
    });

    for (const row of contraTo) {
      if (row.toMode && expectedBalances[row.toMode] !== undefined) {
        expectedBalances[row.toMode] += row._sum.amount || 0;
      }
    }

    for (const row of contraFrom) {
      if (row.fromMode && expectedBalances[row.fromMode] !== undefined) {
        expectedBalances[row.fromMode] -= row._sum.amount || 0;
      }
    }

    // Add journal entry impact for actual cash/bank accounts only
    const jlines = await prisma.journalLine.groupBy({
      by: ['accountName'],
      _sum: { debit: true, credit: true }
    });

    jlines.forEach(line => {
      const net = (line._sum.debit || 0) - (line._sum.credit || 0);
      const name = (line.accountName || '').toLowerCase();

      // Only count actual cash/bank accounts, not FDs or other assets
      if (name === 'cash in hand' || (name.includes('cash') && !name.includes('box'))) {
        expectedBalances.cash += net;
      }
      if ((name.includes('bank') || name.includes('hdfc') || name.includes('cooperative'))
          && !name.includes('fd') && !name.includes('fixed')) {
        expectedBalances.bank += net;
      }
      if (name.includes('upi')) {
        expectedBalances.upi += net;
      }
    });

    expectedBalances.total = expectedBalances.cash + expectedBalances.bank + expectedBalances.upi;

    // ═══════════════════════════════════════════════════════════════
    // LINKED vs UNLINKED ANALYSIS
    // ═══════════════════════════════════════════════════════════════
    console.log('🔗 Analyzing linked vs unlinked entries...\n');

    const linkedEntries = await prisma.cashBankEntry.findMany({
      where: {
        OR: [{ invoiceId: { not: null } }, { expenseId: { not: null } }],
      },
    });

    const unlinkedEntries = await prisma.cashBankEntry.findMany({
      where: {
        AND: [{ invoiceId: null }, { expenseId: null }],
      },
    });

    // Calculate balances by link status
    let linkedBalance = 0;
    let unlinkedBalance = 0;

    for (const entry of linkedEntries) {
      const sign = entry.direction === 'in' ? 1 : -1;
      linkedBalance += sign * entry.amount;
    }

    for (const entry of unlinkedEntries) {
      const sign = entry.direction === 'in' ? 1 : -1;
      unlinkedBalance += sign * entry.amount;
    }

    // ═══════════════════════════════════════════════════════════════
    // PRINT RECONCILIATION REPORT
    // ═══════════════════════════════════════════════════════════════
    console.log('════════════════════════════════════════════════════════════');
    console.log('📋 CASH/BANK BALANCE RECONCILIATION REPORT');
    console.log('════════════════════════════════════════════════════════════\n');

    console.log('📊 EXPECTED BALANCES (Based on entries):');
    console.log(`   Cash:  ₹${round2(expectedBalances.cash).toLocaleString('en-IN')}`);
    console.log(`   Bank:  ₹${round2(expectedBalances.bank).toLocaleString('en-IN')}`);
    console.log(`   UPI:   ₹${round2(expectedBalances.upi).toLocaleString('en-IN')}`);
    console.log(`   TOTAL: ₹${round2(expectedBalances.total).toLocaleString('en-IN')}`);
    console.log();

    console.log('🔗 ENTRY LINKING STATUS:');
    console.log(`   Total Entries:   ${linkedEntries.length + unlinkedEntries.length}`);
    console.log(`   Linked:          ${linkedEntries.length} (${((linkedEntries.length / (linkedEntries.length + unlinkedEntries.length)) * 100).toFixed(1)}%)`);
    console.log(`   Unlinked:        ${unlinkedEntries.length} (${((unlinkedEntries.length / (linkedEntries.length + unlinkedEntries.length)) * 100).toFixed(1)}%)`);
    console.log();

    console.log('💰 BALANCE BREAKDOWN:');
    console.log(`   Linked Entry Balance:   ₹${round2(linkedBalance).toLocaleString('en-IN')}`);
    console.log(`   Unlinked Entry Balance: ₹${round2(unlinkedBalance).toLocaleString('en-IN')}`);
    console.log(`   Total Balance:          ₹${round2(linkedBalance + unlinkedBalance).toLocaleString('en-IN')}`);
    console.log();

    console.log('📈 DIRECTION ANALYSIS:');
    console.log(`   Money IN:  ₹${round2(directionCounts.in).toLocaleString('en-IN')}`);
    console.log(`   Money OUT: ₹${round2(directionCounts.out).toLocaleString('en-IN')}`);
    console.log(`   Net:       ₹${round2(directionCounts.in - directionCounts.out).toLocaleString('en-IN')}`);
    console.log();

    // ═══════════════════════════════════════════════════════════════
    // IDENTIFY ISSUES
    // ═══════════════════════════════════════════════════════════════
    console.log('⚠️  ISSUES & RECOMMENDATIONS:');

    if (unlinkedEntries.length > 0) {
      const unlinkedPercent = ((unlinkedEntries.length / (linkedEntries.length + unlinkedEntries.length)) * 100).toFixed(1);
      console.log(
        `\n   1️⃣  ${unlinkedEntries.length} entries (${unlinkedPercent}%) are not linked`
      );
      console.log(`       Affecting balance: ₹${round2(unlinkedBalance).toLocaleString('en-IN')}`);
      console.log(`       ➜ Review and link these entries in the "Unlinked Entries" Excel sheet`);
    }

    const largeUnlinked = unlinkedEntries.filter(e => e.amount > 10000).sort((a, b) => b.amount - a.amount);
    if (largeUnlinked.length > 0) {
      console.log(`\n   2️⃣  Large unlinked entries (₹10k+): ${largeUnlinked.length}`);
      largeUnlinked.slice(0, 5).forEach(e => {
        const dir = e.direction === 'in' ? '📥 IN' : '📤 OUT';
        console.log(`       ${dir} | ₹${e.amount.toLocaleString('en-IN')} | ${e.date.toISOString().split('T')[0]}`);
      });
      if (largeUnlinked.length > 5) {
        console.log(`       ... and ${largeUnlinked.length - 5} more`);
      }
    }

    console.log('\n════════════════════════════════════════════════════════════\n');

    console.log('✨ NEXT STEPS:');
    console.log('   1. Download: backend/exports/cash-bank-entries_*.xlsx');
    console.log('   2. Open "Unlinked Entries" sheet');
    console.log('   3. Fill in "Remarks" & "Possible Reference" columns');
    console.log('   4. Re-import or manually link remaining entries');
    console.log('   5. Run this script again to verify all entries are linked\n');

    return {
      expectedBalances,
      linkedCount: linkedEntries.length,
      unlinkedCount: unlinkedEntries.length,
      linkedBalance: round2(linkedBalance),
      unlinkedBalance: round2(unlinkedBalance),
    };
  } catch (error) {
    console.error('❌ Reconciliation failed:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

// Run reconciliation
reconcileCashBankBalances()
  .then(result => {
    console.log('✅ Reconciliation complete!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
