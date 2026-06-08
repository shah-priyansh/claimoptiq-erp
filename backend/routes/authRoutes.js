const express = require('express');
const router = express.Router();
const { login, getMe, updateMe, changePassword, createUser, getUsers, updateUser } = require('../controllers/authController');
const { protect, checkPermission } = require('../middleware/auth');

router.post('/login', login);
router.get('/me', protect, getMe);
router.put('/me', protect, updateMe);
router.put('/me/password', protect, changePassword);
router.post('/users', protect, checkPermission('users', 'create'), createUser);
router.get('/users', protect, checkPermission('users', 'view'), getUsers);
router.put('/users/:id', protect, checkPermission('users', 'edit'), updateUser);

module.exports = router;
