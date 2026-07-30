require('dotenv').config();
const prisma = require('./config/prisma');
(async () => {
  const c = await prisma.claim.findUnique({
    where: { id: '870e850d-53af-4293-ab15-99df062ca391' },
    select: { srNo: true, patientName: true, hospital: { select: { name: true, referenceBy: true } } },
  });
  console.log(JSON.stringify(c, null, 2));
  await prisma.$disconnect();
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
