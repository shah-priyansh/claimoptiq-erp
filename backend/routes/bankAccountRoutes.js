const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bankAccountController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Any authenticated user can READ the list — the Cash/Bank entry modal
// needs the picker for every operator. Only Settings editors can mutate.
router.route('/')
  .get(ctrl.list)
  .post(checkPermission('settings', 'edit'), ctrl.create);

router.route('/:id')
  .get(ctrl.getOne)
  .patch(checkPermission('settings', 'edit'), ctrl.update)
  .delete(checkPermission('settings', 'edit'), ctrl.remove);

router.post('/:id/set-default', checkPermission('settings', 'edit'), ctrl.setDefault);

module.exports = router;
