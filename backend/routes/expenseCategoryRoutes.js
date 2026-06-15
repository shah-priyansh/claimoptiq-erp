const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/expenseCategoryController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Categories are read by anyone with `expenses.view` so the create-expense form
// can populate its picker. Mutations require the `expense_categories` module.
router.get('/', checkPermission('expenses', 'view'), ctrl.list);
router.post('/', checkPermission('expense_categories', 'create'), ctrl.create);
router.patch('/:id', checkPermission('expense_categories', 'edit'), ctrl.update);
router.delete('/:id', checkPermission('expense_categories', 'delete'), ctrl.remove);

module.exports = router;
