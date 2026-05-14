const DocumentSubmission = require('../models/DocumentSubmission');
const path = require('path');
const fs = require('fs');

const getUserHospitalId = (user) => {
  if (!user.hospital) return null;
  return user.hospital._id ? user.hospital._id.toString() : user.hospital.toString();
};

exports.create = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'A file is required' });

    const { patientName, documentTypeId, notes } = req.body;
    if (!patientName?.trim()) return res.status(400).json({ message: 'Patient name is required' });
    if (!documentTypeId) return res.status(400).json({ message: 'Document type is required' });

    const hospitalId = getUserHospitalId(req.user) || req.body.hospitalId;
    if (!hospitalId) return res.status(400).json({ message: 'Hospital is required' });

    const submission = await DocumentSubmission.create({
      hospital:     hospitalId,
      patientName:  patientName.trim(),
      documentType: documentTypeId,
      notes:        (notes || '').trim(),
      uploadedBy:   req.user._id,
      file: {
        fileName:     req.file.filename,
        originalName: req.file.originalname,
        filePath:     req.file.path,
        fileType:     req.file.mimetype,
        fileSize:     req.file.size,
      },
    });

    const populated = await DocumentSubmission.findById(submission._id)
      .populate('hospital', 'name')
      .populate('documentType', 'name')
      .populate('uploadedBy', 'name');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const { status, documentType, hospital, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      filter.hospital = userHospitalId;
    } else if (hospital) {
      filter.hospital = hospital;
    }

    if (status) filter.status = status;
    if (documentType) filter.documentType = documentType;
    if (search) filter.patientName = { $regex: search, $options: 'i' };

    const skip = (Number(page) - 1) * Number(limit);
    const [submissions, total] = await Promise.all([
      DocumentSubmission.find(filter)
        .sort('-createdAt')
        .skip(skip)
        .limit(Number(limit))
        .populate('hospital', 'name')
        .populate('documentType', 'name')
        .populate('uploadedBy', 'name')
        .populate('claim', 'srNo patientName'),
      DocumentSubmission.countDocuments(filter),
    ]);

    res.json({ submissions, total, pages: Math.ceil(total / Number(limit)) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.download = async (req, res) => {
  try {
    const submission = await DocumentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && submission.hospital.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const filePath = path.resolve(submission.file.filePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'File not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${submission.file.originalName}"`);
    res.setHeader('Content-Type', submission.file.fileType || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.update = async (req, res) => {
  try {
    const submission = await DocumentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const { status, claim, notes } = req.body;
    if (status !== undefined) submission.status = status;
    if (claim !== undefined) submission.claim = claim || null;
    if (notes !== undefined) submission.notes = notes;

    await submission.save();

    const populated = await DocumentSubmission.findById(submission._id)
      .populate('hospital', 'name')
      .populate('documentType', 'name')
      .populate('uploadedBy', 'name')
      .populate('claim', 'srNo patientName');

    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const submission = await DocumentSubmission.findById(req.params.id);
    if (!submission) return res.status(404).json({ message: 'Submission not found' });

    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && submission.hospital.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (fs.existsSync(submission.file.filePath)) {
      fs.unlinkSync(submission.file.filePath);
    }

    await submission.deleteOne();
    res.json({ message: 'Submission deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
