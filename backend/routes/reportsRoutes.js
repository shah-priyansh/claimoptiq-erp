const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reportsController');
const { protect, checkPermission } = require('../middleware/auth');

// Every report under /api/reports is an FCC-internal financial view. Hospital-
// and reference-scoped logins only ever get the hospital-scoped Claim Settlement
// report (served from /api/claims), so block this whole router for them even if
// their role holds the `reports` permission — otherwise granting that permission
// would leak firm-wide sales/profit/balance-sheet data via direct API calls.
const internalOnly = (req, res, next) => {
  if (req.user?.hospitalId || req.user?.referenceId) {
    return res.status(403).json({ message: 'Reports are not available for your account' });
  }
  next();
};

router.use(protect);
router.use(internalOnly);

router.get('/dashboard',  checkPermission('reports', 'view'), ctrl.dashboard);
router.get('/sales',      checkPermission('reports', 'view'), ctrl.sales);
router.get('/expenses',   checkPermission('reports', 'view'), ctrl.expenses);
router.get('/profit',     checkPermission('reports', 'view'), ctrl.profit);
router.get('/references', checkPermission('reports', 'view'), ctrl.references);
router.get('/cash-bank',  checkPermission('reports', 'view'), ctrl.cashBank);
router.get('/balance-sheet', checkPermission('reports', 'view'), ctrl.balanceSheet);
router.get('/taxes',         checkPermission('reports', 'view'), ctrl.taxesDiscount);

module.exports = router;
