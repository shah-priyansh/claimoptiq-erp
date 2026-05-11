const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/insuranceController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('insurance', 'view'), ctrl.getAll)
  .post(checkPermission('insurance', 'create'), ctrl.create);

router.route('/:id')
  .put(checkPermission('insurance', 'edit'), ctrl.update)
  .delete(checkPermission('insurance', 'delete'), ctrl.remove);

module.exports = router;
