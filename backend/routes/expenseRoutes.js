const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expenseController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.get('/summary', checkPermission('expenses', 'view'), ctrl.summary);

router.route('/')
  .get(checkPermission('expenses', 'view'), ctrl.list)
  .post(checkPermission('expenses', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('expenses', 'view'), ctrl.getOne)
  .patch(checkPermission('expenses', 'edit'), ctrl.update)
  .delete(checkPermission('expenses', 'delete'), ctrl.remove);

module.exports = router;
