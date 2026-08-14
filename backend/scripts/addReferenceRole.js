// Idempotently insert the "Reference" system role into the live DB WITHOUT
// touching users or other roles (the full seed is destructive). Safe to re-run.
const prisma = require('../config/prisma');

const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions', 'staff',
  'references', 'parties', 'invoices', 'tds_rates',
  'expenses', 'expense_categories',
  'cash_bank', 'account_entries', 'chart_of_accounts', 'backup',
];
const view = { view: true };
const config = {
  dashboard: view, claims: view, hospitals: view, insurance: view,
  tpa: view, claim_statuses: view, claim_document_types: view,
};
const permissions = allModules.map((mod) => ({
  module: mod,
  view: config[mod]?.view ?? false,
  create: config[mod]?.create ?? false,
  edit: config[mod]?.edit ?? false,
  delete: config[mod]?.delete ?? false,
  export: config[mod]?.export ?? false,
}));

(async () => {
  try {
    const existing = await prisma.role.findUnique({ where: { slug: 'reference' } });
    if (existing) {
      console.log('Reference role already exists (id', existing.id + ') — leaving as-is.');
      return;
    }
    const role = await prisma.role.create({
      data: {
        name: 'Reference',
        slug: 'reference',
        description: 'Reference partner — view claims for their own reference hospitals only.',
        isSystem: true,
        modulePermissions: { create: permissions },
      },
      include: { modulePermissions: true },
    });
    console.log('✅ Created Reference role id', role.id, 'with', role.modulePermissions.length, 'module rows.');
    console.log('   granted view on:', role.modulePermissions.filter((m) => m.view).map((m) => m.module).join(', '));
  } catch (e) {
    console.error('ERR', e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();
