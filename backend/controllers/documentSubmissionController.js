const prisma = require('../config/prisma');
const path = require('path');
const fs = require('fs');
const { toResponse } = require('../utils/toResponse');
const { notifyRoles, notifyUser } = require('../utils/createNotifications');

const getUserHospitalId = (user) => {
  if (!user.hospital) return null;
  return user.hospital.id || user.hospital;
};

const submissionInclude = {
  hospital: { select: { id: true, name: true } },
  documentType: { select: { id: true, name: true } },
  uploadedBy: { select: { id: true, name: true } },
  statusChangedBy: { select: { id: true, name: true } },
  claim: { select: { id: true, srNo: true, patientName: true } },
};

exports.create = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'A file is required' });

    const { patientName, documentTypeId, notes } = req.body;
    if (!patientName?.trim()) return res.status(400).json({ message: 'Patient name is required' });

    const hospitalId = getUserHospitalId(req.user) || req.body.hospitalId;
    if (!hospitalId) return res.status(400).json({ message: 'Hospital is required' });

    const submission = await prisma.documentSubmission.create({
      data: {
        hospitalId,
        patientName: patientName.trim(),
        documentTypeId,
        notes: (notes || '').trim(),
        uploadedById: req.user.id,
        fileName: req.file.filename,
        originalName: req.file.originalname,
        filePath: req.file.path,
        fileType: req.file.mimetype,
        fileSize: req.file.size,
      },
      include: submissionInclude,
    });
    // Notify super_admin and fcc_staff about the new upload
    const hospitalName = submission.hospital?.name || 'Unknown Hospital';
    const uploaderName = submission.uploadedBy?.name || req.user.name;
    notifyRoles(
      ['super_admin', 'fcc_staff'],
      `${uploaderName} from ${hospitalName} uploaded a document: "${submission.originalName}" (Patient: ${submission.patientName})`,
      'document_uploaded',
      submission.id,
    ).catch(() => {});

    res.status(201).json(toResponse(submission));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, documentType, hospital, search, page = 1, limit = 25 } = req.query;
    const where = {};

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      where.hospitalId = userHospitalId;
    } else if (hospital) {
      where.hospitalId = hospital;
    }

    if (status) where.status = status;
    if (documentType) where.documentTypeId = documentType;
    if (search) where.patientName = { contains: search, mode: 'insensitive' };

    const skip = (Number(page) - 1) * Number(limit);
    const [submissions, total] = await Promise.all([
      prisma.documentSubmission.findMany({
        where,
        include: submissionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.documentSubmission.count({ where }),
    ]);

    res.json({
      submissions: toResponse(submissions),
      total,
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.download = async (req, res) => {
  try {
    const submission = await prisma.documentSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && submission.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filePath = path.resolve(submission.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${submission.originalName}"`);
    res.setHeader('Content-Type', submission.fileType || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const submission = await prisma.documentSubmission.findUnique({
      where: { id: req.params.id },
      include: submissionInclude,
    });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const updateData = {};
    if (req.body.status !== undefined) {
      updateData.status = req.body.status;
      if (req.body.status !== submission.status) {
        updateData.statusChangedById = req.user.id;
        updateData.statusChangedAt = new Date();
      }
    }
    if (req.body.claim !== undefined) updateData.claimId = req.body.claim || null;
    if (req.body.notes !== undefined) updateData.notes = req.body.notes;

    const updated = await prisma.documentSubmission.update({
      where: { id: req.params.id },
      data: updateData,
      include: submissionInclude,
    });

    // Notify the uploader when status changes
    if (req.body.status !== undefined && req.body.status !== submission.status && submission.uploadedById) {
      const changerName = req.user.name;
      const statusLabel = req.body.status.replace(/_/g, ' ');
      notifyUser(
        submission.uploadedById,
        `"${submission.originalName}" (Patient: ${submission.patientName}) status changed to "${statusLabel}" by ${changerName}`,
        'document_status_changed',
        submission.id,
      ).catch(() => {});
    }

    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const submission = await prisma.documentSubmission.findUnique({ where: { id: req.params.id } });
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && submission.hospitalId !== userHospitalId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (fs.existsSync(submission.filePath)) fs.unlinkSync(submission.filePath);
    await prisma.documentSubmission.delete({ where: { id: req.params.id } });
    res.json({ message: 'Submission deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
