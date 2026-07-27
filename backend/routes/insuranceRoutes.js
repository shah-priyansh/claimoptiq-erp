const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/insuranceController');
const { protect, checkPermission, checkAnyPermission } = require('../middleware/auth');

router.use(protect);

// GET is used as a lookup (id → name) by the hospital + claim forms, so any
// user who can view/edit those modules must be able to read the list even
// without a dedicated insurance:view permission — otherwise the UI shows
// raw UUIDs in place of company names.
router.route('/')
  .get(
    checkAnyPermission([
      ['insurance', 'view'],
      ['hospitals', 'view'],
      ['hospitals', 'edit'],
      ['claims', 'view'],
      ['claims', 'edit'],
    ]),
    ctrl.getAll,
  )
  .post(checkPermission('insurance', 'create'), ctrl.create);

router.post('/import', checkPermission('insurance', 'create'), ctrl.bulkImport);

// Bulk-apply status automation to many companies — must be declared before
// '/:id' so it isn't swallowed by the param route.
router.put('/bulk-status-automation', checkPermission('insurance', 'edit'), ctrl.bulkStatusAutomation);

router.route('/:id')
  .put(checkPermission('insurance', 'edit'), ctrl.update)
  .delete(checkPermission('insurance', 'delete'), ctrl.remove);

module.exports = router;
