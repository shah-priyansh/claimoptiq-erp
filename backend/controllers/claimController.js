const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs');
const { toResponse } = require('../utils/toResponse');
const calculateFilePrice = require('../utils/calculateFilePrice');

const getUserHospitalId = (user) => {
  return user.hospitalId || user.hospital?.id || null;
};

const claimInclude = {
  hospital: {
    select: {
      id: true, name: true, referenceBy: true,
      address: true, phone: true,
      billingServices: {
        where: { isActive: true },
        include: { slabs: { orderBy: { rangeStart: 'asc' } } },
      },
    },
  },
  insuranceCompany: { select: { id: true, name: true, address: true, mobile: true } },
  tpa: { select: { id: true, name: true, address: true, mobile: true } },
};

// Lean include used for list views — drops billingServices/slabs which are only
// needed by super-admins for filePrice calculation, and are stripped from the
// response for everyone else anyway.
const claimListInclude = {
  hospital: {
    select: { id: true, name: true, referenceBy: true, address: true, phone: true },
  },
  insuranceCompany: { select: { id: true, name: true } },
  tpa: { select: { id: true, name: true } },
};

const claimFullInclude = {
  ...claimInclude,
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  documents: true,
  statusHistory: {
    orderBy: { changedAt: 'asc' },
    include: { changedBy: { select: { id: true, name: true } } },
  },
};

