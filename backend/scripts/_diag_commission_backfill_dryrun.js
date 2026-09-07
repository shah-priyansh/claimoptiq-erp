// READ-ONLY dry-run: map imported flat lines -> service master, then simulate
// the reference-commission engine and total the money per reference. No writes.
const prisma = require('../config/prisma');
const { computeCommissionRows } = require('../utils/referenceCommissionFlow');

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

// description(normalized) -> service master NAME. Prefix rules handled below.
const EXACT = {
  'tpa desk services - cashless file': 'TPA DESK SERVICE - CASHLESS',
  'tpa desk services - reimbursement file': 'TPA DESK SERVICE - REIMBURSEMENT',
  'tpa desk services - grievance claim': 'TPA DESK SERVICE - GRIEVANCE',
  'nabh consultancy fees': 'NABH CONSULTANCY',
  'gic application fees': 'GIC APPLICATION CHARGES',
  'gic application charges': 'GIC APPLICATION CHARGES',
  'hospital documents procesing fees': 'HOSPITAL DOCUMENTS PROCESS CHARGES',
  'hospital documents processing fees': 'HOSPITAL DOCUMENTS PROCESS CHARGES',
};
// prefix(normalized) -> service NAME (covers "hospital empanelment service - <insurer>")
const PREFIX = [['hospital empanelment service', 'EMPANELMENT TIE-UP']];

const resolveServiceName = (desc) => {
  const n = norm(desc);
  if (EXACT[n]) return EXACT[n];
  for (const [p, name] of PREFIX) if (n.startsWith(p)) return name;
  return null;
};

(async () => {
  try {
    const svcNames = await prisma.billingServiceName.findMany({ select: { id: true, name: true } });
    const svcIdByName = new Map(svcNames.map((s) => [s.name.trim().toLowerCase(), s.id]));

    // commission types actually configured
    const applic = await prisma.referenceApplicableService.groupBy({ by: ['commissionType'], _count: true });
    console.log('Commission types in use:', applic.map((a) => `${a.commissionType}:${a._count}`).join(', '));

    // All imported flat lines on referenced hospitals, grouped by invoice.
    const lines = await prisma.invoiceLineItem.findMany({
      where: { lineType: 'manual', billingServiceNameId: null, invoice: { hospital: { referenceId: { not: null } } } },
      select: {
        id: true, description: true, amount: true, invoiceId: true,
        invoice: { select: { id: true, invoiceNumber: true, hospital: { select: { name: true, referenceId: true, reference: { select: { name: true, isActive: true, applicableServices: { include: { billingServiceName: true } } } } } } } },
      },
    });

    // Resolve + bucket by invoice
    const byInvoice = new Map();
    let mapped = 0; const unmapped = new Map();
    for (const l of lines) {
      const svcName = resolveServiceName(l.description);
      const svcId = svcName ? svcIdByName.get(svcName.trim().toLowerCase()) : null;
      if (!svcId) { unmapped.set(l.description, (unmapped.get(l.description) || 0) + 1); continue; }
      mapped += 1;
      if (!byInvoice.has(l.invoiceId)) byInvoice.set(l.invoiceId, { inv: l.invoice, lines: [] });
      // Present as a supported service line carrying the resolved service id.
      byInvoice.get(l.invoiceId).lines.push({ id: l.id, lineType: 'service_fixed', billingServiceNameId: svcId, amount: l.amount, description: l.description });
    }

    // Simulate commission per invoice (ignores one_time dedupe across invoices —
    // this is an upper-ish estimate for one_time; percentage/fixed are exact).
    const perRef = new Map();
    let grand = 0, rowCount = 0;
    for (const { inv, lines: ls } of byInvoice.values()) {
      const ref = inv.hospital.reference;
      const { rows } = computeCommissionRows({ id: inv.id, lineItems: ls }, ref);
      for (const r of rows) { grand += r.amount; rowCount += 1; perRef.set(ref.name, (perRef.get(ref.name) || 0) + r.amount); }
    }

    console.log(`\nImported lines: ${lines.length} | mapped to a service: ${mapped} | unmapped: ${lines.length - mapped}`);
    console.log(`Commission rows that WOULD be created: ${rowCount} | total: ${inr(grand)}`);
    console.log('\nPer reference:');
    [...perRef.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, v]) => console.log(`  ${n}: ${inr(v)}`));
    console.log('\nUnmapped descriptions (NO commission — need a mapping if commissionable):');
    [...unmapped.entries()].sort((a, b) => b[1] - a[1]).forEach(([d, c]) => console.log(`  ${c}×  "${d}"`));
  } catch (e) {
    console.error('ERR:', e);
  } finally {
    await prisma.$disconnect();
  }
})();
