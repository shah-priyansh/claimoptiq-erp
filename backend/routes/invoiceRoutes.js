const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/invoiceController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.post('/preview', checkPermission('invoices', 'view'), ctrl.preview);

router.route('/')
  .get(checkPermission('invoices', 'view'), ctrl.list)
  .post(checkPermission('invoices', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('invoices', 'view'), ctrl.getOne)
  .patch(checkPermission('invoices', 'edit'), ctrl.update)
  .delete(checkPermission('invoices', 'delete'), ctrl.remove);

router.post('/:id/issue', checkPermission('invoices', 'edit'), ctrl.issue);
router.post('/:id/void', checkPermission('invoices', 'edit'), ctrl.void);
router.get('/:id/pdf', checkPermission('invoices', 'view'), ctrl.pdf);

module.exports = router;
