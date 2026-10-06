const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/backupController');
const serverCtrl = require('../controllers/backupServerController');
const { protect, checkPermission } = require('../middleware/auth');

// Google redirects the browser here after the Drive consent screen. A
// redirect carries no Bearer token, so the signed `state` param is the auth.
router.get('/gdrive/callback', serverCtrl.gdriveCallback);

router.use(protect);

// Config (global toggles, triggers, cron, disk-pressure thresholds)
router.get('/config', checkPermission('backup', 'view'), ctrl.getConfig);
router.put('/config', checkPermission('backup', 'edit'), ctrl.updateConfig);

// Manual run + run log
router.post('/run', checkPermission('backup', 'edit'), ctrl.run);
router.get('/runs', checkPermission('backup', 'view'), ctrl.listRuns);
router.get('/runs/:id', checkPermission('backup', 'view'), ctrl.getRun);

// Remote servers (CRUD + test/primary/replicate + Google Drive connect)
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
router.post('/servers/:id/gdrive/auth-url', checkPermission('backup', 'edit'), serverCtrl.gdriveAuthUrl);
router.post('/servers/:id/gdrive/disconnect', checkPermission('backup', 'edit'), serverCtrl.gdriveDisconnect);

module.exports = router;
