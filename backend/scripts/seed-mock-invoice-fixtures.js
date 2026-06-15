// Seeds a test hospital + 6 settled-discharged claims in the CURRENT month
// (default) so the operator can immediately walk the invoice wizard. The
// fixture is idempotent on the seed name: re-running cleans up the previous
// run before re-inserting.
//
// Usage:
//   node backend/scripts/seed-mock-invoice-fixtures.js
//   node backend/scripts/seed-mock-invoice-fixtures.js 2026-06   # custom month
//
// Cleanup:
//   node backend/scripts/seed-mock-invoice-fixtures.js --clean

const prisma = require('../config/prisma');

const SEED_TAG = 'MOCK-INV-FIXTURE';

const parseMonthArg = (raw) => {
  if (!raw) {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const [y, m] = raw.split('-').map(Number);
  if (!y || !m) throw new Error(`Invalid month: ${raw} (expected YYYY-MM)`);
  return new Date(Date.UTC(y, m - 1, 1));
};

const cleanup = async () => {
  const hospitals = await prisma.hospital.findMany({
    where: { name: { startsWith: `${SEED_TAG} ` } },
    select: { id: true, name: true },
  });
  if (!hospitals.length) {
    console.log('Nothing to clean.');
    return;
  }
  for (const h of hospitals) {
    console.log(`Cleaning ${h.name}`);
    const invoices = await prisma.invoice.findMany({ where: { hospitalId: h.id }, select: { id: true } });
    if (invoices.length) {
      await prisma.expense.deleteMany({
        where: { sourceType: 'invoice_commission', sourceId: { in: invoices.map((i) => i.id) } },
      });
    }
    await prisma.cashBankEntry.deleteMany({ where: { hospitalId: h.id } });
    for (const i of invoices) await prisma.invoice.delete({ where: { id: i.id } });
    await prisma.claim.deleteMany({ where: { hospitalId: h.id } });
    await prisma.hospitalBillingServiceSlab.deleteMany({ where: { billingService: { hospitalId: h.id } } });
    await prisma.hospitalBillingService.deleteMany({ where: { hospitalId: h.id } });
    await prisma.hospital.delete({ where: { id: h.id } });
  }
  console.log(`Removed ${hospitals.length} mock hospital${hospitals.length === 1 ? '' : 's'}.`);
};

const seed = async (month) => {
  await cleanup();

  const monthEnd = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0, 23, 59, 59));
  const monthLabel = month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  // Make sure we have at least one BillingServiceName master row to attach
  // each hospital billing service to. Re-uses an existing one if present.
  let tpaDeskName = await prisma.billingServiceName.findFirst({ where: { name: 'TPA Desk' } });
  if (!tpaDeskName) tpaDeskName = await prisma.billingServiceName.create({ data: { name: 'TPA Desk' } });

  let nabhName = await prisma.billingServiceName.findFirst({ where: { name: 'NABH' } });
  if (!nabhName) nabhName = await prisma.billingServiceName.create({ data: { name: 'NABH' } });

  const hospital = await prisma.hospital.create({
    data: {
      name: `${SEED_TAG} ${monthLabel} Hospital`,
      contact: '9876543210',
      email: 'mock@hospital.test',
      phone: '9876543210',
      address: 'Test Address, Surat',
      city: 'Surat',
      state: 'Gujarat',
      pincode: '395003',
      gstRate: 0,
      tdsRate: 0,
      invoicePrefix: 'FCC',
      billingServices: {
        create: [
          {
            serviceName: 'TPA Desk',
            billingType: 'per_claim_slab',
            calculationBasis: 'final_approval',
            slabMode: 'slab_wise',
            slabs: {
              create: [
                { rangeStart: 0,     rangeEnd: 50000,  price: 1000, order: 0 },
                { rangeStart: 50001, rangeEnd: 100000, price: 1500, order: 1 },
                { rangeStart: 100001, rangeEnd: 0,     price: 2000, order: 2 },
              ],
            },
          },
          {
            serviceName: 'NABH',
            billingType: 'fixed_monthly',
            fixedAmount: 5000,
          },
        ],
      },
    },
  });

  // Pick existing reference data — these are guaranteed by the main seed.
  const status = await prisma.claimStatus.findFirst({ where: { slug: 'settled' } });
  const ic = await prisma.insuranceCompany.findFirst();

  // 6 claims discharged across the month so the invoice has variety.
  const claimSeeds = [
    { patient: 'RAJESH PATEL',   ccn: 'CCN-0001', day: 3,  finalApproval: 25000 },
    { patient: 'KAVITA SHARMA',  ccn: 'CCN-0002', day: 6,  finalApproval: 48000 },
    { patient: 'AMIT JOSHI',     ccn: 'CCN-0003', day: 9,  finalApproval: 62000 },
    { patient: 'PRIYA DESAI',    ccn: 'CCN-0004', day: 12, finalApproval: 78000 },
    { patient: 'SANJAY MEHTA',   ccn: 'CCN-0005', day: 17, finalApproval: 95000 },
    { patient: 'NEHA THAKKAR',   ccn: 'CCN-0006', day: 22, finalApproval: 125000 },
  ];

  const created = [];
  for (const c of claimSeeds) {
    const dayClamp = Math.min(c.day, monthEnd.getUTCDate());
    const admit = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.max(1, dayClamp - 2)));
    const discharge = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), dayClamp));
    const claim = await prisma.claim.create({
      data: {
        hospitalId: hospital.id,
        patientName: c.patient,
        claimType: 'cashless',
        ccnNo: c.ccn,
        insuranceCompanyId: ic ? ic.id : null,
        month,
        dateOfAdmit: admit,
        dateOfDischarge: discharge,
        status: status.slug,
        hospitalFinalBill: c.finalApproval + 5000,
        finalApprovalAmount: c.finalApproval,
        isBilled: false,
      },
    });
    created.push({ claim, finalApproval: c.finalApproval });
  }

  console.log(`\n✅ Mock fixture ready for ${monthLabel}`);
  console.log(`  Hospital: ${hospital.name}`);
  console.log(`  ID:       ${hospital.id}`);
  console.log(`  Services: TPA Desk (per-claim slabs 1000/1500/2000) + NABH (₹5000 monthly)`);
  console.log(`  Claims:   ${created.length} (settled, discharged this month, isBilled=false)`);
  console.log('\nNext step:');
  console.log(`  1. Open /invoices/new`);
  console.log(`  2. Pick "${hospital.name}" and month ${monthLabel}`);
  console.log(`  3. Click Preview → save as draft → issue.`);
};

(async () => {
  const arg = process.argv[2];
  try {
    if (arg === '--clean') {
      await cleanup();
    } else {
      const month = parseMonthArg(arg);
      await seed(month);
    }
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
