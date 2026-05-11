const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/tpaController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('tpa', 'view'), ctrl.getAll)
  .post(checkPermission('tpa', 'create'), ctrl.create);

router.route('/:id')
  .put(checkPermission('tpa', 'edit'), ctrl.update)
  .delete(checkPermission('tpa', 'delete'), ctrl.remove);

module.exports = router;
