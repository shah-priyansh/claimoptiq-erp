require('dotenv').config();
const mongoose = require('mongoose');
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const MongoRole = require('./models/Role');
const MongoUser = require('./models/User');
const MongoHospital = require('./models/Hospital');
const MongoInsurance = require('./models/InsuranceCompany');
const MongoTPA = require('./models/TPA');
const MongoClaimStatus = require('./models/ClaimStatus');
const MongoClaimDocumentType = require('./models/ClaimDocumentType');
const MongoClaim = require('./models/Claim');
const MongoDocSub = require('./models/DocumentSubmission');

const prisma = new PrismaClient();
const idMap = {};

const mapId = (collection, mongoId) => `${collection}:${mongoId?.toString()}`;
const getNewId = (collection, mongoId) => idMap[mapId(collection, mongoId)];
const setNewId = (collection, mongoId, newId) => { idMap[mapId(collection, mongoId)] = newId; };

async function migrateRoles() {
  console.log('Migrating roles...');
  const roles = await MongoRole.find();
  for (const r of roles) {
    const newId = uuidv4();
    setNewId('roles', r._id, newId);
    await prisma.role.create({
      data: {
        id: newId,
        name: r.name,
        slug: r.slug,
        description: r.description || '',
        isSystem: r.isSystem || false,
        isActive: r.isActive !== false,
        createdAt: r.createdAt || new Date(),
        updatedAt: r.updatedAt || new Date(),
        modulePermissions: {
          create: (r.modulePermissions || []).map((mp) => ({
            module: mp.module,
            view: mp.permissions?.view || false,
            create: mp.permissions?.create || false,
            edit: mp.permissions?.edit || false,
            delete: mp.permissions?.delete || false,
            export: mp.permissions?.export || false,
          })),
        },
      },
    });
  }
  console.log(`  ✓ ${roles.length} roles`);
}

async function migrateHospitals() {
  console.log('Migrating hospitals...');
  const hospitals = await MongoHospital.find();
  for (const h of hospitals) {
    const newId = uuidv4();
    setNewId('hospitals', h._id, newId);
    await prisma.hospital.create({
      data: {
        id: newId,
        name: h.name,
        contact: h.contact || '',
        email: h.email || '',
        phone: h.phone || '',
        address: h.address || '',
        city: h.city || '',
        state: h.state || '',
        pincode: h.pincode || '',
        referenceBy: h.referenceBy || '',
        isActive: h.isActive !== false,
        createdAt: h.createdAt || new Date(),
        updatedAt: h.updatedAt || new Date(),
        billingServices: {
          create: (h.billingServices || []).map((s) => ({
            id: uuidv4(),
            serviceName: s.serviceName,
            billingType: s.billingType,
            fixedAmount: s.fixedAmount || 0,
            claimLimit: s.claimLimit || 0,
            overLimitBehavior: s.overLimitBehavior || 'no_charge',
            overLimitPerClaimAmount: s.overLimitPerClaimAmount || 0,
            slabRangeStart: s.slabRangeStart || 0,
            slabRangeEnd: s.slabRangeEnd || 50000,
            slabBasePrice: s.slabBasePrice || 2000,
            slabIncrementRange: s.slabIncrementRange || 50000,
            slabIncrementPrice: s.slabIncrementPrice || 500,
            calculationBasis: s.calculationBasis || 'none',
            isActive: s.isActive !== false,
          })),
        },
        doctors: {
          create: (h.doctors || []).map((d) => ({
            id: uuidv4(),
            name: d.name,
            specialization: d.specialization || '',
            phone: d.phone || '',
            email: d.email || '',
          })),
        },
      },
    });
  }
  console.log(`  ✓ ${hospitals.length} hospitals`);
}

