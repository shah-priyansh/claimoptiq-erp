const prisma = require('../config/prisma');
const { formatRole, parseModulePermissions } = require('../utils/toResponse');

const roleInclude = { modulePermissions: true };

exports.getModules = async (req, res) => {
  try {
    const modules = [
      { key: 'dashboard', label: 'Dashboard', actions: ['view'] },
      { key: 'claims', label: 'Claims', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { key: 'hospitals', label: 'Hospitals', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'insurance', label: 'Insurance Companies', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'tpa', label: 'TPA', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'references', label: 'References (Commission)', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'billing_service_names', label: 'Billing Service Names', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'tds_rates', label: 'TDS Rates', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'invoices', label: 'Invoices (FCC Bills)', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { key: 'expenses', label: 'Expenses', actions: ['view', 'create', 'edit', 'delete', 'export'] },
      { key: 'expense_categories', label: 'Expense Categories', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'users', label: 'User Management', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'roles', label: 'Role Management', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'reports', label: 'FCC Bill Generate', actions: ['view', 'export'] },
      { key: 'claim_statuses', label: 'Claim Status Master', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'claim_document_types', label: 'Claim Document Types', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'document_submissions', label: 'Document Submissions', actions: ['view', 'create', 'edit', 'delete'] },
      { key: 'staff', label: 'Staff & Salary', actions: ['view', 'create', 'edit', 'delete'] },
    ];
    res.json(modules);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getRoles = async (req, res) => {
  try {
    const roles = await prisma.role.findMany({
      where: { isActive: true },
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
    res.json(roles.map(formatRole));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getRole = async (req, res) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: roleInclude,
    });
    if (!role) return res.status(404).json({ message: 'Role not found' });
    res.json(formatRole(role));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createRole = async (req, res) => {
  try {
    const { name, description, modulePermissions } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    const existing = await prisma.role.findUnique({ where: { slug } });
    if (existing) {
      return res.status(400).json({ message: 'A role with this name already exists' });
    }

    const role = await prisma.role.create({
      data: {
        name,
        slug,
        description: description || '',
        isSystem: false,
        modulePermissions: {
          create: parseModulePermissions(modulePermissions),
        },
      },
      include: roleInclude,
    });
    res.status(201).json(formatRole(role));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateRole = async (req, res) => {
  try {
    const role = await prisma.role.findUnique({
      where: { id: req.params.id },
      include: roleInclude,
    });
    if (!role) return res.status(404).json({ message: 'Role not found' });

    const { name, description, modulePermissions } = req.body;
    const updateData = {};

    if (name && !role.isSystem) {
      updateData.name = name;
      updateData.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }
    if (description !== undefined) updateData.description = description;

    if (modulePermissions) {
      await prisma.roleModulePermission.deleteMany({ where: { roleId: role.id } });
      updateData.modulePermissions = {
        create: parseModulePermissions(modulePermissions),
      };
    }

    const updated = await prisma.role.update({
      where: { id: req.params.id },
      data: updateData,
      include: roleInclude,
    });
    res.json(formatRole(updated));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteRole = async (req, res) => {
  try {
    const role = await prisma.role.findUnique({ where: { id: req.params.id } });
    if (!role) return res.status(404).json({ message: 'Role not found' });
    if (role.isSystem) {
      return res.status(400).json({ message: 'System roles cannot be deleted' });
    }

    const usersWithRole = await prisma.user.count({ where: { roleId: role.id } });
    if (usersWithRole > 0) {
      return res.status(400).json({
        message: `Cannot delete: ${usersWithRole} user(s) are assigned this role. Reassign them first.`,
      });
    }

    await prisma.role.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Role deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
