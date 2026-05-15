const bcrypt = require('bcryptjs');
const prisma = require('../config/prisma');
const generateToken = require('../utils/generateToken');
const { formatRole, toResponse } = require('../utils/toResponse');

const isValidPhone = (v) => /^[6-9]\d{9}$/.test((v || '').trim());
const isValidEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || '').trim());

const userInclude = {
  role: { include: { modulePermissions: true } },
  hospital: { select: { id: true, name: true } },
};

const formatUser = (user) => {
  if (!user) return null;
  const { password, ...rest } = user;
  return {
    ...rest,
    _id: rest.id,
    role: formatRole(rest.role),
    hospital: rest.hospital ? { ...rest.hospital, _id: rest.hospital.id } : null,
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

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    if (!user.role || !user.role.isActive) {
      return res.status(403).json({ message: 'Your role has been deactivated. Contact admin.' });
    }

    const token = generateToken(user.id);
    res.json({ token, user: formatUser(user) });
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
    const { name, email, password, role, hospital, phone } = req.body;

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

exports.updateUser = async (req, res) => {
  try {
    const { name, email, role, hospital, phone, isActive, password } = req.body;

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
    if (phone !== undefined) updateData.phone = phone;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.password = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      include: userInclude,
    });

    res.json(formatUser(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
