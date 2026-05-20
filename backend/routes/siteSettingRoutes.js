const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const { getPublicSettings, updateSettings } = require('../controllers/siteSettingController');

router.get('/', getPublicSettings);
router.put('/', protect, checkPermission('settings', 'edit'), updateSettings);

module.exports = router;
