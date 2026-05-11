const express = require('express');
const router = express.Router();
const { getRoles, getRole, createRole, updateRole, deleteRole, getModules } = require('../controllers/roleController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Get available modules list (for building permission checkboxes in UI)
router.get('/modules', getModules);

router.route('/')
  .get(checkPermission('roles', 'view'), getRoles)
  .post(checkPermission('roles', 'create'), createRole);

router.route('/:id')
  .get(checkPermission('roles', 'view'), getRole)
  .put(checkPermission('roles', 'edit'), updateRole)
  .delete(checkPermission('roles', 'delete'), deleteRole);

module.exports = router;
