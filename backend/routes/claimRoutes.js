const express = require('express');
const router = express.Router();
const {
  createClaim, getClaims, getClaim, updateClaim,
  uploadDocuments, deleteDocument, getDashboardStats
} = require('../controllers/claimController');
const { protect, checkPermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/dashboard', checkPermission('dashboard', 'view'), getDashboardStats);

router.route('/')
  .get(checkPermission('claims', 'view'), getClaims)
  .post(checkPermission('claims', 'create'), createClaim);

router.route('/:id')
  .get(checkPermission('claims', 'view'), getClaim)
  .put(checkPermission('claims', 'edit'), updateClaim);

router.post('/:id/documents', checkPermission('claims', 'view'), upload.array('files', 10), uploadDocuments);
router.delete('/:id/documents/:docId', checkPermission('claims', 'delete'), deleteDocument);

module.exports = router;
