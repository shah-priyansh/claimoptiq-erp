require('dotenv').config();
const User = require('./models/User');
const Role = require('./models/Role');
const Hospital = require('./models/Hospital');
const InsuranceCompany = require('./models/InsuranceCompany');
const TPA = require('./models/TPA');
const ClaimStatus = require('./models/ClaimStatus');

const connectDB = require('./config/db');

// Default module permissions for each role
const allModules = ['dashboard', 'claims', 'hospitals', 'insurance', 'tpa', 'users', 'roles', 'reports', 'claim_statuses'];

const buildPermissions = (config) => {
  return allModules.map(mod => ({
    module: mod,
    permissions: {
      view: config[mod]?.view ?? false,
      create: config[mod]?.create ?? false,
      edit: config[mod]?.edit ?? false,
      delete: config[mod]?.delete ?? false,
      export: config[mod]?.export ?? false,
    }
  }));
};

const defaultRoles = [
  {
    name: 'Super Admin',
    slug: 'super_admin',
    description: 'Full system access. Cannot be deleted.',
    isSystem: true,
    modulePermissions: buildPermissions({
      dashboard: { view: true },
      claims: { view: true, create: true, edit: true, delete: true, export: true },
      hospitals: { view: true, create: true, edit: true, delete: true },
      insurance: { view: true, create: true, edit: true, delete: true },
      tpa: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true, delete: true },
      roles: { view: true, create: true, edit: true, delete: true },
      reports: { view: true, export: true },
    }),
  },
  {
    name: 'Admin',
    slug: 'admin',
    description: 'Administrative access to all operations except role management.',
    isSystem: true,
    modulePermissions: buildPermissions({
      dashboard: { view: true },
      claims: { view: true, create: true, edit: true, delete: true, export: true },
      hospitals: { view: true, create: true, edit: true, delete: true },
      insurance: { view: true, create: true, edit: true, delete: true },
      tpa: { view: true, create: true, edit: true, delete: true },
      users: { view: true, create: true, edit: true },
      roles: { view: true },
      reports: { view: true, export: true },
    }),
  },
  {
    name: 'Staff',
    slug: 'staff',
    description: 'Can manage claims and view hospitals. No admin access.',
    isSystem: true,
    modulePermissions: buildPermissions({
      dashboard: { view: true },
      claims: { view: true, create: true, edit: true, export: true },
      hospitals: { view: true },
      insurance: { view: true },
      tpa: { view: true },
      reports: { view: true, export: true },
    }),
  },
  {
    name: 'Hospital',
    slug: 'hospital',
    description: 'Hospital users. Read-only access to their own claims.',
    isSystem: true,
    modulePermissions: buildPermissions({
      dashboard: { view: true },
      claims: { view: true },
    }),
  },
  {
    name: 'Tester',
    slug: 'tester',
    description: 'Testing role with limited module access for QA.',
    isSystem: false,
    modulePermissions: buildPermissions({
      dashboard: { view: true },
      roles: { view: true, create: true, edit: true, delete: true },
      insurance: { view: true, create: true, edit: true, delete: true },
      tpa: { view: true, create: true, edit: true, delete: true },
    }),
  },
];

