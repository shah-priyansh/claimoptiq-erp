const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());
const isValidPincode = (v) => /^[1-9][0-9]{5}$/.test((v || '').trim());

const hospitalInclude = {
  billingServices: { include: { slabs: { orderBy: { order: 'asc' } } } },
  doctors: true,
  reference: { select: { id: true, name: true, commissionRate: true, isActive: true } },
};

const hospitalListInclude = {
  billingServices: { select: { id: true } },
  doctors: { select: { id: true } },
  reference: { select: { id: true, name: true } },
};

// Tiny include for dropdown callsites — only the fields a SearchableSelect
// renders. Cuts the response by ~99% vs the full hospitalInclude, so
// dropdowns can fetch every hospital in one shot without dragging billing
// services / slabs / doctors over the wire.
const hospitalDropdownSelect = {
  id: true, name: true, isActive: true, referenceBy: true,
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

const buildHospitalData = async (body) => {
  const referenceId =
    body.referenceId === '' || body.referenceId === null
      ? null
      : body.referenceId === undefined
        ? undefined
        : body.referenceId;
  let referenceByFromRef;
  if (referenceId) {
    const ref = await prisma.reference.findUnique({ where: { id: referenceId }, select: { name: true } });
    if (!ref) {
      const err = new Error('Reference not found');
      err.status = 400;
      throw err;
    }
    referenceByFromRef = ref.name;
  } else if (referenceId === null) {
    referenceByFromRef = '';
  }
  const data = {
    name: body.name,
    contact: body.contact || '',
    email: body.email || '',
    phone: body.phone || '',
    address: body.address || '',
    city: body.city || '',
    state: body.state || '',
    pincode: body.pincode || '',
    isActive: body.isActive !== undefined ? body.isActive : true,
  };
  // Per-hospital GST / TDS / invoicePrefix were retired 2026-06-16 — all
  // three are now single platform-wide settings in Site Settings → Invoice
  // Template. Any legacy clients still sending those fields are silently
  // dropped (we just don't write them onto `data`).
  if (referenceId !== undefined) data.referenceId = referenceId;
  if (body.referenceBy !== undefined) data.referenceBy = body.referenceBy || '';
  else if (referenceByFromRef !== undefined) data.referenceBy = referenceByFromRef;
  else data.referenceBy = '';
  return data;
};

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
    const mode = req.body.mode === 'replace' ? 'replace' : 'skip';
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
    const updated = [];
    const skipped = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2;
      const name = String(row.name || '').trim();
      const key = name.toLowerCase();
      const rowErrors = [];
      if (!name) rowErrors.push('Name is required');
      else if (seenInBatch.has(key)) rowErrors.push(`"${name}" is duplicated in the file`);
      const fieldErr = validateHospitalFields({ phone: row.phone, email: row.email, pincode: row.pincode });
      if (fieldErr) rowErrors.push(fieldErr);

      if (rowErrors.length) { errors.push({ row: rowNum, name, errors: rowErrors }); continue; }

      const activeExisting = activeMap.get(key);
      if (activeExisting && mode === 'skip') {
        seenInBatch.add(key);
        skipped.push({ row: rowNum, id: activeExisting.id, name });
        continue;
      }

      try {
        const data = await buildHospitalData({
          name, contact: row.contact, email: row.email, phone: row.phone, address: row.address,
          city: row.city, state: row.state, pincode: row.pincode, referenceBy: row.referenceBy,
        });
        const inactive = inactiveMap.get(key);
        if (activeExisting) {
          const hospital = await prisma.hospital.update({
            where: { id: activeExisting.id },
            data,
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: hospital.id, name: hospital.name });
        } else if (inactive) {
          const hospital = await prisma.hospital.update({
            where: { id: inactive.id },
            data: { ...data, isActive: true },
            select: { id: true, name: true },
          });
          seenInBatch.add(key);
          updated.push({ row: rowNum, id: hospital.id, name: hospital.name });
        } else {
          const hospital = await prisma.hospital.create({ data, select: { id: true, name: true } });
          seenInBatch.add(key);
          created.push({ row: rowNum, id: hospital.id, name: hospital.name });
        }
      } catch (e) {
        errors.push({ row: rowNum, name, errors: [e.message || 'Failed to save'] });
      }
    }
    const successCount = created.length + updated.length;
    res.status(errors.length && !successCount && !skipped.length ? 400 : 200).json({
      message: `Imported ${successCount} of ${rows.length} hospital(s)`,
      created, updated, skipped, errors,
      totalRows: rows.length,
      successCount,
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skipped.length,
      errorCount: errors.length,
      mode,
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
        ...(await buildHospitalData(req.body)),
        billingServices: { create: buildBillingServices(req.body.billingServices) },
        doctors: { create: buildDoctors(req.body.doctors) },
      },
      include: hospitalInclude,
    });
    res.status(201).json(toResponse(hospital));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const { search, active, page, limit = 25, all } = req.query;
    const where = {};

    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const userHospId = req.user.hospitalId || req.user.hospital?.id;
    if (userHospId) {
      where.id = userHospId;
    }

    // Dropdown / "fetch everything" mode — pagination is explicitly
    // bypassed and we serve a minimal payload so the response stays cheap
    // even with hundreds of hospitals.
    if (all === 'true' || all === '1') {
      const hospitals = await prisma.hospital.findMany({
        where,
        select: hospitalDropdownSelect,
        orderBy: { name: 'asc' },
      });
      return res.json(toResponse(hospitals));
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
        ...(await buildHospitalData(req.body)),
        billingServices: { create: buildBillingServices(req.body.billingServices) },
        doctors: { create: buildDoctors(req.body.doctors) },
      },
      include: hospitalInclude,
    });
    res.json(toResponse(hospital));
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ message: error.message });
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

// Bulk soft-delete every active hospital. Hard-delete would break the FK from
// claims/invoices/users that reference hospitals, so this mirrors the
// single-hospital delete (isActive=false) but applied across the board.
exports.deleteAllHospitals = async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE_ALL') {
      return res.status(400).json({ message: 'Confirmation required' });
    }
    const result = await prisma.hospital.updateMany({
      where: { isActive: true },
      data: { isActive: false },
    });
    res.json({ message: `${result.count} hospital(s) deactivated`, count: result.count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
