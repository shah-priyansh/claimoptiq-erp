const Claim = require('../models/Claim');
const path = require('path');
const fs = require('fs');

// Helper: get hospital ID if user is linked to a hospital
const getUserHospitalId = (user) => {
  if (!user.hospital) return null;
  return user.hospital._id ? user.hospital._id.toString() : user.hospital.toString();
};

// Create new claim (Patient Admit)
exports.createClaim = async (req, res) => {
  try {
    const claimData = { ...req.body, createdBy: req.user._id, updatedBy: req.user._id };

    // If user is linked to a hospital, force their hospital
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      claimData.hospital = userHospitalId;
    }

    const claim = await Claim.create(claimData);
    const populated = await Claim.findById(claim._id)
      .populate('hospital', 'name')
      .populate('insuranceCompany', 'name')
      .populate('tpa', 'name');

    res.status(201).json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get all claims with filters
exports.getClaims = async (req, res) => {
  try {
    const { hospital, status, claimType, month, search, page = 1, limit = 20 } = req.query;
    const filter = {};

    // Hospital-linked users can only see their own hospital's claims
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      filter.hospital = userHospitalId;
    } else if (hospital) {
      filter.hospital = hospital;
    }

    if (status) filter.status = status;
    if (claimType) filter.claimType = claimType;
    if (month) {
      const d = new Date(month);
      filter.month = {
        $gte: new Date(d.getFullYear(), d.getMonth(), 1),
        $lte: new Date(d.getFullYear(), d.getMonth() + 1, 0)
      };
    }
    if (search) {
      filter.$or = [
        { patientName: { $regex: search, $options: 'i' } },
        { policyNo: { $regex: search, $options: 'i' } },
        { ccnNo: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [claims, total] = await Promise.all([
      Claim.find(filter)
        .populate('hospital', 'name')
        .populate('insuranceCompany', 'name')
        .populate('tpa', 'name')
        .sort('-createdAt')
        .skip(skip)
        .limit(parseInt(limit)),
      Claim.countDocuments(filter)
    ]);

    res.json({
      claims,
      total,
      page: parseInt(page),
      pages: Math.ceil(total / parseInt(limit))
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get single claim
exports.getClaim = async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id)
      .populate('hospital', 'name')
      .populate('insuranceCompany', 'name')
      .populate('tpa', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name');

    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    // Hospital-linked users can only view their own hospital's claims
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospital._id.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'You can only view your own hospital\'s claims' });
    }

    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update claim (Discharge / File Receive / Settlement)
exports.updateClaim = async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    // Hospital-linked users can only update their own hospital's claims
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospital.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'You can only update your own hospital\'s claims' });
    }

    const updateData = { ...req.body, updatedBy: req.user._id };
    const updated = await Claim.findByIdAndUpdate(req.params.id, updateData, {
      new: true,
      runValidators: true
    })
      .populate('hospital', 'name')
      .populate('insuranceCompany', 'name')
      .populate('tpa', 'name');

    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Upload documents to a claim
exports.uploadDocuments = async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    // Hospital-linked users can only upload to their own hospital's claims
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospital.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'You can only upload to your own hospital\'s claims' });
    }

    const category = req.body.category || 'other';
    const newDocs = req.files.map(file => ({
      fileName: file.filename,
      originalName: file.originalname,
      filePath: file.path,
      fileType: file.mimetype,
      fileSize: file.size,
      category
    }));

    claim.documents.push(...newDocs);
    claim.updatedBy = req.user._id;
    await claim.save();

    res.json(claim);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete a document from a claim
exports.deleteDocument = async (req, res) => {
  try {
    const claim = await Claim.findById(req.params.id);
    if (!claim) return res.status(404).json({ message: 'Claim not found' });

    // Hospital-linked users can only delete from their own hospital's claims
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId && claim.hospital.toString() !== userHospitalId) {
      return res.status(403).json({ message: 'You can only manage your own hospital\'s claims' });
    }

    const doc = claim.documents.id(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    // Delete file from disk
    if (fs.existsSync(doc.filePath)) {
      fs.unlinkSync(doc.filePath);
    }

    claim.documents.pull(req.params.docId);
    await claim.save();

    res.json({ message: 'Document deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Dashboard stats
exports.getDashboardStats = async (req, res) => {
  try {
    const filter = {};
    const userHospitalId = getUserHospitalId(req.user);
    if (userHospitalId) {
      filter.hospital = userHospitalId;
    }

    const [total, admitted, discharged, fileReceived, submitted, settled, rejected] = await Promise.all([
      Claim.countDocuments(filter),
      Claim.countDocuments({ ...filter, status: 'admitted' }),
      Claim.countDocuments({ ...filter, status: 'discharged' }),
      Claim.countDocuments({ ...filter, status: 'file_received' }),
      Claim.countDocuments({ ...filter, status: 'submitted' }),
      Claim.countDocuments({ ...filter, status: 'settled' }),
      Claim.countDocuments({ ...filter, status: 'rejected' })
    ]);

    const inProcess = admitted + discharged + fileReceived + submitted;

    // Monthly revenue (settled claims this month)
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const monthlySettled = await Claim.aggregate([
      {
        $match: {
          ...filter,
          status: 'settled',
          settlementDate: { $gte: monthStart, $lte: monthEnd }
        }
      },
      {
        $group: {
          _id: null,
          totalSettlement: { $sum: '$bankTransferAmount' },
          totalFilePrice: { $sum: '$filePrice' },
          count: { $sum: 1 }
        }
      }
    ]);

    // Hospital count — only for non-hospital users
    let hospitalCount = 0;
    if (!userHospitalId) {
      const Hospital = require('../models/Hospital');
      hospitalCount = await Hospital.countDocuments({ isActive: true });
    }

    res.json({
      total,
      inProcess,
      completed: settled,
      rejected,
      admitted,
      discharged,
      fileReceived,
      submitted,
      hospitalCount,
      isHospitalUser: !!userHospitalId,
      monthlyStats: monthlySettled[0] || { totalSettlement: 0, totalFilePrice: 0, count: 0 }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
