const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/accountEntryController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.get('/summary', checkPermission('account_entries', 'view'), ctrl.summary);

router.route('/')
  .get(checkPermission('account_entries', 'view'), ctrl.list)
  .post(checkPermission('account_entries', 'create'), ctrl.create);

router.route('/:id')
  .get(checkPermission('account_entries', 'view'), ctrl.getOne)
  .patch(checkPermission('account_entries', 'edit'), ctrl.update)
  .delete(checkPermission('account_entries', 'delete'), ctrl.remove);

module.exports = router;
