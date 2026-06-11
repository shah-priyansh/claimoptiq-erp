const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

const hospitalInclude = {
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  doctors: true,
};

const hospitalListInclude = {
  billingServices: { select: { id: true } },
  doctors: { select: { id: true } },
};

const validateHospitalFields = (body) => {
  if (body.phone && !isValidPhone(body.phone)) return 'Enter a valid 10-digit Indian mobile number (starts with 6-9)';
  if (body.email && !isValidEmail(body.email)) return 'Enter a valid email address';
  if (body.pincode && !isValidPincode(body.pincode)) return 'Enter a valid 6-digit Indian pincode';
  if (Array.isArray(body.doctors)) {
    for (let i = 0; i < body.doctors.length; i++) {
      const d = body.doctors[i];
      if (!d.name || !d.name.trim()) return `Doctor #${i + 1}: Name is required`;
      if (d.phone && !isValidPhone(d.phone)) return `Doctor #${i + 1}: Enter a valid 10-digit mobile number`;
      if (d.email && !isValidEmail(d.email)) return `Doctor #${i + 1}: Enter a valid email address`;
    }
  }
  return null;
};

const buildHospitalData = (body) => ({
  name: body.name,
  contact: body.contact || '',
  email: body.email || '',
  phone: body.phone || '',
  address: body.address || '',
  city: body.city || '',
  state: body.state || '',
  pincode: body.pincode || '',
  referenceBy: body.referenceBy || '',
  isActive: body.isActive !== undefined ? body.isActive : true,
});

const buildBillingServices = (services) =>
  (services || []).map((s) => ({
    serviceName: s.serviceName,
    billingType: s.billingType,
    fixedAmount: s.fixedAmount || 0,
    claimLimit: s.claimLimit || 0,
    overLimitBehavior: s.overLimitBehavior || 'per_claim',
    overLimitPerClaimAmount: s.overLimitPerClaimAmount || 0,
    overLimitInsuranceWise: Boolean(s.overLimitInsuranceWise),
    overLimitInsurerIds: Array.isArray(s.overLimitInsurerIds) ? s.overLimitInsurerIds : [],
    calculationBasis: s.calculationBasis || 'none',
    percentageRate: s.percentageRate || 0,
    slabMode: s.slabMode || 'slab_wise',
    slabRangeStart: s.slabRangeStart || 0,
    slabIncrementRange: s.slabIncrementRange || 0,
    slabIncrementPrice: s.slabIncrementPrice || 0,
    isActive: s.isActive !== undefined ? s.isActive : true,
    slabs: {
      create: (s.slabs || []).map((slab, i) => ({
        rangeStart: slab.rangeStart || 0,
        rangeEnd: slab.rangeEnd || 0,
        price: slab.price || 0,
        order: i,
      })),
    },
  }));

const buildDoctors = (doctors) =>
  (doctors || []).map((d) => ({
    name: d.name.trim(),
    specialization: d.specialization || '',
    phone: d.phone || '',
    email: d.email || '',
  }));

exports.bulkImportHospitals = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) return res.status(400).json({ message: 'Maximum 2000 rows per import' });

    const existing = await prisma.hospital.findMany({ select: { id: true, name: true, isActive: true } });
    const activeMap = new Map();
    const inactiveMap = new Map();
    for (const e of existing) {
      const key = e.name.trim().toLowerCase();
      (e.isActive ? activeMap : inactiveMap).set(key, e);
    }

    const seenInBatch = new Set();
    const created = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const name = String(row.name || '').trim();
      const key = name.toLowerCase();
      const rowErrors = [];
      if (!name) rowErrors.push('Name is required');
      else if (activeMap.has(key)) rowErrors.push(`"${name}" already exists`);
      else if (seenInBatch.has(key)) rowErrors.push(`"${name}" is duplicated in the file`);
      const fieldErr = validateHospitalFields({ phone: row.phone, email: row.email, pincode: row.pincode });
      if (fieldErr) rowErrors.push(fieldErr);

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }
      try {
        const data = buildHospitalData({
          name, contact: row.contact, email: row.email, phone: row.phone, address: row.address,
          city: row.city, state: row.state, pincode: row.pincode, referenceBy: row.referenceBy,
        });
        const inactive = inactiveMap.get(key);
        const hospital = inactive
          ? await prisma.hospital.update({
              where: { id: inactive.id },
              data: { ...data, isActive: true },
              select: { id: true, name: true },
            })
          : await prisma.hospital.create({ data, select: { id: true, name: true } });
        seenInBatch.add(key);
        created.push({ row: rowNum, id: hospital.id, name: hospital.name });
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    res.status(errors.length && !created.length ? 400 : 200).json({
      message: `Imported ${created.length} of ${rows.length} hospital(s)`,
      created, errors, totalRows: rows.length, successCount: created.length, errorCount: errors.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });

    const hospital = await prisma.hospital.create({
      data: {
        ...buildHospitalData(req.body),
        billingServices: { create: buildBillingServices(req.body.billingServices) },
        doctors: { create: buildDoctors(req.body.doctors) },
      },
      include: hospitalInclude,
    });
    res.status(201).json(toResponse(hospital));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const { search, active, page, limit = 25 } = req.query;
    const where = {};

    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const userHospId = req.user.hospitalId || req.user.hospital?.id;
    if (userHospId) {
      where.id = userHospId;
    }

    if (page !== undefined) {
      const skip = (Number(page) - 1) * Number(limit);
      const [hospitals, total] = await Promise.all([
        prisma.hospital.findMany({
          where,
          include: hospitalListInclude,
          orderBy: { name: 'asc' },
          skip,
          take: Number(limit),
        }),
        prisma.hospital.count({ where }),
      ]);
      return res.json({
        hospitals: toResponse(hospitals),
        total,
        pages: Math.ceil(total / Number(limit)),
      });
    }

    const hospitals = await prisma.hospital.findMany({
      where,
      include: hospitalInclude,
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(hospitals));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospital = async (req, res) => {
  try {
    const userHospitalId = req.user.hospitalId || req.user.hospital?.id;
    if (userHospitalId && req.params.id !== userHospitalId) {
      return res.status(403).json({ message: 'You can only view your own hospital' });
    }

    const hospital = await prisma.hospital.findUnique({
      where: { id: req.params.id },
      include: hospitalInclude,
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json(toResponse(hospital));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateHospital = async (req, res) => {
  try {
    const err = validateHospitalFields(req.body);
    if (err) return res.status(400).json({ message: err });

    const existing = await prisma.hospital.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Hospital not found' });

    await prisma.hospitalBillingService.deleteMany({ where: { hospitalId: req.params.id } });
    await prisma.hospitalDoctor.deleteMany({ where: { hospitalId: req.params.id } });

    const hospital = await prisma.hospital.update({
      where: { id: req.params.id },
      data: {
        ...buildHospitalData(req.body),
        billingServices: { create: buildBillingServices(req.body.billingServices) },
        doctors: { create: buildDoctors(req.body.doctors) },
      },
      include: hospitalInclude,
    });
    res.json(toResponse(hospital));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteHospital = async (req, res) => {
  try {
    const hospital = await prisma.hospital.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    if (!hospital) return res.status(404).json({ message: 'Hospital not found' });
    res.json({ message: 'Hospital deactivated' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
