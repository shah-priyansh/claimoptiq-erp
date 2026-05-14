const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const upload = require('../middleware/upload');
const ctrl = require('../controllers/documentSubmissionController');

router.use(protect);

router.get('/',    checkPermission('document_submissions', 'view'),   ctrl.getAll);
router.post('/',   checkPermission('document_submissions', 'create'), upload.single('file'), ctrl.create);
router.get('/:id/download', checkPermission('document_submissions', 'view'), ctrl.download);
router.put('/:id', checkPermission('document_submissions', 'edit'),   ctrl.update);
router.delete('/:id', checkPermission('document_submissions', 'delete'), ctrl.remove);

module.exports = router;
