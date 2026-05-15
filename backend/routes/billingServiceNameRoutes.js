const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/billingServiceNameController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('billing_service_names', 'view'), ctrl.getAll)
  .post(checkPermission('billing_service_names', 'create'), ctrl.create);

router.route('/:id')
  .put(checkPermission('billing_service_names', 'edit'), ctrl.update)
  .delete(checkPermission('billing_service_names', 'delete'), ctrl.remove);

module.exports = router;
