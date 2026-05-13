const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const ctrl = require('../controllers/claimDocumentTypeController');

router.get('/', protect, ctrl.getAll);
router.post('/', protect, checkPermission('claim_document_types', 'create'), ctrl.create);
router.put('/:id', protect, checkPermission('claim_document_types', 'edit'), ctrl.update);
router.delete('/:id', protect, checkPermission('claim_document_types', 'delete'), ctrl.remove);

module.exports = router;
