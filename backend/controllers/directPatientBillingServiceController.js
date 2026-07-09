const prisma = require('../config/prisma');
const { toResponse } = require('../utils/toResponse');

// Reused shape for hospital + direct-patient billing services. Copied from
// hospitalController.buildBillingServices — extracting would spread the
// coupling; a small duplicate keeps the intent readable in both places.
const shapeService = (s) => ({
  serviceName: s.serviceName,
  billingType: s.billingType,
  fixedAmount: s.fixedAmount || 0,
  claimLimit: s.claimLimit || 0,
  overLimitBehavior: s.overLimitBehavior || 'per_claim',
  overLimitPerClaimAmount: s.overLimitPerClaimAmount || 0,
  overLimitInsuranceWise: Boolean(s.overLimitInsuranceWise),
  overLimitInsurerIds: Array.isArray(s.overLimitInsurerIds) ? s.overLimitInsurerIds : [],
  overLimitTpaIds: Array.isArray(s.overLimitTpaIds) ? s.overLimitTpaIds : [],
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
});

exports.list = async (req, res) => {
  try {
    const items = await prisma.directPatientBillingService.findMany({
      include: { slabs: { orderBy: { order: 'asc' } } },
      orderBy: { serviceName: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Full replace-all upsert. The frontend edits the whole list in-place then
// PUTs the final state, so a wipe-and-recreate is simpler than diffing —
// exactly how HospitalBillingService is persisted on hospital edit.
exports.replaceAll = async (req, res) => {
  try {
    const services = Array.isArray(req.body.services) ? req.body.services : [];
    for (const s of services) {
      if (!s.serviceName || !String(s.serviceName).trim()) {
        return res.status(400).json({ message: 'Each service needs a service name' });
      }
      if (!s.billingType) {
        return res.status(400).json({ message: `Service "${s.serviceName}": billing type is required` });
      }
    }
    await prisma.$transaction([
      prisma.directPatientBillingService.deleteMany({}),
      ...services.map((s) => prisma.directPatientBillingService.create({ data: shapeService(s) })),
    ]);
    const items = await prisma.directPatientBillingService.findMany({
      include: { slabs: { orderBy: { order: 'asc' } } },
      orderBy: { serviceName: 'asc' },
    });
    res.json(toResponse(items));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
