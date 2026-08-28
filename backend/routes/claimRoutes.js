const express = require('express');
const router = express.Router();
const {
  createClaim, getClaims, getClaim, updateClaim, getClaimProcessByValues,
  uploadDocuments, deleteDocument, streamDocument, getDashboardStats, bulkUpdateStatus, bulkBill, exportClaims, importClaims,
  deleteClaim, deleteAllClaims, fixBilledStatus,
  updateStatusHistory, deleteStatusHistory, downloadSettledBackup,
} = require('../controllers/claimController');
const { protect, checkPermission } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/dashboard', checkPermission('dashboard', 'view'), getDashboardStats);
// Distinct "Claim Process By" values for the self-learning form dropdown + list
// filter. Must be declared before the '/:id' route so it isn't captured as an id.
router.get('/process-by-values', checkPermission('claims', 'view'), getClaimProcessByValues);
router.get('/export', checkPermission('claims', 'export'), exportClaims);
// ZIP of all settled/billed claims' documents, arranged into the FCC filing tree.
// Hit via a browser download link, so `protect` accepts the JWT via ?token=.
router.get('/settled-backup', checkPermission('claims', 'export'), downloadSettledBackup);
router.post('/import', checkPermission('claims', 'create'), importClaims);

router.route('/')
  .get(checkPermission('claims', 'view'), getClaims)
  .post(checkPermission('claims', 'create'), createClaim)
  .delete(checkPermission('claims', 'delete'), deleteAllClaims);

router.put('/bulk-status', checkPermission('claims', 'edit'), bulkUpdateStatus);
router.put('/bulk-bill', checkPermission('claims', 'edit'), bulkBill);
// One-shot admin repair: restores real claim status for claims that were
// incorrectly stamped `status: 'billed'` by the pre-fix invoice.issue flow.
router.post('/fix-billed-status', checkPermission('claims', 'edit'), fixBilledStatus);

router.route('/:id')
  .get(checkPermission('claims', 'view'), getClaim)
  .put(checkPermission('claims', 'edit'), updateClaim)
  .delete(checkPermission('claims', 'delete'), deleteClaim);
// Correct an accidental status change: edit or remove a Status Journey entry.
router.put('/:id/status-history/:historyId', checkPermission('claims', 'edit'), updateStatusHistory);
router.delete('/:id/status-history/:historyId', checkPermission('claims', 'edit'), deleteStatusHistory);
router.post('/:id/documents', checkPermission('claims', 'view'), upload.array('files'), uploadDocuments);
router.get('/:id/documents/:docId/file', checkPermission('claims', 'view'), streamDocument);
router.delete('/:id/documents/:docId', checkPermission('claims', 'delete'), deleteDocument);

module.exports = router;
