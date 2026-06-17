const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

const pickFields = (body) => {
  const data = {};
  if (body.name !== undefined) data.name = String(body.name).trim();
  if (body.mobile !== undefined) data.mobile = String(body.mobile || '').trim();
  if (body.address !== undefined) data.address = String(body.address || '').trim();
  if (body.commissionRate !== undefined) {
    const n = Number(body.commissionRate);
    data.commissionRate = Number.isFinite(n) && n >= 0 ? n : 0;
  }
  if (body.isActive !== undefined) data.isActive = !!body.isActive;
  return data;
};

const referenceInclude = {
  applicableServices: {
    include: { billingServiceName: { select: { id: true, name: true } } },
  },
};

const VALID_COMMISSION_TYPES = new Set(['percentage', 'fixed', 'per_claim', 'one_time']);

// Normalise the operator-supplied per-service commission rows. Accepts the
// new `applicableServices` shape ([{billingServiceNameId, commissionType,
// commissionValue}]) and the legacy `applicableServiceIds` array (treated as
// commissionType=percentage, commissionValue=parentCommissionRate so old
// clients don't lose behaviour). Dedupes by billingServiceNameId.
const buildApplicableServicesCreate = (body) => {
  const rows = [];
  const seen = new Set();
  const fallbackRate = Number(body.commissionRate) || 0;
  if (Array.isArray(body.applicableServices)) {
    for (const r of body.applicableServices) {
      const id = r?.billingServiceNameId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const type = VALID_COMMISSION_TYPES.has(r.commissionType) ? r.commissionType : 'percentage';
      const value = Math.max(0, Number(r.commissionValue) || 0);
      rows.push({ billingServiceNameId: id, commissionType: type, commissionValue: value });
    }
  } else if (Array.isArray(body.applicableServiceIds)) {
    for (const id of body.applicableServiceIds) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      rows.push({ billingServiceNameId: id, commissionType: 'percentage', commissionValue: fallbackRate });
    }
  }
  return rows;
};

const willReplaceApplicableServices = (body) =>
  Array.isArray(body.applicableServices) || Array.isArray(body.applicableServiceIds);

exports.create = async (req, res) => {
  try {
    const data = pickFields(req.body);
    if (!data.name) return res.status(400).json({ message: 'Name is required' });
    const item = await prisma.reference.create({
      data: {
        ...data,
        applicableServices: { create: buildApplicableServicesCreate(req.body) },
      },
      include: referenceInclude,
    });
    res.status(201).json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { search, active } = req.query;
    const where = {};
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: search, mode: 'insensitive' };
    const items = await prisma.reference.findMany({
      where,
      include: referenceInclude,
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getOne = async (req, res) => {
  try {
    const item = await prisma.reference.findUnique({
      where: { id: req.params.id },
      include: referenceInclude,
    });
    if (!item) return res.status(404).json({ message: 'Not found' });
    res.json(toResponse(item));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const id = req.params.id;
    const existing = await prisma.reference.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Not found' });

    const data = pickFields(req.body);
    const willReplaceServices = willReplaceApplicableServices(req.body);

    const item = await prisma.$transaction(async (tx) => {
      if (willReplaceServices) {
        await tx.referenceApplicableService.deleteMany({ where: { referenceId: id } });
      }
      return tx.reference.update({
        where: { id },
        data: {
          ...data,
          ...(willReplaceServices
            ? { applicableServices: { create: buildApplicableServicesCreate(req.body) } }
            : {}),
        },
        include: referenceInclude,
      });
    });

    res.json(toResponse(item));
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const id = req.params.id;
    const linked = await prisma.hospital.count({ where: { referenceId: id } });
    if (linked > 0) {
      await prisma.reference.update({ where: { id }, data: { isActive: false } });
      return res.json({ message: `Deactivated (still linked to ${linked} hospital${linked === 1 ? '' : 's'})` });
    }
    await prisma.reference.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getHospitals = async (req, res) => {
  try {
    const hospitals = await prisma.hospital.findMany({
      where: { referenceId: req.params.id },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    res.json(toResponse(hospitals));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
