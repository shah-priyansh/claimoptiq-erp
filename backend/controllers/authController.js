const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const generateToken = require('../utils/generateToken');
const { formatRole, toResponse } = require('../utils/toResponse');
const { invalidateUserCache } = require('../middleware/auth');
const { generateResetToken, hashResetToken } = require('../utils/passwordReset');
const { sendEmail } = require('../utils/sendEmail');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());

const userInclude = {
  role: { include: { modulePermissions: true } },
  hospital: { select: { id: true, name: true } },
  reference: { select: { id: true, name: true } },
};

const formatUser = (user) => {
  if (!user) return null;
  const { password, ...rest } = user;
  return {
    ...rest,
    _id: rest.id,
    role: formatRole(rest.role),
    hospital: rest.hospital ? { ...rest.hospital, _id: rest.hospital.id } : null,
    reference: rest.reference ? { ...rest.reference, _id: rest.reference.id } : null,
  };
};

exports.login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ message: 'Please provide email/mobile and password' });
    }

    const isEmail = identifier.includes('@');
    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: identifier.toLowerCase().trim() }
        : { phone: identifier.trim() },
      include: userInclude,
    });

    // Distinct, coded errors so the frontend can highlight the right field.
    if (!user) {
      return res.status(404).json({ code: 'USER_NOT_FOUND', message: 'No account found with this email/mobile' });
    }
    if (!user.isActive) {
      return res.status(403).json({ code: 'ACCOUNT_DEACTIVATED', message: 'Account deactivated. Contact admin.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ code: 'INCORRECT_PASSWORD', message: 'Incorrect password.' });
    }

    if (!user.role || !user.role.isActive) {
      return res.status(403).json({ code: 'ACCOUNT_DEACTIVATED', message: 'Your role has been deactivated. Contact admin.' });
    }

    const token = generateToken(user.id);
    res.json({ token, user: formatUser(user) });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Generic response for the forgot-password endpoint. Always the same, whether
// or not the account exists, so this endpoint can't be used to enumerate users.
const FORGOT_GENERIC = 'If an account exists for that email/mobile, a password reset link has been sent.';

exports.forgotPassword = async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier || !String(identifier).trim()) {
      return res.status(400).json({ message: 'Please provide your email or mobile number' });
    }

    const isEmail = identifier.includes('@');
    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: identifier.toLowerCase().trim() }
        : { phone: identifier.trim() },
    });

    // Only mint a token + email for a real, active account. Otherwise fall
    // through to the identical generic response below.
    if (user && user.isActive && user.email) {
      const { rawToken, tokenHash, expiresAt } = generateResetToken();
      await prisma.user.update({
        where: { id: user.id },
        data: { resetTokenHash: tokenHash, resetTokenExpiresAt: expiresAt },
      });

      const base = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
      const resetUrl = `${base}/reset-password?token=${rawToken}`;
      const subject = 'Reset your ClaimOptiq password';
      const text = `Hello ${user.name || ''},\n\nWe received a request to reset your ClaimOptiq password.\n\nReset it here (link valid for 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.\n\n— First Care Consultancy`;
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1f2937">
          <h2 style="color:#1e3a8a;margin-bottom:4px">Reset your password</h2>
          <p>Hello ${user.name || ''},</p>
          <p>We received a request to reset your ClaimOptiq password. Click the button below to choose a new one. This link is valid for <strong>1 hour</strong>.</p>
          <p style="margin:28px 0">
            <a href="${resetUrl}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block">Reset Password</a>
          </p>
          <p style="font-size:13px;color:#6b7280">Or paste this link into your browser:<br><a href="${resetUrl}">${resetUrl}</a></p>
          <p style="font-size:13px;color:#6b7280">If you didn't request this, you can safely ignore this email — your password won't change.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="font-size:12px;color:#9ca3af">First Care Consultancy · ClaimOptiq</p>
        </div>`;

      try {
        await sendEmail({ to: user.email, subject, text, html });
      } catch (mailErr) {
        // Don't leak delivery failures to the caller; log for ops.
        console.error('[forgotPassword] email send failed:', mailErr.message);
      }
    }

    return res.json({ message: FORGOT_GENERIC });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: 'Reset token and new password are required' });
    }
    if (String(password).length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const tokenHash = hashResetToken(token);
    const user = await prisma.user.findFirst({
      where: {
        resetTokenHash: tokenHash,
        resetTokenExpiresAt: { gt: new Date() },
      },
    });
    if (!user) {
      return res.status(400).json({ code: 'INVALID_TOKEN', message: 'This reset link is invalid or has expired. Please request a new one.' });
    }

    const hashed = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashed, resetTokenHash: null, resetTokenExpiresAt: null },
    });
    invalidateUserCache(user.id);

    res.json({ message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getMe = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: userInclude,
    });
    res.json(formatUser(user));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createUser = async (req, res) => {
  try {
    const { name, email, password, role, hospital, reference, phone } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: 'Phone number is required' });
    }
    if (!isValidPhone(phone)) {
      return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return res.status(400).json({ message: 'User with this email already exists' });
    }

    const roleDoc = await prisma.role.findUnique({ where: { id: role } });
    if (!roleDoc) {
      return res.status(400).json({ message: 'Invalid role selected' });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        name,
        email: email.toLowerCase().trim(),
        password: hashed,
        roleId: role,
        hospitalId: hospital || null,
        referenceId: reference || null,
        phone,
      },
      include: userInclude,
    });

    res.status(201).json(formatUser(user));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      include: userInclude,
      orderBy: { createdAt: 'desc' },
    });
    res.json(users.map(formatUser));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const { name, phone } = req.body;
    const data = {};
    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) return res.status(400).json({ message: 'Name cannot be empty' });
      data.name = trimmed;
    }
    if (phone !== undefined) {
      const trimmed = String(phone).trim();
      if (!isValidPhone(trimmed)) {
        return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number (starts with 6-9)' });
      }
      const conflict = await prisma.user.findFirst({
        where: { phone: trimmed, NOT: { id: req.user.id } },
        select: { id: true },
      });
      if (conflict) return res.status(400).json({ message: 'Phone number already in use by another user' });
      data.phone = trimmed;
    }
    if (!Object.keys(data).length) {
      return res.status(400).json({ message: 'No changes to save' });
    }
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      include: userInclude,
    });
    invalidateUserCache(req.user.id);
    res.json(formatUser(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required' });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: 'New password must be at least 6 characters' });
    }
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: 'Current password is incorrect' });
    const same = await bcrypt.compare(newPassword, user.password);
    if (same) return res.status(400).json({ message: 'New password must be different from current password' });
    const hashed = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: req.user.id }, data: { password: hashed } });
    invalidateUserCache(req.user.id);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, hospital, reference, phone, isActive, password } = req.body;

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (role) {
      const roleDoc = await prisma.role.findUnique({ where: { id: role } });
      if (!roleDoc) return res.status(400).json({ message: 'Invalid role selected' });
    }

    const updateData = {};
    if (name) updateData.name = name;
    if (email) updateData.email = email.toLowerCase().trim();
    if (role) updateData.roleId = role;
    if (hospital !== undefined) updateData.hospitalId = hospital || null;
    if (reference !== undefined) updateData.referenceId = reference || null;
    if (phone !== undefined) updateData.phone = phone;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.password = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: userInclude,
    });

    invalidateUserCache(req.params.id);
    res.json(formatUser(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
