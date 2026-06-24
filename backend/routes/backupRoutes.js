const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/backupController');
const serverCtrl = require('../controllers/backupServerController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Config (global toggles, triggers, cron, disk-pressure thresholds)
router.get('/config', checkPermission('backup', 'view'), ctrl.getConfig);
router.put('/config', checkPermission('backup', 'edit'), ctrl.updateConfig);

// Manual run + run log
router.post('/run', checkPermission('backup', 'edit'), ctrl.run);
router.get('/runs', checkPermission('backup', 'view'), ctrl.listRuns);
router.get('/runs/:id', checkPermission('backup', 'view'), ctrl.getRun);

// Remote servers (CRUD + test/primary/replicate)
router.route('/servers')
  .get(checkPermission('backup', 'view'), serverCtrl.list)
  .post(checkPermission('backup', 'edit'), serverCtrl.create);

router.route('/servers/:id')
  .get(checkPermission('backup', 'view'), serverCtrl.getOne)
  .patch(checkPermission('backup', 'edit'), serverCtrl.update)
  .delete(checkPermission('backup', 'edit'), serverCtrl.remove);

router.post('/servers/:id/test', checkPermission('backup', 'edit'), serverCtrl.testConnection);
router.post('/servers/:id/set-primary', checkPermission('backup', 'edit'), serverCtrl.setPrimary);
router.post('/servers/:id/replicate', checkPermission('backup', 'edit'), serverCtrl.replicate);

module.exports = router;