exports.createClaim = async (req, res) => {
  try {
    const userHospitalId = getUserHospitalId(req.user);
    const isDirectPatient = !userHospitalId && !!req.body.isDirectPatient;
    const hospitalId = userHospitalId || req.body.hospital || null;

    if (!isDirectPatient && !hospitalId) {
      return res.status(400).json({ message: 'Hospital is required (or mark as Direct Patient)' });
    }

    const monthDate = new Date(req.body.month);
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0, 23, 59, 59, 999);
    const monthCount = await prisma.claim.count({
      where: { month: { gte: monthStart, lte: monthEnd } },
    });

    const initialStatus = req.body.status || 'admitted';
    const claim = await prisma.claim.create({
      data: {
        monthClaimNo: monthCount + 1,
        status: initialStatus,
        hospitalId,
        isDirectPatient,
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
        statusHistory: {
          create: { status: initialStatus, changedById: req.user.id },
        },
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
    const { hospital, status, claimType, month, dateFrom, dateTo, search, directPatient, reference, page = 1, limit = 25, skipCount } = req.query;
    const where = {};

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      where.hospitalId = userHospitalId;
      where.isDirectPatient = false;
    } else if (directPatient === 'true') {
      where.isDirectPatient = true;
      if (hospital) where.hospitalId = hospital;
    } else if (directPatient === 'false') {
      where.isDirectPatient = false;
      if (hospital) where.hospitalId = hospital;
    } else if (hospital) {
      where.hospitalId = hospital;
    }

    // Reference filter — only meaningful for non-hospital users; matches hospital.referenceBy.
    // Combines with any hospitalId filter; excludes direct-patient claims (no hospital relation).
    if (reference && !userHospitalId) {
      where.hospital = { referenceBy: reference };
      where.isDirectPatient = false;
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

    const isSuperAdmin = req.user?.role?.slug === 'super_admin';
    const skipTotal = skipCount === 'true' || skipCount === '1';
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const findManyP = prisma.claim.findMany({
      where,
      include: isSuperAdmin ? claimInclude : claimListInclude,
      orderBy: { createdAt: 'desc' },
      skip,
      take: parseInt(limit),
    });
    const [claims, total] = skipTotal
      ? [await findManyP, null]
      : await Promise.all([findManyP, prisma.claim.count({ where })]);

    const claimsData = toResponse(claims);
    const stripped = isSuperAdmin
      ? claimsData
      : claimsData.map(({ filePrice, isBilled, hospital, ...rest }) => ({
          ...rest,
          hospital: hospital ? (({ referenceBy, ...h }) => h)(hospital) : hospital,
        }));
    res.json({
      claims: stripped,
      total,
      page: parseInt(page),
      pages: total === null ? null : Math.ceil(total / parseInt(limit)),
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
    if (userHospitalId && (claim.hospitalId !== userHospitalId || claim.isDirectPatient)) {
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
    if (userHospitalId && (claim.hospitalId !== userHospitalId || claim.isDirectPatient)) {
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
    if (req.body.isDirectPatient !== undefined) {
      data.isDirectPatient = !!req.body.isDirectPatient;
    }
    if (req.body.hospital !== undefined) {
      data.hospitalId = req.body.hospital || null;
    }

    // Auto-set settlementDate when transitioning to settled
    if (data.status === 'settled' && !data.settlementDate && !claim.settlementDate) {
      data.settlementDate = new Date();
    }

    const statusChanged = data.status && data.status !== claim.status;
    if (statusChanged) {
      data.statusHistory = {
        create: { status: data.status, changedById: req.user.id },
      };
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
    if (userHospitalId && (claim.hospitalId !== userHospitalId || claim.isDirectPatient)) {
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
    if (userHospitalId && (claim.hospitalId !== userHospitalId || claim.isDirectPatient)) {
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

const removeClaimFiles = (filePaths) => {
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  for (const filePath of filePaths) {
    if (!filePath) continue;
    const abs = path.isAbsolute(filePath) ? filePath : path.join(uploadsDir, path.basename(filePath));
    try { if (fs.existsSync(abs)) fs.unlinkSync(abs); } catch { /* ignore */ }
  }
};

exports.deleteClaim = async (req, res) => {
  try {
    const claim = await prisma.claim.findUnique({ where: { id: req.params.id } });
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && (claim.hospitalId !== userHospitalId || claim.isDirectPatient)) {
      return res.status(403).json({ message: "You can only delete your own hospital's claims" });
    }

    const docs = await prisma.claimDocument.findMany({
      where: { claimId: claim.id },
      select: { filePath: true },
    });

    await prisma.$transaction(async (tx) => {
      await tx.documentSubmission.updateMany({ where: { claimId: claim.id }, data: { claimId: null } });
      await tx.notification.deleteMany({ where: { type: 'claim', referenceId: claim.id } });
      await tx.claim.delete({ where: { id: claim.id } });
    });

    removeClaimFiles(docs.map(d => d.filePath));
    res.json({ message: 'Claim deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteAllClaims = async (req, res) => {
  try {
    if (req.body?.confirm !== 'DELETE_ALL') {
      return res.status(400).json({ message: 'Confirmation required' });
    }

    const userHospitalId = getUserHospitalId(req.user);
    const where = {};
    if (userHospitalId) {
      where.hospitalId = userHospitalId;
      where.isDirectPatient = false;
    }

    const isSuperAdmin = req.user?.role?.slug === 'super_admin';

    const targets = await prisma.claim.findMany({ where, select: { id: true } });
    if (targets.length === 0) {
      return res.json({ message: 'No claims to delete', count: 0 });
    }
    const ids = targets.map(t => t.id);

    const docs = await prisma.claimDocument.findMany({
      where: { claimId: { in: ids } },
      select: { filePath: true },
    });

    const result = await prisma.$transaction(async (tx) => {
      await tx.documentSubmission.updateMany({
        where: { claimId: { in: ids } },
        data: { claimId: null },
      });
      await tx.notification.deleteMany({
        where: { type: 'claim', referenceId: { in: ids } },
      });
      const deleted = await tx.claim.deleteMany({ where: { id: { in: ids } } });

      // Reset sr_no autoincrement only on a true full wipe.
      if (isSuperAdmin && !userHospitalId) {
        const remaining = await tx.claim.count();
        if (remaining === 0) {
          await tx.$executeRawUnsafe(
            `SELECT setval(pg_get_serial_sequence('claims', 'sr_no'), 1, false)`
          );
        }
      }
      return deleted.count;
    });

    removeClaimFiles(docs.map(d => d.filePath));
    res.json({ message: `${result} claim(s) deleted`, count: result });
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
    const claimsToUpdate = await prisma.claim.findMany({
      where: { id: { in: ids }, status: { not: status } },
      select: { id: true },
    });
    const { count } = await prisma.claim.updateMany({
      where: { id: { in: ids } },
      data: { status, updatedById: req.user.id },
    });
    if (claimsToUpdate.length > 0) {
      await prisma.claimStatusHistory.createMany({
        data: claimsToUpdate.map(c => ({
          claimId: c.id,
          status,
          changedById: req.user.id,
        })),
      });
    }
    res.json({ message: `${count} claims updated to "${status}"`, count });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── Bulk Import ───────────────────────────────────────────────────────────

const CLAIM_TYPES = ['cashless', 'cashless_anywhere', 'reimbursement', 'grievance'];
const SUBMIT_MODES = ['', 'courier', 'online'];

// Treat placeholders ("-", "—", "N/A", "NA", "null", "0", "0.00") as blank.
// "0" comes up constantly in Excel exports where empty cells were filled with zeros.
// Safe to treat as blank here: only text fields use cleanCell — amounts go through parseNum.
const PLACEHOLDER_RE = /^(-+|—+|n\/a|na|null|none|n\.a\.?|0+(\.0+)?)$/i;
const cleanCell = (val) => {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  if (!s || PLACEHOLDER_RE.test(s)) return '';
  return s;
};

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

const parseDate = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  // Excel serial date number
  if (typeof val === 'number' && val > 25569) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }

  const s = cleanCell(val);
  if (!s) return null;

  // Excel serial date number stored as text (e.g. "44186" or "44186.00")
  if (/^\d{5,}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (n > 25569) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Mon-YY / Mon-YYYY  (e.g. "Dec-20")
  const monMatch = s.match(/^([A-Za-z]{3,9})[\/\-.\s](\d{2,4})$/);
  if (monMatch) {
    const [, monStr, yyyy] = monMatch;
    const mIdx = MONTHS[monStr.slice(0, 3).toLowerCase()];
    if (mIdx !== undefined) {
      const year = yyyy.length === 2 ? 2000 + Number(yyyy) : Number(yyyy);
      return new Date(year, mIdx, 1);
    }
  }

  // DD/MM/YYYY  or  MM/DD/YYYY (auto-detect)
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, a, b, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    let day = Number(a), month = Number(b);
    // Heuristic: if part 1 > 12 → DD/MM; if part 2 > 12 → MM/DD
    if (day > 12 && month <= 12) {
      // DD/MM
    } else if (month > 12 && day <= 12) {
      [day, month] = [month, day]; // swap
    }
    // Reject placeholder/invalid dates (e.g. "1/0/00")
    if (!day || !month || day > 31 || month > 12) return null;
    const d = new Date(Number(yyyy), month - 1, day);
    if (isNaN(d.getTime()) || d.getMonth() !== month - 1) return null;
    return d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const parseNum = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[,\s₹$]/g, '').replace(/^-+$/, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

const norm = (s) => String(s || '').trim().toLowerCase();

// Canonicalise a company / hospital name for tolerant matching:
//   - lowercase
//   - strip punctuation
//   - drop common business suffixes ("limited", "ltd", "co", "company", "private", "pvt", etc.)
// "Care Health Insurance Co. Ltd"  →  "care health insurance"
// "CARE HEALTH INSURANCE LIMITED"  →  "care health insurance"
const STOPWORDS = new Set([
  'ltd', 'limited', 'pvt', 'private', 'co', 'company', 'corp', 'corporation',
  'inc', 'incorporated', 'the', 'and', 'of', '&',
]);
const canonical = (s) => {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[.,()/\-_'"]/g, ' ')
    .split(/\s+/)
    .filter(w => w && !STOPWORDS.has(w))
    .join(' ');
};

// Suggest closest matches by word-overlap; used in import error messages.
const suggestMatches = (input, list, limit = 3) => {
  const target = norm(input);
  if (!target) return [];
  const targetWords = target.split(/\s+/).filter(w => w.length > 2);
  const scored = list.map(item => {
    const name = item.name || '';
    const n = norm(name);
    if (!n) return { name, score: 0 };
    if (n === target) return { name, score: 1000 };
    if (n.includes(target) || target.includes(n)) return { name, score: 500 };
    const overlap = targetWords.filter(w => n.includes(w)).length;
    return { name, score: overlap * 10 };
  });
  return scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.name);
};

exports.importClaims = async (req, res) => {
  try {
    const { rows, autoCreateMasters } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) {
      return res.status(400).json({ message: 'Maximum 2000 rows per import' });
    }
    const isSuperAdminFlag = req.user?.role?.slug === 'super_admin';
    const shouldAutoCreate = !!autoCreateMasters && isSuperAdminFlag;

    // Resolve hospital/insurance/TPA by name (case-insensitive). Pre-load lookups once.
    let [hospitals, insurers, tpas, statuses] = await Promise.all([
      prisma.hospital.findMany({ select: { id: true, name: true, isActive: true, referenceBy: true } }),
      prisma.insuranceCompany.findMany({ select: { id: true, name: true, isActive: true } }),
      prisma.tPA.findMany({ select: { id: true, name: true, isActive: true } }),
      prisma.claimStatus.findMany({ select: { slug: true, superAdminOnly: true } }),
    ]);

    // ── Auto-create missing masters (super-admin opt-in) ───────────────
    const autoCreated = { hospitals: [], insurers: [], tpas: [] };
    if (shouldAutoCreate) {
      const existingHospCanon  = new Set(hospitals.map(h => canonical(h.name)).filter(Boolean));
      const existingInsCanon   = new Set(insurers.map(i  => canonical(i.name)).filter(Boolean));
      const existingTpaCanon   = new Set(tpas.map(t  => canonical(t.name)).filter(Boolean));
      const existingHospNorm   = new Set(hospitals.map(h => norm(h.name)));
      const existingInsNorm    = new Set(insurers.map(i  => norm(i.name)));
      const existingTpaNorm    = new Set(tpas.map(t  => norm(t.name)));

      const newHosp = new Map(); // canonical → original-case name
      const newIns  = new Map();
      const newTpa  = new Map();
      for (const r of rows) {
        const hName = cleanCell(r?.hospital);
        if (hName) {
          const c = canonical(hName);
          if (!existingHospNorm.has(norm(hName)) && (!c || !existingHospCanon.has(c)) && !newHosp.has(c || norm(hName))) {
            newHosp.set(c || norm(hName), hName);
          }
        }
        const iName = cleanCell(r?.insuranceCompany);
        if (iName) {
          const c = canonical(iName);
          if (!existingInsNorm.has(norm(iName)) && (!c || !existingInsCanon.has(c)) && !newIns.has(c || norm(iName))) {
            newIns.set(c || norm(iName), iName);
          }
        }
        const tName = cleanCell(r?.tpa);
        if (tName) {
          const c = canonical(tName);
          if (!existingTpaNorm.has(norm(tName)) && (!c || !existingTpaCanon.has(c)) && !newTpa.has(c || norm(tName))) {
            newTpa.set(c || norm(tName), tName);
          }
        }
      }
      if (newHosp.size) {
        const names = [...newHosp.values()];
        await prisma.hospital.createMany({ data: names.map(name => ({ name })), skipDuplicates: true });
        const created = await prisma.hospital.findMany({
          where: { name: { in: names } },
          select: { id: true, name: true, isActive: true, referenceBy: true },
        });
        hospitals = hospitals.concat(created);
        autoCreated.hospitals = created.map(c => c.name);
      }
      if (newIns.size) {
        const names = [...newIns.values()];
        await prisma.insuranceCompany.createMany({ data: names.map(name => ({ name })), skipDuplicates: true });
        const created = await prisma.insuranceCompany.findMany({
          where: { name: { in: names } },
          select: { id: true, name: true, isActive: true },
        });
        insurers = insurers.concat(created);
        autoCreated.insurers = created.map(c => c.name);
      }
      if (newTpa.size) {
        const names = [...newTpa.values()];
        await prisma.tPA.createMany({ data: names.map(name => ({ name })), skipDuplicates: true });
        const created = await prisma.tPA.findMany({
          where: { name: { in: names } },
          select: { id: true, name: true, isActive: true },
        });
        tpas = tpas.concat(created);
        autoCreated.tpas = created.map(c => c.name);
      }
    }
    const hospitalMap = new Map(hospitals.map(h => [norm(h.name), h]));
    const insurerMap  = new Map(insurers.map(i => [norm(i.name), i]));
    const tpaMap      = new Map(tpas.map(t => [norm(t.name), t]));
    const statusMap   = new Map(statuses.map(s => [s.slug, s]));
    // Canonical fallback maps — only register names whose canonical form is unique.
    const buildCanonicalMap = (list) => {
      const counts = new Map();
      list.forEach(x => {
        const c = canonical(x.name);
        if (c) counts.set(c, (counts.get(c) || 0) + 1);
      });
      const map = new Map();
      list.forEach(x => {
        const c = canonical(x.name);
        if (c && counts.get(c) === 1) map.set(c, x);
      });
      return map;
    };
    const hospitalCanonMap = buildCanonicalMap(hospitals);
    const insurerCanonMap  = buildCanonicalMap(insurers);
    const tpaCanonMap      = buildCanonicalMap(tpas);

    // ── Pre-fetch existing claims that could collide with the incoming rows,
    //    so we can skip duplicates (re-upload of the same file).
    const incomingCcns = [...new Set(
      rows.map(r => cleanCell(r?.ccnNo)).filter(Boolean)
    )];
    const incomingPatientNames = [...new Set(
      rows.map(r => cleanCell(r?.patientName)).filter(Boolean)
    )];
    const existingClaims = (incomingCcns.length || incomingPatientNames.length)
      ? await prisma.claim.findMany({
          where: {
            OR: [
              ...(incomingCcns.length         ? [{ ccnNo:       { in: incomingCcns } }]         : []),
              ...(incomingPatientNames.length ? [{ patientName: { in: incomingPatientNames } }] : []),
            ],
          },
          select: { ccnNo: true, patientName: true, hospitalId: true, dateOfAdmit: true },
        })
      : [];
    const dateKey = (d) => d ? new Date(d).toISOString().slice(0, 10) : '';
    const dbCcnKeys       = new Set();
    const dbCompositeKeys = new Set();
    existingClaims.forEach(c => {
      const ccn = (c.ccnNo || '').trim().toLowerCase();
      if (ccn) dbCcnKeys.add(ccn);
      dbCompositeKeys.add(`${norm(c.patientName)}|${c.hospitalId || ''}|${dateKey(c.dateOfAdmit)}`);
    });
    // Track keys we create within this very batch so a file with duplicates inside it also dedups.
    const batchCcnKeys       = new Set();
    const batchCompositeKeys = new Set();
    let duplicateCount = 0;

    // Track which inputs were resolved via canonical fallback so we can report them to the client.
    const fuzzyResolutions = { hospitals: new Map(), insurers: new Map(), tpas: new Map() };
    const lookupFuzzy = (input, exactMap, canonMap, bucket) => {
      const exact = exactMap.get(norm(input));
      if (exact) return exact;
      const c = canonical(input);
      const match = c && canonMap.get(c);
      if (match) {
        if (!fuzzyResolutions[bucket].has(input)) {
          fuzzyResolutions[bucket].set(input, match.name);
        }
        return match;
      }
      return null;
    };

    const userHospitalId = getUserHospitalId(req.user);
    const isSuperAdmin = isSuperAdminFlag;

    // Pre-compute monthly counters so srNo within each month is sequential
    const monthCounters = new Map();
    const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

    const created = [];
    const errors = [];
    // Hospitals whose blank `referenceBy` should be back-filled from the import.
    // Persisted in a single batch after the row loop so old hospitals adopt the
    // row's value the first time it's seen, and subsequent rows for the same
    // hospital validate against it (rather than each row tripping the mismatch).
    const pendingHospitalReferenceBy = new Map();

    // Soft-deleted masters referenced by claim rows are reactivated automatically
    // (the UI hides inactive masters, so users have no other path to revive them).
    const reactivateHospitalIds = new Set();
    const reactivateInsurerIds  = new Set();
    const reactivateTpaIds      = new Set();
    const reactivated = { hospitals: [], insurers: [], tpas: [] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2; // assume header row 1 in the source file
      const rowErrors = [];

      // ── Required fields ─────────────────────────────────────────────
      const patientName = cleanCell(row.patientName);
      if (!patientName) rowErrors.push('Patient Name is required');

      const claimType = norm(cleanCell(row.claimType)).replace(/\s+/g, '_');
      if (!claimType) rowErrors.push('Claim Type is required');
      else if (!CLAIM_TYPES.includes(claimType)) rowErrors.push(`Claim Type "${row.claimType}" is invalid — must be one of: ${CLAIM_TYPES.join(', ')}`);

      const dateOfAdmit = parseDate(row.dateOfAdmit);
      if (!dateOfAdmit) rowErrors.push(`Date of Admit "${row.dateOfAdmit || ''}" could not be parsed — use YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY`);

      // ── Hospital / Direct Patient ───────────────────────────────────
      let hospitalId = null;
      let isDirectPatient = false;
      const hospitalName = cleanCell(row.hospital);
      const directFlag = cleanCell(row.isDirectPatient).toLowerCase();
      const referenceByInput = cleanCell(row.referenceBy);

      if (userHospitalId) {
        hospitalId = userHospitalId;
        isDirectPatient = false;
      } else if (['yes', 'true', '1', 'direct'].includes(directFlag)) {
        isDirectPatient = true;
      } else if (hospitalName) {
        const h = lookupFuzzy(hospitalName, hospitalMap, hospitalCanonMap, 'hospitals');
        if (!h) {
          const sugg = suggestMatches(hospitalName, hospitals);
          rowErrors.push(`Hospital "${hospitalName}" not found${sugg.length ? `. Did you mean: ${sugg.map(s => `"${s}"`).join(', ')}?` : ''}`);
        } else {
          if (!h.isActive) {
            if (!reactivateHospitalIds.has(h.id)) {
              reactivateHospitalIds.add(h.id);
              reactivated.hospitals.push(h.name);
            }
            h.isActive = true;
          }
          hospitalId = h.id;
          if (referenceByInput) {
            const existingRef = norm(h.referenceBy);
            if (!existingRef) {
              // Hospital has no reference set yet — adopt the row's value as the
              // canonical reference, both in-memory (so subsequent rows for the
              // same hospital validate against it) and queued for a single DB
              // update after the loop.
              h.referenceBy = referenceByInput;
              pendingHospitalReferenceBy.set(h.id, referenceByInput);
            } else if (existingRef !== norm(referenceByInput)) {
              rowErrors.push(`Reference By "${referenceByInput}" does not match hospital "${hospitalName}" (expected "${h.referenceBy}")`);
            }
          }
        }
      } else {
        rowErrors.push('Hospital is required (or set "Is Direct Patient" to Yes)');
      }

      // ── Insurance / TPA ─────────────────────────────────────────────
      let insuranceCompanyId = null;
      const insuranceName = cleanCell(row.insuranceCompany);
      if (insuranceName) {
        const ins = lookupFuzzy(insuranceName, insurerMap, insurerCanonMap, 'insurers');
        if (!ins) {
          const sugg = suggestMatches(insuranceName, insurers);
          rowErrors.push(`Insurance Company "${insuranceName}" not found${sugg.length ? `. Did you mean: ${sugg.map(s => `"${s}"`).join(', ')}?` : ' — add it under Masters → Insurance Companies first.'}`);
        } else {
          if (!ins.isActive) {
            if (!reactivateInsurerIds.has(ins.id)) {
              reactivateInsurerIds.add(ins.id);
              reactivated.insurers.push(ins.name);
            }
            ins.isActive = true;
          }
          insuranceCompanyId = ins.id;
        }
      }

      let tpaId = null;
      const tpaName = cleanCell(row.tpa);
      if (tpaName) {
        const tp = lookupFuzzy(tpaName, tpaMap, tpaCanonMap, 'tpas');
        if (!tp) {
          const sugg = suggestMatches(tpaName, tpas);
          rowErrors.push(`TPA "${tpaName}" not found${sugg.length ? `. Did you mean: ${sugg.map(s => `"${s}"`).join(', ')}?` : ' — add it under Masters → TPAs first.'}`);
        } else {
          if (!tp.isActive) {
            if (!reactivateTpaIds.has(tp.id)) {
              reactivateTpaIds.add(tp.id);
              reactivated.tpas.push(tp.name);
            }
            tp.isActive = true;
          }
          tpaId = tp.id;
        }
      }

      // ── Status ──────────────────────────────────────────────────────
      const statusInput = cleanCell(row.status);
      let status = norm(statusInput) || 'admitted';
      if (!statusMap.has(status)) {
        rowErrors.push(`Status "${statusInput}" is not a valid claim status slug — see the Statuses sheet for valid values.`);
      } else if (statusMap.get(status).superAdminOnly && !isSuperAdmin) {
        rowErrors.push(`Status "${status}" can only be set by super admin`);
      }

      // ── Dates ───────────────────────────────────────────────────────
      const dateOfDischarge   = parseDate(row.dateOfDischarge);
      const finalApprovalDate = parseDate(row.finalApprovalDate);
      const fileReceivedDate  = parseDate(row.fileReceivedDate);
      const courierSubmitDate = parseDate(row.courierSubmitDate);
      const onlineSubmitDate  = parseDate(row.onlineSubmitDate);
      const settlementDate    = parseDate(row.settlementDate);
      const monthVal          = parseDate(row.month) || dateOfAdmit;

      // ── Submit mode ─────────────────────────────────────────────────
      const submitMode = norm(cleanCell(row.submitMode));
      if (submitMode && !['courier', 'online'].includes(submitMode)) {
        rowErrors.push(`Submit Mode "${row.submitMode}" is invalid — must be "courier" or "online" (or leave blank)`);
      }

      // ── Duplicate detection ─────────────────────────────────────────
      //   Match if (a) same CCN already exists, or
      //   (b) same patient + hospital + date-of-admit already exists.
      const ccnVal       = cleanCell(row.ccnNo);
      const ccnKey       = ccnVal ? ccnVal.toLowerCase() : null;
      const compositeKey = patientName && dateOfAdmit
        ? `${norm(patientName)}|${hospitalId || ''}|${dateKey(dateOfAdmit)}`
        : null;
      let isDuplicate = false;
      if (ccnKey && (dbCcnKeys.has(ccnKey) || batchCcnKeys.has(ccnKey))) {
        rowErrors.push(`Duplicate — a claim with CCN "${ccnVal}" already exists; skipped`);
        isDuplicate = true;
      } else if (compositeKey && (dbCompositeKeys.has(compositeKey) || batchCompositeKeys.has(compositeKey))) {
        rowErrors.push(`Duplicate — "${patientName}" was already imported for this hospital + admit date; skipped`);
        isDuplicate = true;
      }

      if (rowErrors.length) {
        if (isDuplicate) duplicateCount += 1;
        errors.push({ row: rowNum, patientName, errors: rowErrors });
        continue;
      }

      try {
        const mk = monthKey(monthVal);
        if (!monthCounters.has(mk)) {
          const monthStart = new Date(monthVal.getFullYear(), monthVal.getMonth(), 1);
          const monthEnd   = new Date(monthVal.getFullYear(), monthVal.getMonth() + 1, 0, 23, 59, 59, 999);
          const existing = await prisma.claim.count({ where: { month: { gte: monthStart, lte: monthEnd } } });
          monthCounters.set(mk, existing);
        }
        const nextNo = monthCounters.get(mk) + 1;
        monthCounters.set(mk, nextNo);

        const filePriceVal = isSuperAdmin ? parseNum(row.filePrice) : 0;

        const claim = await prisma.claim.create({
          data: {
            monthClaimNo: nextNo,
            status,
            hospitalId,
            isDirectPatient,
            month: monthVal,
            patientName,
            patientMobile: cleanCell(row.patientMobile),
            doctorName: cleanCell(row.doctorName),
            claimType,
            insuranceCompanyId,
            tpaId,
            policyNo: cleanCell(row.policyNo),
            clientId: cleanCell(row.clientId),
            ccnNo: cleanCell(row.ccnNo),
            dateOfAdmit,
            dateOfDischarge,
            hospitalFinalBill: parseNum(row.hospitalFinalBill),
            mouDiscount: parseNum(row.mouDiscount),
            deduction: parseNum(row.deduction),
            finalApprovalAmount: parseNum(row.finalApprovalAmount),
            finalApprovalDate,
            fileReceivedDate,
            submitMode,
            courierSubmitDate,
            onlineSubmitDate,
            courierCompanyName: cleanCell(row.courierCompanyName),
            podNumber: cleanCell(row.podNumber),
            settlementAmount: parseNum(row.settlementAmount),
            settlementAmountDeduction: parseNum(row.settlementAmountDeduction),
            mouDiscountOnSettlement: parseNum(row.mouDiscountOnSettlement),
            tds: parseNum(row.tds),
            bankTransferAmount: parseNum(row.bankTransferAmount),
            settlementDate,
            neftNo: cleanCell(row.neftNo),
            treatmentType: cleanCell(row.treatmentType),
            diagnosis: cleanCell(row.diagnosis),
            surgeryName: cleanCell(row.surgeryName),
            remarks: cleanCell(row.remarks),
            rejectedReason: cleanCell(row.rejectedReason),
            filePrice: filePriceVal,
            filePriceOverridden: filePriceVal > 0,
            createdById: req.user.id,
            updatedById: req.user.id,
            statusHistory: {
              create: { status, changedById: req.user.id },
            },
          },
          select: { id: true, patientName: true, srNo: true },
        });
        created.push({ row: rowNum, id: claim.id, srNo: claim.srNo, patientName: claim.patientName });
        if (ccnKey)       batchCcnKeys.add(ccnKey);
        if (compositeKey) batchCompositeKeys.add(compositeKey);
      } catch (e) {
        errors.push({ row: rowNum, patientName, errors: [e.message || 'Failed to save'] });
      }
    }

    if (pendingHospitalReferenceBy.size) {
      await Promise.all(
        [...pendingHospitalReferenceBy.entries()].map(([id, referenceBy]) =>
          prisma.hospital.update({ where: { id }, data: { referenceBy } }),
        ),
      );
    }

    if (reactivateHospitalIds.size) {
      await prisma.hospital.updateMany({ where: { id: { in: [...reactivateHospitalIds] } }, data: { isActive: true } });
    }
    if (reactivateInsurerIds.size) {
      await prisma.insuranceCompany.updateMany({ where: { id: { in: [...reactivateInsurerIds] } }, data: { isActive: true } });
    }
    if (reactivateTpaIds.size) {
      await prisma.tPA.updateMany({ where: { id: { in: [...reactivateTpaIds] } }, data: { isActive: true } });
    }

    const fuzzy = {
      hospitals: [...fuzzyResolutions.hospitals.entries()].map(([from, to]) => ({ from, to })),
      insurers:  [...fuzzyResolutions.insurers.entries()].map(([from, to]) => ({ from, to })),
      tpas:      [...fuzzyResolutions.tpas.entries()].map(([from, to]) => ({ from, to })),
    };

    // Always 200 — per-row errors are reported in the body. Returning 4xx for
    // an all-error batch makes the frontend abort the import loop, so a single
    // bad batch (e.g. one made entirely of duplicates) would stop the remaining
    // batches from uploading. 5xx is still reserved for real server failures
    // (handled by the outer catch).
    res.status(200).json({
      message: `Imported ${created.length} of ${rows.length} claim(s)${duplicateCount ? ` (${duplicateCount} duplicate(s) skipped)` : ''}`,
      created,
      errors,
      fuzzyMatches: fuzzy,
      autoCreated,
      reactivated,
      totalRows: rows.length,
      successCount: created.length,
      errorCount: errors.length,
      duplicateCount,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.exportClaims = async (req, res) => {
  try {
    const { hospital, status, claimType, month, dateFrom, dateTo, search, directPatient, reference } = req.query;
    const where = {};

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      where.hospitalId = userHospitalId;
      where.isDirectPatient = false;
    } else if (directPatient === 'true') {
      where.isDirectPatient = true;
      if (hospital) where.hospitalId = hospital;
    } else if (directPatient === 'false') {
      where.isDirectPatient = false;
      if (hospital) where.hospitalId = hospital;
    } else if (hospital) {
      where.hospitalId = hospital;
    }

    if (reference && !userHospitalId) {
      where.hospital = { referenceBy: reference };
      where.isDirectPatient = false;
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

    const claims = await prisma.claim.findMany({
      where,
      include: claimInclude,
      orderBy: { createdAt: 'desc' },
    });

    const isSuperAdmin = req.user?.role?.slug === 'super_admin';
    const claimsData = toResponse(claims);
    const stripped = isSuperAdmin
      ? claimsData
      : claimsData.map(({ filePrice, isBilled, hospital, ...rest }) => ({
          ...rest,
          hospital: hospital ? (({ referenceBy, ...h }) => h)(hospital) : hospital,
        }));
    res.json(stripped);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.bulkBill = async (req, res) => {
  try {
    if (req.user?.role?.slug !== 'super_admin') {
      return res.status(403).json({ message: 'Only super admin can change bill status' });
    }
    const { ids, isBilled = true } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ message: 'ids (array) is required' });
    }
    const targetIsBilled = !!isBilled;
    const { count } = await prisma.claim.updateMany({
      where: { id: { in: ids } },
      data: { isBilled: targetIsBilled, updatedById: req.user.id },
    });
    const label = targetIsBilled ? 'billed' : 'unbilled';
    res.json({ message: `${count} claims marked as ${label}`, count });
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
    const baseWhere = userHospitalId ? { hospitalId: userHospitalId, isDirectPatient: false } : {};

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
      // Use the claim's `month` field (the business month assigned on the form),
      // not settlementDate/createdAt, so a claim tagged "June" shows up in June's stats
      // regardless of when it was actually settled or created.
      prisma.claim.findMany({
        where: {
          ...baseWhere,
          status: 'settled',
          month: { gte: monthStart, lte: monthEnd },
        },
        select: { bankTransferAmount: true, finalApprovalAmount: true },
      }),
      prisma.claim.findMany({
        where: { ...baseWhere, isBilled: true, month: { gte: monthStart, lte: monthEnd } },
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