const seedData = async () => {
  await connectDB();

  // 1. Seed Roles
  const roleMap = {};
  for (const roleDef of defaultRoles) {
    const role = await Role.findOneAndUpdate(
      { slug: roleDef.slug },
      roleDef,
      { upsert: true, returnDocument: 'after' }
    );
    roleMap[roleDef.slug] = role._id;
  }
  console.log(`${defaultRoles.length} Roles seeded`);

  // 2. Create/Update Super Admin user
  const existingAdmin = await User.findOne({ email: 'admin@claimoptiq.com' });
  if (!existingAdmin) {
    await User.create({
      name: 'Super Admin',
      email: 'admin@claimoptiq.com',
      password: 'Admin@123',
      role: roleMap.super_admin,
      phone: '9999999999'
    });
    console.log('Super Admin created: admin@claimoptiq.com / Admin@123');
  } else {
    // Migrate existing user to new role reference
    existingAdmin.role = roleMap.super_admin;
    await existingAdmin.save();
    console.log('Super Admin role updated');
  }

  // 2b. Create Tester user
  const existingTester = await User.findOne({ email: 'tester@claimoptiq.com' });
  if (!existingTester) {
    await User.create({
      name: 'Test User',
      email: 'tester@claimoptiq.com',
      password: 'Test@123',
      role: roleMap.tester,
      phone: '8888888888'
    });
    console.log('Tester created: tester@claimoptiq.com / Test@123');
  } else {
    existingTester.role = roleMap.tester;
    await existingTester.save();
    console.log('Tester role updated');
  }

  // 3. Seed Insurance Companies
  const insuranceCompanies = [
    'CARE HEALTH INSURANCE LIMITED',
    'HDFC ERGO GENERAL INSURANCE COMPANY LTD.',
    'STAR HEALTH AND ALLIED INSURANCE COMPANY LIMITED',
    'ROYAL SUNDARAM GENERAL INSURANCE CO. LIMITED',
    'ADITYA BIRLA HEALTH INSURANCE CO. LTD.',
    'THE NEW INDIA ASSURANCE CO LTD',
    'BAJAJ ALLIANZ GENERAL INSURANCE CO. LTD.',
    'ICICI LOMBARD GENERAL INSURANCE CO. LTD.',
    'NIVA BUPA HEALTH INSURANCE COMPANY LIMITED',
    'TATA AIG GENERAL INSURANCE CO. LTD.'
  ];

  for (const name of insuranceCompanies) {
    await InsuranceCompany.findOneAndUpdate(
      { name },
      { name, isActive: true },
      { upsert: true }
    );
  }
  console.log(`${insuranceCompanies.length} Insurance companies seeded`);

  // 4. Seed TPAs
  const tpas = [
    'HEALTH INDIA TPA SERVICES PRIVATE LIMITED',
    'MEDI ASSIST INSURANCE TPA PRIVATE LIMITED.',
    'PARAMOUNT HEALTH SERVICES & INSURANCE TPA PVT. LTD.',
    'VIPUL MEDCORP TPA PVT LTD',
    'RAKSHA TPA PVT. LTD.',
    'GOOD HEALTH TPA SERVICES LTD.'
  ];

  for (const name of tpas) {
    await TPA.findOneAndUpdate(
      { name },
      { name, isActive: true },
      { upsert: true }
    );
  }
  console.log(`${tpas.length} TPAs seeded`);

  // 5. Seed Hospitals
  const hospitals = [
    { name: 'AAGNEY HOSPITAL', referenceBy: 'FENIL PANWALA' },
    { name: 'AARUSHI ORTHOPEDIC HOSPITAL', referenceBy: 'FENIL PANWALA' },
    { name: 'AASTHA HOSPITAL AND DIAGNOSTIC CENTER', referenceBy: 'RAVI PAGHDAR' },
    { name: 'ACCURA EYE CARE', referenceBy: 'RAVI PAGHDAR' },
    { name: 'AKSHAR EYE HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'AMRUTAM HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'ANAND HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'ANANTA HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'ASTITVA ORTHOPAEDIC AND MEDICAL HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'BABY CARE CHILDREN HOSPITAL', referenceBy: 'FENIL PANWALA' },
    { name: 'BALAR ORTHOPEDIC HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'BASIL ONCO CARE HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'BIRTH BEYOND HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'CAPITAL HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'CARE AND CURE HOSPITAL', referenceBy: 'RAVI PAGHDAR' },
    { name: 'DEEPAK ENT HOSPITAL', referenceBy: 'FENIL PANWALA' },
    { name: 'KOKILABEN ORTHOPAEDIC AND LUNGS HOSPITAL', referenceBy: 'MEHUL PANDAV' },
    { name: 'DHRUV ORTHOPAEDIC & SURGICAL HOSPITAL', referenceBy: '' },
    { name: 'GARVIT ENT HOSPITAL', referenceBy: '' },
    { name: 'GHELANI RETINA HOSPITAL', referenceBy: '' },
    { name: 'ICON PLUS HOSPITAL', referenceBy: '' },
    { name: 'LILABA HOSPITAL', referenceBy: '' },
    { name: 'MEDIWISE HOSPITAL', referenceBy: '' },
    { name: 'SHIV ORTHOPAEDIC HOSPITAL', referenceBy: '' },
    { name: 'VITRAG HOSPITAL', referenceBy: '' },
  ];

  for (const h of hospitals) {
    await Hospital.findOneAndUpdate(
      { name: h.name },
      { name: h.name, referenceBy: h.referenceBy, city: 'Surat', state: 'Gujarat', isActive: true },
      { upsert: true }
    );
  }
  console.log(`${hospitals.length} Hospitals seeded`);

  // Seed default Claim Statuses
  const defaultStatuses = [
    { slug: 'admitted',      label: 'Admitted',      color: 'blue',   order: 1, isSystem: true },
    { slug: 'discharged',    label: 'Discharged',    color: 'yellow', order: 2, isSystem: true },
    { slug: 'file_received', label: 'File Received', color: 'purple', order: 3, isSystem: true },
    { slug: 'submitted',     label: 'Submitted',     color: 'orange', order: 4, isSystem: true },
    { slug: 'settled',       label: 'Settled',       color: 'green',  order: 5, isSystem: true },
    { slug: 'rejected',      label: 'Rejected',      color: 'red',    order: 6, isSystem: true },
  ];
  for (const s of defaultStatuses) {
    await ClaimStatus.findOneAndUpdate({ slug: s.slug }, s, { upsert: true });
  }
  console.log(`${defaultStatuses.length} Claim Statuses seeded`);

  console.log('Seed completed!');
  process.exit(0);
};

seedData().catch(err => {
  console.error(err);
  process.exit(1);
});
