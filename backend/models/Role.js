const mongoose = require('mongoose');

// Each module has granular permissions
const modulePermissionSchema = new mongoose.Schema({
  module: {
    type: String,
    required: true,
    trim: true
    // e.g. 'dashboard', 'claims', 'hospitals', 'insurance', 'tpa', 'users', 'reports', 'roles', 'settings'
    // New modules can be added without schema changes
  },
  permissions: {
    view: { type: Boolean, default: false },
    create: { type: Boolean, default: false },
    edit: { type: Boolean, default: false },
    delete: { type: Boolean, default: false },
    export: { type: Boolean, default: false },
  }
}, { _id: false });

const roleSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  description: { type: String, default: '' },
  modulePermissions: [modulePermissionSchema],
  isSystem: { type: Boolean, default: false }, // system roles cannot be deleted
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

// Helper: check if role has a specific permission on a module
roleSchema.methods.hasPermission = function (moduleName, action) {
  const mod = this.modulePermissions.find(m => m.module === moduleName);
  if (!mod) return false;
  return mod.permissions[action] === true;
};

// Helper: get all allowed modules for sidebar rendering
roleSchema.methods.getAllowedModules = function () {
  return this.modulePermissions
    .filter(m => m.permissions.view)
    .map(m => m.module);
};

module.exports = mongoose.model('Role', roleSchema);
