const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/partyController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Reads are open to any authenticated user (the expense form needs the picker);
// only mutations require the `parties` permission.
router.route('/')
  .get(ctrl.list)
  .post(checkPermission('parties', 'create'), ctrl.create);

router.get('/:id/ledger', ctrl.ledger);
router.post('/:id/merge', checkPermission('parties', 'edit'), ctrl.merge);

router.route('/:id')
  .get(ctrl.getOne)
  .patch(checkPermission('parties', 'edit'), ctrl.update)
  .delete(checkPermission('parties', 'delete'), ctrl.remove);

module.exports = router;
