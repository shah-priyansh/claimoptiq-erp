const toResponse = (item) => {
  if (!item || typeof item !== 'object') return item;
  if (Array.isArray(item)) return item.map(toResponse);
  if (item instanceof Date) return item;

  const result = { ...item };
  if ('id' in result) result._id = result.id;

  for (const key of Object.keys(result)) {
    const val = result[key];
    if (val && typeof val === 'object' && !(val instanceof Date)) {
      result[key] = toResponse(val);
    }
  }
  return result;
};

const formatRole = (role) => {
  if (!role) return role;
  return {
    ...role,
    _id: role.id,
    modulePermissions: (role.modulePermissions || []).map((mp) => ({
      _id: mp.id,
      module: mp.module,
      permissions: {
        view: mp.view,
        create: mp.create,
        edit: mp.edit,
        delete: mp.delete,
        export: mp.export,
      },
    })),
  };
};

const parseModulePermissions = (modulePermissions) => {
  return (modulePermissions || []).map((mp) => ({
    module: mp.module,
    view: mp.permissions?.view ?? false,
    create: mp.permissions?.create ?? false,
    edit: mp.permissions?.edit ?? false,
    delete: mp.permissions?.delete ?? false,
    export: mp.permissions?.export ?? false,
  }));
};

module.exports = { toResponse, formatRole, parseModulePermissions };
