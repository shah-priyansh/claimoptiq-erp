const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tdsRateController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('tds_rates', 'view'), ctrl.getAll)
  .post(checkPermission('tds_rates', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('tds_rates', 'view'), ctrl.getOne)
  .put(checkPermission('tds_rates', 'edit'), ctrl.update)
  .delete(checkPermission('tds_rates', 'delete'), ctrl.remove);

module.exports = router;