async function migrateInsurance() {
  console.log('Migrating insurance companies...');
  const items = await MongoInsurance.find();
  for (const item of items) {
    const newId = uuidv4();
    setNewId('insurance', item._id, newId);
    await prisma.insuranceCompany.create({
      data: {
        id: newId,
        name: item.name,
        isActive: item.isActive !== false,
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${items.length} insurance companies`);
}

async function migrateTPA() {
  console.log('Migrating TPAs...');
  const items = await MongoTPA.find();
  for (const item of items) {
    const newId = uuidv4();
    setNewId('tpa', item._id, newId);
    await prisma.tPA.create({
      data: {
        id: newId,
        name: item.name,
        isActive: item.isActive !== false,
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${items.length} TPAs`);
}

async function migrateClaimStatuses() {
  console.log('Migrating claim statuses...');
  const items = await MongoClaimStatus.find();
  for (const item of items) {
    const newId = uuidv4();
    setNewId('claimstatus', item._id, newId);
    await prisma.claimStatus.create({
      data: {
        id: newId,
        slug: item.slug,
        label: item.label,
        color: item.color || 'gray',
        order: item.order || 0,
        isActive: item.isActive !== false,
        isSystem: item.isSystem || false,
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${items.length} claim statuses`);
}

async function migrateClaimDocumentTypes() {
  console.log('Migrating claim document types...');
  const items = await MongoClaimDocumentType.find();
  for (const item of items) {
    const newId = uuidv4();
    setNewId('claimdoctype', item._id, newId);
    await prisma.claimDocumentType.create({
      data: {
        id: newId,
        name: item.name,
        description: item.description || '',
        isRequired: item.isRequired || false,
        order: item.order || 0,
        isActive: item.isActive !== false,
        isSystem: item.isSystem || false,
        createdAt: item.createdAt || new Date(),
        updatedAt: item.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${items.length} claim document types`);
}

async function migrateUsers() {
  console.log('Migrating users...');
  const users = await MongoUser.find();
  for (const u of users) {
    const newId = uuidv4();
    setNewId('users', u._id, newId);
    const roleId = getNewId('roles', u.role);
    const hospitalId = u.hospital ? getNewId('hospitals', u.hospital) : null;
    await prisma.user.create({
      data: {
        id: newId,
        name: u.name,
        email: u.email,
        password: u.password,
        roleId,
        hospitalId: hospitalId || null,
        phone: u.phone,
        isActive: u.isActive !== false,
        createdAt: u.createdAt || new Date(),
        updatedAt: u.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${users.length} users`);
}

async function migrateClaims() {
  console.log('Migrating claims...');
  const claims = await MongoClaim.find().sort({ srNo: 1 });
  for (const c of claims) {
    const newId = uuidv4();
    setNewId('claims', c._id, newId);
    const hospitalId = getNewId('hospitals', c.hospital);
    const insuranceCompanyId = c.insuranceCompany ? getNewId('insurance', c.insuranceCompany) : null;
    const tpaId = c.tpa ? getNewId('tpa', c.tpa) : null;
    const createdById = c.createdBy ? getNewId('users', c.createdBy) : null;
    const updatedById = c.updatedBy ? getNewId('users', c.updatedBy) : null;

    await prisma.claim.create({
      data: {
        id: newId,
        srNo: c.srNo,
        monthClaimNo: c.monthClaimNo || 0,
        claimGenerateDate: c.claimGenerateDate || c.createdAt || new Date(),
        status: c.status || 'admitted',
        hospitalId,
        month: c.month,
        patientName: c.patientName,
        patientMobile: c.patientMobile || '',
        doctorName: c.doctorName || '',
        claimType: c.claimType,
        insuranceCompanyId: insuranceCompanyId || null,
        tpaId: tpaId || null,
        policyNo: c.policyNo || '',
        clientId: c.clientId || '',
        ccnNo: c.ccnNo || '',
        dateOfAdmit: c.dateOfAdmit,
        dateOfDischarge: c.dateOfDischarge || null,
        hospitalFinalBill: c.hospitalFinalBill || 0,
        mouDiscount: c.mouDiscount || 0,
        deduction: c.deduction || 0,
        finalApprovalAmount: c.finalApprovalAmount || 0,
        finalApprovalDate: c.finalApprovalDate || null,
        fileReceivedDate: c.fileReceivedDate || null,
        submitMode: c.submitMode || '',
        courierSubmitDate: c.courierSubmitDate || null,
        onlineSubmitDate: c.onlineSubmitDate || null,
        courierCompanyName: c.courierCompanyName || '',
        podNumber: c.podNumber || '',
        settlementAmount: c.settlementAmount || 0,
        settlementAmountDeduction: c.settlementAmountDeduction || 0,
        mouDiscountOnSettlement: c.mouDiscountOnSettlement || 0,
        tds: c.tds || 0,
        bankTransferAmount: c.bankTransferAmount || 0,
        settlementDate: c.settlementDate || null,
        neftNo: c.neftNo || '',
        filePrice: c.filePrice || 0,
        remarks: c.remarks || '',
        rejectedReason: c.rejectedReason || '',
        createdById: createdById || null,
        updatedById: updatedById || null,
        createdAt: c.createdAt || new Date(),
        updatedAt: c.updatedAt || new Date(),
        documents: {
          create: (c.documents || []).map((d) => ({
            id: uuidv4(),
            fileName: d.fileName,
            originalName: d.originalName,
            filePath: d.filePath,
            fileType: d.fileType || null,
            fileSize: d.fileSize || null,
            category: d.category || 'other',
            uploadedAt: d.uploadedAt || new Date(),
          })),
        },
      },
    });
  }

  const maxSrNo = claims.reduce((m, c) => Math.max(m, c.srNo || 0), 0);
  if (maxSrNo > 0) {
    await prisma.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('claims', 'sr_no'), ${maxSrNo}, true)`
    );
  }

  console.log(`  ✓ ${claims.length} claims`);
}

async function migrateDocumentSubmissions() {
  console.log('Migrating document submissions...');
  const subs = await MongoDocSub.find();
  for (const s of subs) {
    const newId = uuidv4();
    const hospitalId = getNewId('hospitals', s.hospital);
    const documentTypeId = getNewId('claimdoctype', s.documentType);
    const claimId = s.claim ? getNewId('claims', s.claim) : null;
    const uploadedById = s.uploadedBy ? getNewId('users', s.uploadedBy) : null;

    await prisma.documentSubmission.create({
      data: {
        id: newId,
        hospitalId,
        patientName: s.patientName,
        documentTypeId,
        fileName: s.file?.fileName || '',
        originalName: s.file?.originalName || '',
        filePath: s.file?.filePath || '',
        fileType: s.file?.fileType || null,
        fileSize: s.file?.fileSize || null,
        status: s.status || 'pending',
        claimId: claimId || null,
        notes: s.notes || '',
        uploadedById: uploadedById || null,
        createdAt: s.createdAt || new Date(),
        updatedAt: s.updatedAt || new Date(),
      },
    });
  }
  console.log(`  ✓ ${subs.length} document submissions`);
}

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connecting to PostgreSQL...');
  await prisma.$connect();

  await migrateRoles();
  await migrateHospitals();
  await migrateInsurance();
  await migrateTPA();
  await migrateClaimStatuses();
  await migrateClaimDocumentTypes();
  await migrateUsers();
  await migrateClaims();
  await migrateDocumentSubmissions();

  console.log('\n✅ Migration complete!');
  await mongoose.disconnect();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
