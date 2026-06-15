const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/cashBankController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.get('/balances', checkPermission('cash_bank', 'view'), ctrl.balances);
router.get('/summary', checkPermission('cash_bank', 'view'), ctrl.summary);

router.route('/')
  .get(checkPermission('cash_bank', 'view'), ctrl.list)
  .post(checkPermission('cash_bank', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('cash_bank', 'view'), ctrl.getOne)
  .patch(checkPermission('cash_bank', 'edit'), ctrl.update)
  .delete(checkPermission('cash_bank', 'delete'), ctrl.remove);

module.exports = router;
