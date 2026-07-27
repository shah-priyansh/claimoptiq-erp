const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tpaController');
const { protect, checkPermission, checkAnyPermission } = require('../middleware/auth');

router.use(protect);

// GET is used as a lookup (id → name) by the hospital + claim forms, so any
// user who can view/edit those modules must be able to read the list even
// without a dedicated tpa:view permission — otherwise the UI shows raw
// UUIDs in place of TPA names.
router.route('/')
  .get(
    checkAnyPermission([
      ['tpa', 'view'],
      ['hospitals', 'view'],
      ['hospitals', 'edit'],
      ['claims', 'view'],
      ['claims', 'edit'],
    ]),
    ctrl.getAll,
  )
  .post(checkPermission('tpa', 'create'), ctrl.create);

router.post('/import', checkPermission('tpa', 'create'), ctrl.bulkImport);

// Bulk-apply status automation to many TPAs — must be declared before '/:id'
// so it isn't swallowed by the param route.
router.put('/bulk-status-automation', checkPermission('tpa', 'edit'), ctrl.bulkStatusAutomation);

router.route('/:id')
  .put(checkPermission('tpa', 'edit'), ctrl.update)
  .delete(checkPermission('tpa', 'delete'), ctrl.remove);

module.exports = router;
