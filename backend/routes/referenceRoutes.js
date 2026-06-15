const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/referenceController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('references', 'view'), ctrl.getAll)
  .post(checkPermission('references', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('references', 'view'), ctrl.getOne)
  .put(checkPermission('references', 'edit'), ctrl.update)
  .delete(checkPermission('references', 'delete'), ctrl.remove);

router.get('/:id/hospitals', checkPermission('references', 'view'), ctrl.getHospitals);

module.exports = router;
