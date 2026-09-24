// Multer instance dedicated to claim document uploads (POST /claims/:id/documents)
// only — NOT the generic `middleware/upload.js` used by document submissions and
// the site-settings logo upload, which have no claim to file documents under.
//
// Files are saved straight into the FCC filing-tree folder (see
// utils/fccBackupPath.js) instead of a flat uploads/ root, so the local disk
// layout matches what the "Settled Claims Backup" ZIP already presents and
// operators can find a document by browsing Hospital -> Patient -> category
// without going through the app. The path is computed once at upload time and
// never moved afterward, even if the claim is edited later (e.g. a corrected
// patient name) — same "frozen at write time" approach as a paper filing
// cabinet; re-filing on every edit would need a much riskier move-on-edit system.
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const prisma = require('../config/prisma');
const fccPath = require('../utils/fccBackupPath');

const uploadDir = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const claim = await prisma.claim.findUnique({
        where: { id: req.params.id },
        select: {
          claimType: true, isDirectPatient: true, patientName: true, srNo: true,
          hospital: { select: { name: true } },
          insuranceCompany: { select: { name: true } },
          tpa: { select: { name: true } },
        },
      });
      if (!claim) return cb(new Error('Claim not found'));

      // Same field the controller defaults to (req.body.category || 'other').
      // Requires the frontend to append 'category' to FormData BEFORE the
      // file entries — multipart fields only populate req.body in append order.
      const category = req.body.category || 'other';
      const relDir = fccPath.documentFolderPath(claim, category);
      const dirAbs = path.join(uploadDir, ...relDir.split('/'));
      fs.mkdirSync(dirAbs, { recursive: true });
      cb(null, dirAbs);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /pdf|jpg|jpeg|png|gif|webp/;
  const extValid = allowed.test(path.extname(file.originalname).toLowerCase());
  const mimeValid = allowed.test(file.mimetype.split('/')[1]);
  if (extValid || mimeValid) {
    cb(null, true);
  } else {
    cb(new Error('Only PDF and image files are allowed'), false);
  }
};

const claimDocumentUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

module.exports = claimDocumentUpload;
