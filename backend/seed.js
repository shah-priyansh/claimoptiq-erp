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
    // FCC internal staff — full claims management + document inbox, no administration
    name: 'FCC Staff', slug: 'fcc_staff',
    description: 'FCC staff — full claims and document inbox access. No administration.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true, create: true, edit: true, delete: true, export: true },
      hospitals:            { view: true },
      insurance:            { view: true },
      tpa:                  { view: true },
      reports:              { view: true },
      claim_statuses:       { view: true },
      claim_document_types: { view: true },
      document_submissions: { view: true, create: true, edit: true, delete: true },
    }),
  },
  {
    // Hospital admin — views their hospital's claims (approved amount visible), manages doc inbox
    name: 'Hospital Admin', slug: 'hospital_admin',
    description: 'Hospital admin — view their hospital claims and manage document inbox.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true },
      hospitals:            { view: true },
      insurance:            { view: true },
      tpa:                  { view: true },
      claim_statuses:       { view: true },
      claim_document_types: { view: true },
      document_submissions: { view: true, create: true, edit: true, delete: true },
    }),
  },
  {
    // Hospital staff — view claims and upload documents only, no monthly revenue on dashboard
    name: 'Hospital Staff', slug: 'hospital_staff',
    description: 'Hospital staff — view claims and upload documents.',
    isSystem: true,
    permissions: buildPermissions({
      dashboard:            { view: true },
      claims:               { view: true },
      hospitals:            { view: true },
      claim_statuses:       { view: true },
      claim_document_types: { view: true },
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
  { slug: 'billed',        label: 'Billed',        color: 'teal',   order: 7, isSystem: true, superAdminOnly: true },
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
  await prisma.user.deleteMany();
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
  console.log(`  ✓ ${defaultRoles.length} roles`);

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

  // Demo hospital for hospital-role users
  await prisma.hospital.deleteMany({ where: { name: 'Demo Hospital' } });
  const demoHospital = await prisma.hospital.create({
    data: { name: 'Demo Hospital', address: 'Demo City', phone: '9000000001' },
  });

  const password = await bcrypt.hash('Test@123', 12);
  const roles = await prisma.role.findMany({ select: { id: true, slug: true } });
  const roleMap = Object.fromEntries(roles.map(r => [r.slug, r.id]));

  const seedUsers = [
    { name: 'Super Admin',    email: 'admin@claimoptiq.com',        roleSlug: 'super_admin',   hospitalId: null },
    { name: 'FCC Staff',      email: 'fccstaff@claimoptiq.com',     roleSlug: 'fcc_staff',     hospitalId: null },
    { name: 'Hospital Admin', email: 'hospitaladmin@claimoptiq.com', roleSlug: 'hospital_admin', hospitalId: demoHospital.id },
    { name: 'Hospital Staff', email: 'hospitalstaff@claimoptiq.com', roleSlug: 'hospital_staff', hospitalId: demoHospital.id },
  ];

  await prisma.user.deleteMany({ where: { email: { in: seedUsers.map(u => u.email) } } });
  for (const u of seedUsers) {
    await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        password,
        roleId: roleMap[u.roleSlug],
        hospitalId: u.hospitalId,
        phone: '9000000000',
      },
    });
  }
  console.log('  ✓ 4 users (all password: Test@123)');
  seedUsers.forEach(u => console.log(`      ${u.email} — ${u.roleSlug}`));

  console.log('\n✅ Seed complete!');
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
