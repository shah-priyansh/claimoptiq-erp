const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Reads open to any authenticated user; mutations require chart_of_accounts.
router.get('/chart', ctrl.chart);
router.route('/')
  .get(ctrl.list)
  .post(checkPermission('chart_of_accounts', 'create'), ctrl.create);
router.route('/:id')
  .patch(checkPermission('chart_of_accounts', 'edit'), ctrl.update)
  .delete(checkPermission('chart_of_accounts', 'delete'), ctrl.remove);

module.exports = router;
