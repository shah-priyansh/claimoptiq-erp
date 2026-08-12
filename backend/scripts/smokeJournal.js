// Run: node backend/scripts/smokeJournal.js
// Creates a balanced journal directly via Prisma, reads it back, deletes it.
require('dotenv').config();
const prisma = require('../config/prisma');
const { getJournalNetByAccount } = require('../services/journalBalances');

(async () => {
  const bank = await prisma.bankAccount.findFirst({ where: { isActive: true } });
  if (!bank) { console.error('No active bank account to test with'); process.exit(1); }
  const entry = await prisma.journalEntry.create({
    data: {
      refNumber: `JE-SMOKE-${Date.now()}`,
      date: new Date(),
      description: 'smoke test',
      lines: {
        create: [
          { accountKind: 'cash', accountId: null, accountName: 'Cash in Hand', debit: 1000, credit: 0 },
          { accountKind: 'bank', accountId: bank.id, accountName: bank.bankName, debit: 0, credit: 1000 },
        ],
      },
    },
    include: { lines: true },
  });
  const net = await getJournalNetByAccount(prisma);
  const cashNet = net.get('cash:') || 0;
  const bankNet = net.get(`bank:${bank.id}`) || 0;
  console.log('created', entry.refNumber, 'lines:', entry.lines.length, 'cashNet:', cashNet, 'bankNet:', bankNet);
  await prisma.journalEntry.delete({ where: { id: entry.id } });
  const gone = await prisma.journalLine.count({ where: { entryId: entry.id } });
  const ok = entry.lines.length === 2 && cashNet >= 1000 && bankNet <= -1000 && gone === 0;
  console.log(ok ? '✔ smoke passed (cascade delete removed lines)' : '✗ smoke FAILED');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
