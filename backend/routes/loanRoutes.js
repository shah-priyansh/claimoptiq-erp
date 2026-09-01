const express = require('express');
const router = express.Router();
const { list, getOne, create, update, recordPayment, recordInterest, recordPrincipal, remove } = require('../controllers/loanController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('loans', 'view'), list)
  .post(checkPermission('loans', 'create'), create);

router.post('/installments/:installmentId/pay', checkPermission('loans', 'edit'), recordPayment);

// Open (interest-bearing) loans: record an interest collection / principal repayment.
router.post('/:id/interest', checkPermission('loans', 'edit'), recordInterest);
router.post('/:id/principal', checkPermission('loans', 'edit'), recordPrincipal);

router.route('/:id')
  .get(checkPermission('loans', 'view'), getOne)
  .put(checkPermission('loans', 'edit'), update)
  .delete(checkPermission('loans', 'delete'), remove);

module.exports = router;
