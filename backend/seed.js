require('dotenv').config();
const User = require('./models/User');
const Role = require('./models/Role');
const Hospital = require('./models/Hospital');
const InsuranceCompany = require('./models/InsuranceCompany');
const TPA = require('./models/TPA');
const ClaimStatus = require('./models/ClaimStatus');
const ClaimDocumentType = require('./models/ClaimDocumentType');

const connectDB = require('./config/db');

// All modules in the system — must match roleController.getModules()
const allModules = [
  'dashboard', 'claims', 'hospitals', 'insurance', 'tpa',
  'users', 'roles', 'reports', 'claim_statuses',
  'claim_document_types', 'document_submissions',
];

const buildPermissions = (config) => {
  return allModules.map(mod => ({
    module: mod,
    permissions: {
      view:   config[mod]?.view   ?? false,
      create: config[mod]?.create ?? false,
      edit:   config[mod]?.edit   ?? false,
      delete: config[mod]?.delete ?? false,
      export: config[mod]?.export ?? false,
    }
  }));
};

const defaultRoles = [
  // ─── System Roles ──────────────────────────────────────────────────────────
  {
    name: 'Super Admin',
    slug: 'super_admin',
    description: 'Full system access. Cannot be deleted.',
    isSystem: true,
    modulePermissions: buildPermissions({
      dashboard:           { view: true },
      claims:              { view: true, create: true, edit: true, delete: true, export: true },
      hospitals:           { view: true, create: true, edit: true, delete: true },
      insurance:           { view: true, create: true, edit: true, delete: true },
      tpa:                 { view: true, create: true, edit: true, delete: true },
      users:               { view: true, create: true, edit: true, delete: true },
      roles:               { view: true, create: true, edit: true, delete: true },
      reports:             { view: true, export: true },
      claim_statuses:      { view: true, create: true, edit: true, delete: true },
      claim_document_types:{ view: true, create: true, edit: true, delete: true },
      document_submissions:{ view: true, create: true, edit: true, delete: true },
    }),
  },
  // ─── Hospital Admin ─────────────────────────────────────────────────────────
  // Linked to a hospital. Sees their hospital's dashboard, claims, reports, docs.
  {
    name: 'Hospital Admin',
    slug: 'hospital_admin',
    description: 'Hospital administrator. Can view their hospital\'s claims, reports and upload documents.',
    isSystem: false,
    modulePermissions: buildPermissions({
      dashboard:           { view: true },
      claims:              { view: true, export: true },
      reports:             { view: true, export: true },
      document_submissions:{ view: true, create: true, edit: true, delete: true },
    }),
  },

  // ─── Hospital Staff ──────────────────────────────────────────────────────────
  {
    name: 'Hospital Staff',
    slug: 'hospital_staff',
    description: 'Hospital staff. Can view claims and upload documents for their hospital.',
    isSystem: false,
    modulePermissions: buildPermissions({
      claims:              { view: true },
      document_submissions:{ view: true, create: true },
    }),
  },

  // ─── FCC Staff ────────────────────────────────────────────────────────────────
  // FCC team member. Reviews documents, processes claims. No financial dashboard.
  {
    name: 'FCC Staff',
    slug: 'fcc_staff',
    description: 'FCC team member. Manages document inbox, claims, and master data.',
    isSystem: false,
    modulePermissions: buildPermissions({
      claims:              { view: true, create: true, edit: true, export: true },
      hospitals:           { view: true },
      insurance:           { view: true },
      tpa:                 { view: true },
      reports:             { view: true, export: true },
      claim_statuses:      { view: true, create: true, edit: true },
      claim_document_types:{ view: true, create: true, edit: true, delete: true },
      document_submissions:{ view: true, edit: true, delete: true },
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

  // 2b. FCC Staff user (no hospital linkage)
  const existingFCCStaff = await User.findOne({ email: 'fccstaff@claimoptiq.com' });
  if (!existingFCCStaff) {
    await User.create({
      name: 'FCC Staff',
      email: 'fccstaff@claimoptiq.com',
      password: 'FCC@12345',
      role: roleMap.fcc_staff,
      phone: '7777777701'
    });
    console.log('FCC Staff created: fccstaff@claimoptiq.com / FCC@12345');
  } else {
    existingFCCStaff.role = roleMap.fcc_staff;
    await existingFCCStaff.save();
    console.log('FCC Staff role updated');
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

  // Pick a demo hospital for hospital users
  const demoHospital = await Hospital.findOne({ name: 'AAGNEY HOSPITAL' });
  const demoHospitalId = demoHospital?._id;

  // Hospital Admin user
  const existingHospitalAdmin = await User.findOne({ email: 'hospitaladmin@claimoptiq.com' });
  if (!existingHospitalAdmin) {
    await User.create({
      name: 'Hospital Admin',
      email: 'hospitaladmin@claimoptiq.com',
      password: 'Hospital@123',
      role: roleMap.hospital_admin,
      hospital: demoHospitalId,
      phone: '7777777702'
    });
    console.log('Hospital Admin created: hospitaladmin@claimoptiq.com / Hospital@123 → AAGNEY HOSPITAL');
  } else {
    existingHospitalAdmin.role = roleMap.hospital_admin;
    existingHospitalAdmin.hospital = demoHospitalId;
    await existingHospitalAdmin.save();
    console.log('Hospital Admin role/hospital updated');
  }

  // Hospital Staff user
  const existingHospitalStaff = await User.findOne({ email: 'hospitalstaff@claimoptiq.com' });
  if (!existingHospitalStaff) {
    await User.create({
      name: 'Hospital Staff',
      email: 'hospitalstaff@claimoptiq.com',
      password: 'Staff@12345',
      role: roleMap.hospital_staff,
      hospital: demoHospitalId,
      phone: '7777777703'
    });
    console.log('Hospital Staff created: hospitalstaff@claimoptiq.com / Staff@12345 → AAGNEY HOSPITAL');
  } else {
    existingHospitalStaff.role = roleMap.hospital_staff;
    existingHospitalStaff.hospital = demoHospitalId;
    await existingHospitalStaff.save();
    console.log('Hospital Staff role/hospital updated');
  }

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

  // Seed default Claim Document Types
  const defaultDocTypes = [
    // ── Mandatory documents (isRequired: true) ───────────────────────────────
    { name: 'Claim Form',                description: 'Duly filled and signed insurance claim form',                  isRequired: true,  order: 1,  isSystem: true },
    { name: 'Discharge Summary',         description: 'Hospital discharge summary with diagnosis and treatment details', isRequired: true,  order: 2,  isSystem: true },
    { name: 'Final Hospital Bill',        description: 'Itemised final bill from the hospital',                         isRequired: true,  order: 3,  isSystem: true },
    { name: 'Payment Receipt',           description: 'Proof of payment made to the hospital',                         isRequired: true,  order: 4,  isSystem: true },
    { name: 'Indoor Case Papers',        description: 'Complete in-patient case history and treatment record',          isRequired: true,  order: 5,  isSystem: true },
    { name: 'Investigation Reports',     description: 'Lab, pathology, radiology and diagnostic test reports',         isRequired: true,  order: 6,  isSystem: true },
    { name: 'Prescription / Doctor\'s Advice', description: 'Doctor\'s prescription for medicines and tests',         isRequired: true,  order: 7,  isSystem: true },
    { name: 'Policy / Insurance Card',   description: 'Copy of insurance policy document or health card',              isRequired: true,  order: 8,  isSystem: true },
    { name: 'ID Proof',                  description: 'Patient\'s government-issued photo identity proof',              isRequired: true,  order: 9,  isSystem: true },
    // ── Supporting documents (isRequired: false) ─────────────────────────────
    { name: 'Pre-Authorisation Letter',  description: 'TPA / insurer\'s pre-authorisation approval letter',            isRequired: false, order: 10, isSystem: true },
    { name: 'OT Notes',                  description: 'Operation theatre / surgical notes',                            isRequired: false, order: 11, isSystem: true },
    { name: 'Pharmacy Bills',            description: 'Bills for medicines purchased outside the hospital pharmacy',    isRequired: false, order: 12, isSystem: true },
    { name: 'Ambulance Receipt',         description: 'Receipt for ambulance charges',                                 isRequired: false, order: 13, isSystem: true },
    { name: 'MLC / FIR Copy',           description: 'Medico-Legal Case or First Information Report (for accidents)',  isRequired: false, order: 14, isSystem: true },
    { name: 'NEFT / Bank Details',       description: 'Cancelled cheque or bank passbook copy for reimbursement',      isRequired: false, order: 15, isSystem: true },
    { name: 'Sticker / Implant Invoice', description: 'Invoice for implants, stents or prosthetics used',             isRequired: false, order: 16, isSystem: true },
    { name: 'Consultation Papers',       description: 'Outpatient consultation notes and referral letters',            isRequired: false, order: 17, isSystem: true },
    { name: 'Previous Treatment Records', description: 'Earlier treatment records relevant to the current claim',     isRequired: false, order: 18, isSystem: true },
  ];

  for (const dt of defaultDocTypes) {
    await ClaimDocumentType.findOneAndUpdate(
      { name: dt.name },
      { ...dt, isActive: true },
      { upsert: true }
    );
  }
  console.log(`${defaultDocTypes.length} Claim Document Types seeded`);

  console.log('Seed completed!');
  process.exit(0);
};

seedData().catch(err => {
  console.error(err);
  process.exit(1);
});
