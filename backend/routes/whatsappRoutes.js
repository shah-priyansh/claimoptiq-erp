const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const ctl = require('../controllers/whatsappController');

router.get('/status', protect, checkPermission('whatsapp', 'view'), ctl.getStatus);
router.post('/connect', protect, checkPermission('whatsapp', 'edit'), ctl.connect);
router.post('/disconnect', protect, checkPermission('whatsapp', 'edit'), ctl.disconnect);
router.post('/send', protect, checkPermission('whatsapp', 'create'), ctl.send);
router.post('/check', protect, checkPermission('whatsapp', 'create'), ctl.check);

module.exports = router;
