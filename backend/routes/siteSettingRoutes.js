const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { getPublicSettings, updateSettings, uploadInvoiceLogo } = require('../controllers/siteSettingController');

router.get('/', getPublicSettings);
router.put('/', protect, checkPermission('settings', 'edit'), updateSettings);
router.post('/invoice-logo', protect, checkPermission('settings', 'edit'), upload.single('logo'), uploadInvoiceLogo);

module.exports = router;
