require('dotenv').config();
const prisma = require('../config/prisma');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');

async function exportCashBankExcel() {
  try {
    console.log('📊 Fetching cash/bank entries...\n');

    // Get all linked entries
    const linkedEntries = await prisma.cashBankEntry.findMany({
      where: {
        OR: [
          { invoiceId: { not: null } },
          { expenseId: { not: null } },
        ],
      },
      include: {
        invoice: { select: { id: true, invoiceNumber: true, grandTotal: true, month: true } },
        expense: { select: { id: true, notes: true, amount: true, date: true } },
      },
      orderBy: { date: 'desc' },
    });

    // Get all unlinked entries
    const unlinkedEntries = await prisma.cashBankEntry.findMany({
      where: {
        AND: [{ invoiceId: null }, { expenseId: null }],
      },
      orderBy: { date: 'desc' },
    });

    console.log(`✅ Linked entries: ${linkedEntries.length}`);
    console.log(`⚠️  Unlinked entries: ${unlinkedEntries.length}`);

    // Create workbook
    const workbook = new ExcelJS.Workbook();

    // ═══════════════════════════════════════════════════════════════
    // SHEET 1: LINKED ENTRIES
    // ═══════════════════════════════════════════════════════════════
    const linkedSheet = workbook.addWorksheet('Linked Entries');

    linkedSheet.columns = [
      { header: 'Entry ID', key: 'entryId', width: 36 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Direction', key: 'direction', width: 10 },
      { header: 'Mode', key: 'mode', width: 10 },
      { header: 'Amount (₹)', key: 'amount', width: 15 },
      { header: 'Linked To Type', key: 'linkedType', width: 12 },
      { header: 'Linked To ID', key: 'linkedId', width: 36 },
      { header: 'Reference Number', key: 'refNumber', width: 20 },
      { header: 'Reference Amount', key: 'refAmount', width: 15 },
      { header: 'Notes', key: 'notes', width: 40 },
      { header: 'Remarks', key: 'remarks', width: 30 },
    ];

    // Add data to linked sheet
    linkedEntries.forEach(entry => {
      const linkedType = entry.invoice ? 'Invoice' : 'Expense';
      const linkedId = entry.invoice?.id || entry.expense?.id;
      const refNumber = entry.invoice?.invoiceNumber || entry.expense?.notes || '';
      const refAmount = entry.invoice?.grandTotal || entry.expense?.amount || 0;
      const notes = entry.notes || '';

      linkedSheet.addRow({
        entryId: entry.id,
        date: entry.date.toISOString().split('T')[0],
        direction: entry.direction,
        mode: entry.mode,
        amount: entry.amount,
        linkedType,
        linkedId,
        refNumber,
        refAmount,
        notes,
        remarks: '',
      });
    });

    // Format linked sheet
    formatSheet(linkedSheet);

    // ═══════════════════════════════════════════════════════════════
    // SHEET 2: UNLINKED ENTRIES
    // ═══════════════════════════════════════════════════════════════
    const unlinkedSheet = workbook.addWorksheet('Unlinked Entries');

    unlinkedSheet.columns = [
      { header: 'Entry ID', key: 'entryId', width: 36 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Direction', key: 'direction', width: 10 },
      { header: 'Mode', key: 'mode', width: 10 },
      { header: 'Amount (₹)', key: 'amount', width: 15 },
      { header: 'Notes', key: 'notes', width: 40 },
      { header: 'Possible Reference', key: 'possibleRef', width: 40 },
      { header: 'Status', key: 'status', width: 15 },
      { header: 'Remarks', key: 'remarks', width: 40 },
    ];

    // Add data to unlinked sheet
    unlinkedEntries.forEach(entry => {
      unlinkedSheet.addRow({
        entryId: entry.id,
        date: entry.date.toISOString().split('T')[0],
        direction: entry.direction,
        mode: entry.mode,
        amount: entry.amount,
        notes: entry.notes || '',
        possibleRef: '', // User can fill this
        status: 'Not Found',
        remarks: '', // User can add remarks
      });
    });

    // Format unlinked sheet
    formatSheet(unlinkedSheet);

    // ═══════════════════════════════════════════════════════════════
    // SHEET 3: SUMMARY
    // ═══════════════════════════════════════════════════════════════
    const summarySheet = workbook.addWorksheet('Summary');

    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Count', key: 'count', width: 20 },
      { header: 'Percentage', key: 'percentage', width: 20 },
    ];

    const totalEntries = linkedEntries.length + unlinkedEntries.length;
    const linkedPercent = ((linkedEntries.length / totalEntries) * 100).toFixed(1);
    const unlinkedPercent = ((unlinkedEntries.length / totalEntries) * 100).toFixed(1);

    summarySheet.addRows([
      { metric: 'Total Cash/Bank Entries', count: totalEntries, percentage: '100%' },
      { metric: 'Linked Entries', count: linkedEntries.length, percentage: `${linkedPercent}%` },
      { metric: 'Unlinked Entries', count: unlinkedEntries.length, percentage: `${unlinkedPercent}%` },
      { metric: '', count: '', percentage: '' },
      { metric: 'Linked by Type:', count: '', percentage: '' },
    ]);

    // Count by type
    const invoiceCount = linkedEntries.filter(e => e.invoiceId).length;
    const expenseCount = linkedEntries.filter(e => e.expenseId).length;

    summarySheet.addRows([
      { metric: '  - Invoice', count: invoiceCount, percentage: `${((invoiceCount / linkedEntries.length) * 100).toFixed(1)}%` },
      { metric: '  - Expense', count: expenseCount, percentage: `${((expenseCount / linkedEntries.length) * 100).toFixed(1)}%` },
    ]);

    // Format summary sheet
    formatSheet(summarySheet);

    // Save workbook
    const exportsDir = './exports';
    if (!fs.existsSync(exportsDir)) {
      fs.mkdirSync(exportsDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    const fileName = `cash-bank-entries_${timestamp}.xlsx`;
    const filePath = path.join(exportsDir, fileName);

    await workbook.xlsx.writeFile(filePath);

    console.log('\n════════════════════════════════════════════════════════════');
    console.log('✅ EXCEL EXPORT COMPLETED');
    console.log('════════════════════════════════════════════════════════════');
    console.log(`📁 File: ${filePath}`);
    console.log(`📊 Total Entries: ${totalEntries}`);
    console.log(`✅ Linked: ${linkedEntries.length} (${linkedPercent}%)`);
    console.log(`⚠️  Unlinked: ${unlinkedEntries.length} (${unlinkedPercent}%)`);
    console.log('════════════════════════════════════════════════════════════\n');

    console.log('📋 Sheets:');
    console.log('  1. Linked Entries - Shows what was linked to invoices/expenses');
    console.log('  2. Unlinked Entries - Shows entries that need manual review');
    console.log('  3. Summary - Overview statistics\n');

    console.log('✨ You can now:');
    console.log('  - Review linked entries in the "Linked Entries" sheet');
    console.log('  - Add remarks for unlinked entries in the "Remarks" column');
    console.log('  - Use "Possible Reference" to note which invoice/expense to link\n');

    return { filePath, linkedCount: linkedEntries.length, unlinkedCount: unlinkedEntries.length };
  } catch (error) {
    console.error('❌ Export failed:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

function formatSheet(sheet) {
  // Header formatting
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF366092' } };
  sheet.getRow(1).alignment = { horizontal: 'center', vertical: 'center' };

  // Data formatting
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) {
      row.eachCell(cell => {
        cell.alignment = { horizontal: 'left', vertical: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
          right: { style: 'thin', color: { argb: 'FFD3D3D3' } },
        };
      });
    }
  });

  // Freeze header row
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

// Run export
exportCashBankExcel()
  .then(result => {
    console.log('✅ Script completed successfully!');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ Script failed:', error.message);
    process.exit(1);
  });
