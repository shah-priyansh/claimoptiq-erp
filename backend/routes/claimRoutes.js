const express = require('express');
const router = express.Router();
const {
  createClaim, getClaims, getClaim, updateClaim,
  uploadDocuments, deleteDocument, streamDocument, getDashboardStats, bulkUpdateStatus, bulkBill, exportClaims, importClaims,
  deleteClaim, deleteAllClaims
} = require('../controllers/claimController');
const { protect, checkPermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/dashboard', checkPermission('dashboard', 'view'), getDashboardStats);
router.get('/export', checkPermission('claims', 'export'), exportClaims);
router.post('/import', checkPermission('claims', 'create'), importClaims);

router.route('/')
  .get(checkPermission('claims', 'view'), getClaims)
  .post(checkPermission('claims', 'create'), createClaim)
  .delete(checkPermission('claims', 'delete'), deleteAllClaims);

router.put('/bulk-status', checkPermission('claims', 'edit'), bulkUpdateStatus);
router.put('/bulk-bill', checkPermission('claims', 'edit'), bulkBill);

router.route('/:id')
  .get(checkPermission('claims', 'view'), getClaim)
  .put(checkPermission('claims', 'edit'), updateClaim)
  .delete(checkPermission('claims', 'delete'), deleteClaim);
router.post('/:id/documents', checkPermission('claims', 'view'), upload.array('files', 50), uploadDocuments);
router.get('/:id/documents/:docId/file', checkPermission('claims', 'view'), streamDocument);
router.delete('/:id/documents/:docId', checkPermission('claims', 'delete'), deleteDocument);

module.exports = router;
