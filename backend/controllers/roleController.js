const Role = require('../models/Role');

// Get all available modules with their possible actions
// This drives the UI checkboxes — add new modules here when needed
exports.getModules = async (req, res) => {
  try {
    const modules = [
      { key: 'dashboard', label: 'Dashboard', actions: ['view'] },
      { key: 'claims', label: 'Claims', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { key: 'hospitals', label: 'Hospitals', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'insurance', label: 'Insurance Companies', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'tpa', label: 'TPA', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'users', label: 'User Management', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'roles', label: 'Role Management', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'reports', label: 'Reports', actions: ['view', 'export'] },
      { key: 'claim_statuses', label: 'Claim Status Master', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'claim_document_types', label: 'Claim Document Types', actions: ['view', 'create', 'edit', 'delete'] },
    ];
    res.json(modules);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const roles = await Role.find({ isActive: true }).sort('name');
    res.json(roles);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.json(role);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name, description, modulePermissions } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const existing = await Role.findOne({ slug });
    if (existing) {
      return res.status(400).json({ message: 'A role with this name already exists' });
    }

    const role = await Role.create({
      name,
      slug,
      description,
      modulePermissions: modulePermissions || [],
      isSystem: false,
    });
    res.status(201).json(role);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });

    // Cannot change slug of system roles
    const { name, description, modulePermissions } = req.body;
    if (name && !role.isSystem) {
      role.name = name;
      role.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }
    if (description !== undefined) role.description = description;
    if (modulePermissions) role.modulePermissions = modulePermissions;

    await role.save();
    res.json(role);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await Role.findById(req.params.id);
    if (!role) return res.status(404).json({ message: 'Role not found' });
    if (role.isSystem) {
      return res.status(400).json({ message: 'System roles cannot be deleted' });
    }

    // Check if any user is using this role
    const User = require('../models/User');
    const usersWithRole = await User.countDocuments({ role: role._id });
    if (usersWithRole > 0) {
      return res.status(400).json({
        message: `Cannot delete: ${usersWithRole} user(s) are assigned this role. Reassign them first.`
      });
    }

    role.isActive = false;
    await role.save();
    res.json({ message: 'Role deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
