const express = require('express');
const router = express.Router();
const { createHospital, getHospitals, getHospital, updateHospital, deleteHospital, bulkImportHospitals } = require('../controllers/hospitalController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('hospitals', 'view'), getHospitals)
  .post(checkPermission('hospitals', 'create'), createHospital);

router.post('/import', checkPermission('hospitals', 'create'), bulkImportHospitals);

router.route('/:id')
  .get(checkPermission('hospitals', 'view'), getHospital)
  .put(checkPermission('hospitals', 'edit'), updateHospital)
  .delete(checkPermission('hospitals', 'delete'), deleteHospital);

module.exports = router;
