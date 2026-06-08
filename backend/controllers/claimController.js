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
    const { hospital, status, claimType, month, dateFrom, dateTo, search, directPatient, page = 1, limit = 25 } = req.query;
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

const CLAIM_TYPES = ['cashless', 'reimbursement', 'grievance'];
const SUBMIT_MODES = ['', 'courier', 'online'];

const parseDate = (val) => {
  if (val === undefined || val === null || val === '') return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

  // Excel serial date number
  if (typeof val === 'number' && val > 25569) {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000));
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(val).trim();
  if (!s) return null;

  // DD/MM/YYYY or DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(`${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

const parseNum = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return val;
  const cleaned = String(val).replace(/[,\s₹$]/g, '').trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return isNaN(n) ? 0 : n;
};

const norm = (s) => String(s || '').trim().toLowerCase();

exports.importClaims = async (req, res) => {
  try {
    const { rows } = req.body;
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: 'rows (non-empty array) is required' });
    }
    if (rows.length > 2000) {
      return res.status(400).json({ message: 'Maximum 2000 rows per import' });
    }

    // Resolve hospital/insurance/TPA by name (case-insensitive). Pre-load lookups once.
    const [hospitals, insurers, tpas, statuses] = await Promise.all([
      prisma.hospital.findMany({ select: { id: true, name: true, isActive: true } }),
      prisma.insuranceCompany.findMany({ select: { id: true, name: true, isActive: true } }),
      prisma.tPA.findMany({ select: { id: true, name: true, isActive: true } }),
      prisma.claimStatus.findMany({ select: { slug: true, superAdminOnly: true } }),
    ]);
    const hospitalMap = new Map(hospitals.map(h => [norm(h.name), h]));
    const insurerMap  = new Map(insurers.map(i => [norm(i.name), i]));
    const tpaMap      = new Map(tpas.map(t => [norm(t.name), t]));
    const statusMap   = new Map(statuses.map(s => [s.slug, s]));

    const userHospitalId = getUserHospitalId(req.user);
    const isSuperAdmin = req.user?.role?.slug === 'super_admin';

    // Pre-compute monthly counters so srNo within each month is sequential
    const monthCounters = new Map();
    const monthKey = (d) => `${d.getFullYear()}-${d.getMonth()}`;

    const created = [];
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] || {};
      const rowNum = i + 2; // assume header row 1 in the source file
      const rowErrors = [];

      // ── Required fields ─────────────────────────────────────────────
      const patientName = String(row.patientName || '').trim();
      if (!patientName) rowErrors.push('Patient Name is required');

      const claimType = norm(row.claimType);
      if (!claimType) rowErrors.push('Claim Type is required');
      else if (!CLAIM_TYPES.includes(claimType)) rowErrors.push(`Claim Type must be one of: ${CLAIM_TYPES.join(', ')}`);

      const dateOfAdmit = parseDate(row.dateOfAdmit);
      if (!dateOfAdmit) rowErrors.push('Date of Admit is required (use YYYY-MM-DD or DD/MM/YYYY)');

      // ── Hospital / Direct Patient ───────────────────────────────────
      let hospitalId = null;
      let isDirectPatient = false;
      const hospitalName = String(row.hospital || '').trim();
      const directFlag = String(row.isDirectPatient || '').trim().toLowerCase();

      if (userHospitalId) {
        hospitalId = userHospitalId;
        isDirectPatient = false;
      } else if (['yes', 'true', '1', 'direct'].includes(directFlag)) {
        isDirectPatient = true;
      } else if (hospitalName) {
        const h = hospitalMap.get(norm(hospitalName));
        if (!h) rowErrors.push(`Hospital "${hospitalName}" not found`);
        else if (!h.isActive) rowErrors.push(`Hospital "${hospitalName}" is inactive`);
        else hospitalId = h.id;
      } else {
        rowErrors.push('Hospital is required (or set "Is Direct Patient" to Yes)');
      }

      // ── Insurance / TPA ─────────────────────────────────────────────
      let insuranceCompanyId = null;
      const insuranceName = String(row.insuranceCompany || '').trim();
      if (insuranceName) {
        const ins = insurerMap.get(norm(insuranceName));
        if (!ins) rowErrors.push(`Insurance Company "${insuranceName}" not found`);
        else if (!ins.isActive) rowErrors.push(`Insurance Company "${insuranceName}" is inactive`);
        else insuranceCompanyId = ins.id;
      }

      let tpaId = null;
      const tpaName = String(row.tpa || '').trim();
      if (tpaName) {
        const tp = tpaMap.get(norm(tpaName));
        if (!tp) rowErrors.push(`TPA "${tpaName}" not found`);
        else if (!tp.isActive) rowErrors.push(`TPA "${tpaName}" is inactive`);
        else tpaId = tp.id;
      }

      // ── Status ──────────────────────────────────────────────────────
      let status = norm(row.status) || 'admitted';
      if (!statusMap.has(status)) {
        rowErrors.push(`Status "${row.status}" is not a valid claim status slug`);
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
      const submitMode = norm(row.submitMode);
      if (submitMode && !['courier', 'online'].includes(submitMode)) {
        rowErrors.push('Submit Mode must be "courier" or "online" (or leave blank)');
      }

      if (rowErrors.length) {
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

        const claim = await prisma.claim.create({
          data: {
            monthClaimNo: nextNo,
            status,
            hospitalId,
            isDirectPatient,
            month: monthVal,
            patientName,
            patientMobile: String(row.patientMobile || '').trim(),
            doctorName: String(row.doctorName || '').trim(),
            claimType,
            insuranceCompanyId,
            tpaId,
            policyNo: String(row.policyNo || '').trim(),
            clientId: String(row.clientId || '').trim(),
            ccnNo: String(row.ccnNo || '').trim(),
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
            courierCompanyName: String(row.courierCompanyName || '').trim(),
            podNumber: String(row.podNumber || '').trim(),
            settlementAmount: parseNum(row.settlementAmount),
            settlementAmountDeduction: parseNum(row.settlementAmountDeduction),
            mouDiscountOnSettlement: parseNum(row.mouDiscountOnSettlement),
            tds: parseNum(row.tds),
            bankTransferAmount: parseNum(row.bankTransferAmount),
            settlementDate,
            neftNo: String(row.neftNo || '').trim(),
            treatmentType: String(row.treatmentType || '').trim(),
            diagnosis: String(row.diagnosis || '').trim(),
            surgeryName: String(row.surgeryName || '').trim(),
            remarks: String(row.remarks || '').trim(),
            rejectedReason: String(row.rejectedReason || '').trim(),
            createdById: req.user.id,
            updatedById: req.user.id,
            statusHistory: {
              create: { status, changedById: req.user.id },
            },
          },
          select: { id: true, patientName: true, srNo: true },
        });
        created.push({ row: rowNum, id: claim.id, srNo: claim.srNo, patientName: claim.patientName });
      } catch (e) {
        errors.push({ row: rowNum, patientName, errors: [e.message || 'Failed to save'] });
      }
    }

    res.status(errors.length && !created.length ? 400 : 200).json({
      message: `Imported ${created.length} of ${rows.length} claim(s)`,
      created,
      errors,
      totalRows: rows.length,
      successCount: created.length,
      errorCount: errors.length,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.exportClaims = async (req, res) => {
  try {
    const { hospital, status, claimType, month, dateFrom, dateTo, search, directPatient } = req.query;
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
