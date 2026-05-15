const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

const hospitalInclude = {
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  doctors: true,
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
    const { search, active } = req.query;
    const where = {};

    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (req.user.hospital) {
      where.id = req.user.hospital.id || req.user.hospital;
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
    if (req.user.hospital) {
      const userHospitalId = req.user.hospital.id || req.user.hospital;
      if (req.params.id !== userHospitalId) {
        return res.status(403).json({ message: 'You can only view your own hospital' });
      }
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
