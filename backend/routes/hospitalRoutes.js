const express = require('express');
const router = express.Router();
const { createHospital, getHospitals, getHospital, updateHospital, setHospitalStatus, deleteHospital, deleteAllHospitals, bulkImportHospitals, addHospitalDoctor } = require('../controllers/hospitalController');
const { protect, checkPermission, checkAnyPermission } = require('../middleware/auth');

router.use(protect);

router.route('/')
  .get(checkPermission('hospitals', 'view'), getHospitals)
  .post(checkPermission('hospitals', 'create'), createHospital)
  .delete(checkPermission('hospitals', 'delete'), deleteAllHospitals);

router.post('/import', checkPermission('hospitals', 'create'), bulkImportHospitals);

// Inline doctor add — reachable from the claim form, so claim creators/editors
// can register a panel doctor without needing full hospital edit access.
router.post(
  '/:id/doctors',
  checkAnyPermission([
    ['hospitals', 'edit'],
    ['claims', 'create'],
    ['claims', 'edit'],
  ]),
  addHospitalDoctor,
);

// Inline Active/Inactive toggle from the Hospitals list — status-only, non-destructive.
router.patch('/:id/status', checkPermission('hospitals', 'edit'), setHospitalStatus);

router.route('/:id')
  .get(checkPermission('hospitals', 'view'), getHospital)
  .put(checkPermission('hospitals', 'edit'), updateHospital)
  .delete(checkPermission('hospitals', 'delete'), deleteHospital);

module.exports = router;
