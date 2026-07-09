const express = require('express');
const router = express.Router();
const { list, replaceAll } = require('../controllers/directPatientBillingServiceController');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Access is gated on the `invoices` module — this config drives invoice
// generation and belongs to the same permission bucket as the invoice
// wizard / bulk-preview / issue flows.
router.route('/')
  .get(checkPermission('invoices', 'view'), list)
  .put(checkPermission('invoices', 'edit'), replaceAll);

module.exports = router;
