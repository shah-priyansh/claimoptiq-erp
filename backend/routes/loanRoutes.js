const express = require('express');
const router = express.Router();
const { list, getOne, create, recordPayment, remove } = require('../controllers/loanController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('loans', 'view'), list)
  .post(checkPermission('loans', 'create'), create);

router.post('/installments/:installmentId/pay', checkPermission('loans', 'edit'), recordPayment);

router.route('/:id')
  .get(checkPermission('loans', 'view'), getOne)
  .delete(checkPermission('loans', 'delete'), remove);

module.exports = router;
