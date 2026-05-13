const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const ctrl = require('../controllers/claimStatusController');

router.get('/', protect, ctrl.getAll);
router.post('/', protect, checkPermission('claim_statuses', 'create'), ctrl.create);
router.put('/:id', protect, checkPermission('claim_statuses', 'edit'), ctrl.update);
router.delete('/:id', protect, checkPermission('claim_statuses', 'delete'), ctrl.remove);

module.exports = router;
