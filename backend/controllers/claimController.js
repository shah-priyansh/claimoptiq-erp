const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs');
const { toResponse } = require('../utils/toResponse');
const calculateFilePrice = require('../utils/calculateFilePrice');

const getUserHospitalId = (user) => {
  if (!user.hospital) return null;
  return user.hospital.id || user.hospital;
};

const claimInclude = {
  hospital: {
    select: {
      id: true, name: true,
      billingServices: {
        where: { isActive: true },
        include: { slabs: { orderBy: { rangeStart: 'asc' } } },
      },
    },
  },
  insuranceCompany: { select: { id: true, name: true } },
  tpa: { select: { id: true, name: true } },
};

const claimFullInclude = {
  ...claimInclude,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  documents: true,
};

exports.createClaim = async (req, res) => {
  try {
    const userHospitalId = getUserHospitalId(req.user);
    const hospitalId = userHospitalId || req.body.hospital;

    const monthDate = new Date(req.body.month);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthCount = await prisma.claim.count({
      where: { month: { gte: monthStart, lte: monthEnd } },
    });

    const claim = await prisma.claim.create({
      data: {
        monthClaimNo: monthCount + 1,
        status: req.body.status || 'admitted',
        hospitalId,
        month: new Date(req.body.month),
        patientName: req.body.patientName,
        patientMobile: req.body.patientMobile || '',
        doctorName: req.body.doctorName || '',
        claimType: req.body.claimType,
        insuranceCompanyId: req.body.insuranceCompany || null,
        tpaId: req.body.tpa || null,
        policyNo: req.body.policyNo || '',
        clientId: req.body.clientId || '',
        ccnNo: req.body.ccnNo || '',
        dateOfAdmit: new Date(req.body.dateOfAdmit),
        dateOfDischarge: req.body.dateOfDischarge ? new Date(req.body.dateOfDischarge) : null,
        hospitalFinalBill: req.body.hospitalFinalBill || 0,
        mouDiscount: req.body.mouDiscount || 0,
        deduction: req.body.deduction || 0,
        finalApprovalAmount: req.body.finalApprovalAmount || 0,
        finalApprovalDate: req.body.finalApprovalDate ? new Date(req.body.finalApprovalDate) : null,
        fileReceivedDate: req.body.fileReceivedDate ? new Date(req.body.fileReceivedDate) : null,
        submitMode: req.body.submitMode || '',
        courierSubmitDate: req.body.courierSubmitDate ? new Date(req.body.courierSubmitDate) : null,
        onlineSubmitDate: req.body.onlineSubmitDate ? new Date(req.body.onlineSubmitDate) : null,
        courierCompanyName: req.body.courierCompanyName || '',
        podNumber: req.body.podNumber || '',
        settlementAmount: req.body.settlementAmount || 0,
        settlementAmountDeduction: req.body.settlementAmountDeduction || 0,
        mouDiscountOnSettlement: req.body.mouDiscountOnSettlement || 0,
        tds: req.body.tds || 0,
        bankTransferAmount: req.body.bankTransferAmount || 0,
        settlementDate: req.body.settlementDate ? new Date(req.body.settlementDate) : null,
        neftNo: req.body.neftNo || '',
        filePrice: req.body.filePrice || 0,
        treatmentType: req.body.treatmentType || '',
        diagnosis: req.body.diagnosis || '',
        surgeryName: req.body.surgeryName || '',
        remarks: req.body.remarks || '',
        rejectedReason: req.body.rejectedReason || '',
        createdById: req.user.id,
        updatedById: req.user.id,
      },
      include: claimInclude,
    });
    res.status(201).json(toResponse(claim));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getClaims = async (req, res) => {
  try {
    const { hospital, status, claimType, month, dateFrom, dateTo, search, page = 1, limit = 25 } = req.query;
    const where = {};

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      where.hospitalId = userHospitalId;
    } else if (hospital) {
      where.hospitalId = hospital;
    }

    if (status) where.status = status;
    if (claimType) where.claimType = claimType;
    if (month) {
      const d = new Date(month);
      where.month = {
        gte: new Date(d.getFullYear(), d.getMonth(), 1),
        lte: new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999),
      };
    }
    if (!month && (dateFrom || dateTo)) {
      where.month = {};
      if (dateFrom) {
        const d = new Date(dateFrom);
        d.setHours(0, 0, 0, 0);
        where.month.gte = d;
      }
      if (dateTo) {
        const d = new Date(dateTo);
        d.setHours(23, 59, 59, 999);
        where.month.lte = d;
      }
    }
    if (search) {
      where.OR = [
        { patientName: { contains: search, mode: 'insensitive' } },
        { policyNo: { contains: search, mode: 'insensitive' } },
        { ccnNo: { contains: search, mode: 'insensitive' } },
        { clientId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [claims, total] = await Promise.all([
      prisma.claim.findMany({
        where,
        include: claimInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.claim.count({ where }),
    ]);

    const isSuperAdmin = req.user?.role?.slug === 'super_admin';
    const claimsData = toResponse(claims);
    res.json({
      claims: isSuperAdmin ? claimsData : claimsData.map(({ filePrice, isBilled, ...rest }) => rest),
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getClaim = async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({
      where: { id: req.params.id },
      include: claimFullInclude,
    });
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: "You can only view your own hospital's claims" });
    }

    res.json(toResponse(claim));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateClaim = async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: "You can only update your own hospital's claims" });
    }

    // Only super admin can set super-admin-only statuses (e.g. 'billed')
    if (req.body.status) {
      const targetStatus = await prisma.claimStatus.findUnique({ where: { slug: req.body.status } });
      if (targetStatus?.superAdminOnly && req.user?.role?.slug !== 'super_admin') {
        return res.status(403).json({ message: 'You do not have permission to set this status' });
      }
    }

    const data = { updatedById: req.user.id };
    const dateFields = ['dateOfAdmit', 'dateOfDischarge', 'finalApprovalDate', 'fileReceivedDate', 'courierSubmitDate', 'onlineSubmitDate', 'settlementDate', 'month'];
    const allowed = [
      'status', 'patientName', 'patientMobile', 'doctorName', 'claimType',
      'policyNo', 'clientId', 'ccnNo', 'hospitalFinalBill', 'mouDiscount',
      'deduction', 'finalApprovalAmount', 'fileReceivedDate', 'submitMode',
      'courierSubmitDate', 'onlineSubmitDate', 'courierCompanyName', 'podNumber',
      'settlementAmount', 'settlementAmountDeduction', 'mouDiscountOnSettlement',
      'tds', 'bankTransferAmount', 'settlementDate', 'neftNo', 'filePrice', 'filePriceOverridden',
      'treatmentType', 'diagnosis', 'surgeryName',
      'remarks', 'rejectedReason', 'finalApprovalDate', 'dateOfDischarge', 'dateOfAdmit', 'month',
    ];

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        data[key] = dateFields.includes(key)
          ? (req.body[key] ? new Date(req.body[key]) : null)
          : req.body[key];
      }
    }
    if (req.body.insuranceCompany !== undefined) data.insuranceCompanyId = req.body.insuranceCompany || null;
    if (req.body.tpa !== undefined) data.tpaId = req.body.tpa || null;
    if (req.body.hospital) data.hospitalId = req.body.hospital;

    // Auto-set settlementDate when transitioning to settled
    if (data.status === 'settled' && !data.settlementDate && !claim.settlementDate) {
      data.settlementDate = new Date();
    }

    const updated = await prisma.claim.update({
      where: { id: req.params.id },
      data,
      include: claimInclude,
    });
    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.uploadDocuments = async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: "You can only upload to your own hospital's claims" });
    }

    const category = req.body.category || 'other';
    await prisma.claimDocument.createMany({
      data: req.files.map((file) => ({
        claimId: req.params.id,
        fileName: file.filename,
        originalName: file.originalname,
        filePath: file.path,
        fileType: file.mimetype,
        fileSize: file.size,
        category,
      })),
    });

    await prisma.claim.update({ where: { id: req.params.id }, data: { updatedById: req.user.id } });

    const updated = await prisma.claim.findUnique({
      where: { id: req.params.id },
      include: claimFullInclude,
    });
    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteDocument = async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: "You can only manage your own hospital's claims" });
    }

    const doc = await prisma.claimDocument.findFirst({
      where: { id: req.params.docId, claimId: req.params.id },
    });
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    if (fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
    await prisma.claimDocument.delete({ where: { id: req.params.docId } });
    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkUpdateStatus = async (req, res) => {
  try {
    if (req.user?.role?.slug !== 'super_admin') {
      return res.status(403).json({ message: 'Only super admin can bulk-update claim status' });
    }
    const { ids, status } = req.body;
    if (!Array.isArray(ids) || !ids.length || !status) {
      return res.status(400).json({ message: 'ids (array) and status are required' });
    }
    const targetStatus = await prisma.claimStatus.findUnique({ where: { slug: status } });
    if (!targetStatus) return res.status(400).json({ message: 'Invalid status' });
    if (targetStatus.superAdminOnly && req.user?.role?.slug !== 'super_admin') {
      return res.status(403).json({ message: 'You do not have permission to set this status' });
    }
    const { count } = await prisma.claim.updateMany({
      where: { id: { in: ids } },
      data: { status, updatedById: req.user.id },
    });
    res.json({ message: `${count} claims updated to "${status}"`, count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkBill = async (req, res) => {
  try {
    if (req.user?.role?.slug !== 'super_admin') {
      return res.status(403).json({ message: 'Only super admin can mark claims as billed' });
    }
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids (array) is required' });
    }
    const { count } = await prisma.claim.updateMany({
      where: { id: { in: ids } },
      data: { isBilled: true, updatedById: req.user.id },
    });
    res.json({ message: `${count} claims marked as billed`, count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Claim statuses change rarely — cache for 5 minutes to skip a DB round trip on every dashboard load
let _statusCache = null;
let _statusCacheExpiry = 0;
const STATUS_CACHE_TTL = 5 * 60 * 1000;

async function getCachedStatuses() {
  if (_statusCache && Date.now() < _statusCacheExpiry) return _statusCache;
  _statusCache = await prisma.claimStatus.findMany({
    where: { isActive: true, superAdminOnly: false },
    orderBy: { order: 'asc' },
    select: { slug: true, label: true, color: true },
  });
  _statusCacheExpiry = Date.now() + STATUS_CACHE_TTL;
  return _statusCache;
}

exports.invalidateStatusCache = () => { _statusCache = null; };

exports.getDashboardStats = async (req, res) => {
  try {
    const userHospitalId = getUserHospitalId(req.user);
    const baseWhere = userHospitalId ? { hospitalId: userHospitalId } : {};

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    // Single parallel round trip — all independent queries fire at once
    const [
      total,
      statusGroups,
      allStatuses,
      monthlySettledClaims,
      monthlyBilledClaims,
      hospitalCount,
    ] = await Promise.all([
      prisma.claim.count({ where: baseWhere }),
      prisma.claim.groupBy({ by: ['status'], where: baseWhere, _count: { id: true } }),
      getCachedStatuses(),
      prisma.claim.findMany({
        where: {
          ...baseWhere,
          status: 'settled',
          OR: [
            { settlementDate: { gte: monthStart, lte: monthEnd } },
            { settlementDate: null, updatedAt: { gte: monthStart, lte: monthEnd } },
          ],
        },
        select: { bankTransferAmount: true, finalApprovalAmount: true },
      }),
      prisma.claim.findMany({
        where: { ...baseWhere, isBilled: true, createdAt: { gte: monthStart, lte: monthEnd } },
        select: { filePrice: true, filePriceOverridden: true, hospitalFinalBill: true, finalApprovalAmount: true, hospitalId: true },
      }),
      userHospitalId
        ? Promise.resolve(0)
        : prisma.hospital.count({ where: { isActive: true } }),
    ]);

    // Fetch billing services only for unique hospitals that still need calculation
    const hospitalsNeedingCalc = [...new Set(
      monthlyBilledClaims
        .filter(c => !(c.filePriceOverridden && c.filePrice))
        .map(c => c.hospitalId)
        .filter(Boolean)
    )];
    const hospitalBillingMap = {};
    if (hospitalsNeedingCalc.length > 0) {
      const hospitals = await prisma.hospital.findMany({
        where: { id: { in: hospitalsNeedingCalc } },
        select: {
          id: true,
          billingServices: {
            where: { isActive: true },
            include: { slabs: { orderBy: { rangeStart: 'asc' } } },
          },
        },
      });
      hospitals.forEach(h => { hospitalBillingMap[h.id] = h.billingServices; });
    }

    // Compute counts and breakdowns in memory
    const countMap = {};
    statusGroups.forEach(g => { countMap[g.status] = g._count.id; });
    const statusBreakdown = allStatuses.map(s => ({ slug: s.slug, label: s.label, color: s.color, count: countMap[s.slug] || 0 }));

    const settled      = countMap['settled']       || 0;
    const rejected     = countMap['rejected']      || 0;
    const admitted     = countMap['admitted']      || 0;
    const discharged   = countMap['discharged']    || 0;
    const fileReceived = countMap['file_received'] || 0;
    const submitted    = countMap['submitted']     || 0;

    let totalSettlement = 0, totalApprovalAmount = 0;
    for (const c of monthlySettledClaims) {
      totalSettlement    += c.bankTransferAmount  || 0;
      totalApprovalAmount += c.finalApprovalAmount || 0;
    }

    let totalFilePrice = 0;
    for (const c of monthlyBilledClaims) {
      totalFilePrice += c.filePriceOverridden && c.filePrice
        ? c.filePrice
        : calculateFilePrice(hospitalBillingMap[c.hospitalId] || [], c.hospitalFinalBill || 0, c.finalApprovalAmount || 0);
    }

    res.json({
      total,
      inProcess: admitted + discharged + fileReceived + submitted,
      completed: settled,
      rejected,
      admitted,
      discharged,
      fileReceived,
      submitted,
      statusBreakdown,
      hospitalCount,
      isHospitalUser: !!userHospitalId,
      monthlyStats: {
        totalSettlement,
        totalFilePrice,
        totalApprovalAmount,
        count: monthlySettledClaims.length,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
