const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportsController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

router.get('/dashboard',  checkPermission('reports', 'view'), ctrl.dashboard);
router.get('/sales',      checkPermission('reports', 'view'), ctrl.sales);
router.get('/expenses',   checkPermission('reports', 'view'), ctrl.expenses);
router.get('/profit',     checkPermission('reports', 'view'), ctrl.profit);
router.get('/references', checkPermission('reports', 'view'), ctrl.references);
router.get('/cash-bank',  checkPermission('reports', 'view'), ctrl.cashBank);

module.exports = router;
