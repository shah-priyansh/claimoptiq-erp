require('dotenv').config();
const bcrypt = require('bcryptjs');
const prisma = require('./config/prisma');

const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions',
];

const buildPermissions = (config) =>
  allModules.map((mod) => ({
    module: mod,
    view:   config[mod]?.view   ?? false,
    create: config[mod]?.create ?? false,
    edit:   config[mod]?.edit   ?? false,
    delete: config[mod]?.delete ?? false,
    export: config[mod]?.export ?? false,
  }));

const defaultRoles = [
  {
    name: 'Super Admin', slug: 'super_admin',
    description: 'Full system access. Cannot be deleted.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true, edit: true, delete: true, export: true },
      hospitals:            { view: true, create: true, edit: true, delete: true },
      insurance:            { view: true, create: true, edit: true, delete: true },
      tpa:                  { view: true, create: true, edit: true, delete: true },
      users:                { view: true, create: true, edit: true, delete: true },
      roles:                { view: true, create: true, edit: true, delete: true },
      reports:              { view: true, export: true },
      claim_statuses:       { view: true, create: true, edit: true, delete: true },
      claim_document_types: { view: true, create: true, edit: true, delete: true },
      document_submissions: { view: true, create: true, edit: true, delete: true },
    }),
  },
  {
    name: 'Admin', slug: 'admin',
    description: 'Admin with full access except role management.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true, edit: true, delete: true, export: true },
      hospitals:            { view: true, create: true, edit: true, delete: true },
      insurance:            { view: true, create: true, edit: true, delete: true },
      tpa:                  { view: true, create: true, edit: true, delete: true },
      users:                { view: true, create: true, edit: true },
      roles:                { view: true },
      reports:              { view: true, export: true },
      claim_statuses:       { view: true, create: true, edit: true },
      claim_document_types: { view: true, create: true, edit: true },
      document_submissions: { view: true, create: true, edit: true, delete: true },
    }),
  },
  {
    name: 'Staff', slug: 'staff',
    description: 'Can manage claims and view reports.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true, edit: true },
      hospitals:            { view: true },
      insurance:            { view: true },
      tpa:                  { view: true },
      reports:              { view: true },
      claim_statuses:       { view: true },
      claim_document_types: { view: true },
      document_submissions: { view: true, create: true },
    }),
  },
  {
    name: 'Hospital', slug: 'hospital',
    description: 'Hospital user — can only see their own hospital data.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true },
      hospitals:            { view: true },
      document_submissions: { view: true, create: true },
    }),
  },
];

const insuranceCompanies = [
  'Star Health', 'HDFC ERGO', 'ICICI Lombard', 'Bajaj Allianz',
  'New India Assurance', 'United India', 'Oriental Insurance',
  'National Insurance', 'Reliance General', 'Tata AIG',
];

const tpas = [
  'Medi Assist', 'Raksha Health', 'Paramount Health',
  'Family Health Plan', 'Vidal Health', 'Heritage Health',
];

const claimStatuses = [
  { slug: 'admitted',      label: 'Admitted',      color: 'blue',   order: 1, isSystem: true },
  { slug: 'discharged',    label: 'Discharged',    color: 'orange', order: 2, isSystem: true },
  { slug: 'file_received', label: 'File Received', color: 'purple', order: 3, isSystem: true },
  { slug: 'submitted',     label: 'Submitted',     color: 'indigo', order: 4, isSystem: true },
  { slug: 'settled',       label: 'Settled',       color: 'green',  order: 5, isSystem: true },
  { slug: 'rejected',      label: 'Rejected',      color: 'red',    order: 6, isSystem: true },
];

const claimDocumentTypes = [
  { name: 'Discharge Summary',  isRequired: true,  order: 1, isSystem: true },
  { name: 'Hospital Bills',     isRequired: true,  order: 2, isSystem: true },
  { name: 'Lab Reports',        isRequired: false, order: 3, isSystem: true },
  { name: 'Prescription',       isRequired: false, order: 4, isSystem: true },
  { name: 'ID Proof',           isRequired: true,  order: 5, isSystem: true },
  { name: 'Insurance Card',     isRequired: true,  order: 6, isSystem: true },
  { name: 'Pre-Auth Letter',    isRequired: false, order: 7, isSystem: true },
  { name: 'Settlement Letter',  isRequired: false, order: 8, isSystem: true },
];

async function main() {
  console.log('Seeding PostgreSQL database...');

  console.log('Seeding roles...');
  await prisma.roleModulePermission.deleteMany();
  await prisma.role.deleteMany();
  for (const r of defaultRoles) {
    await prisma.role.create({
      data: {
        name: r.name, slug: r.slug, description: r.description, isSystem: r.isSystem,
        modulePermissions: { create: r.permissions },
      },
    });
  }
  console.log('  ✓ 4 roles');

  await prisma.insuranceCompany.deleteMany();
  await prisma.insuranceCompany.createMany({
    data: insuranceCompanies.map((name) => ({ name })),
  });
  console.log(`  ✓ ${insuranceCompanies.length} insurance companies`);

  await prisma.tPA.deleteMany();
  await prisma.tPA.createMany({ data: tpas.map((name) => ({ name })) });
  console.log(`  ✓ ${tpas.length} TPAs`);

  await prisma.claimStatus.deleteMany();
  await prisma.claimStatus.createMany({ data: claimStatuses });
  console.log(`  ✓ ${claimStatuses.length} claim statuses`);

  await prisma.claimDocumentType.deleteMany();
  await prisma.claimDocumentType.createMany({ data: claimDocumentTypes });
  console.log(`  ✓ ${claimDocumentTypes.length} claim document types`);

  await prisma.user.deleteMany({ where: { email: 'admin@claimoptiq.com' } });
  const superAdminRole = await prisma.role.findUnique({ where: { slug: 'super_admin' } });
  await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@claimoptiq.com',
      password: await bcrypt.hash('Admin@123', 12),
      roleId: superAdminRole.id,
      phone: '9000000000',
    },
  });
  console.log('  ✓ Super admin user (admin@claimoptiq.com / Admin@123)');

  console.log('\n✅ Seed complete!');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
