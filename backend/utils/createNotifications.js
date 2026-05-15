const prisma = require('../config/prisma');

// Send a notification to all users matching the given role slugs
const notifyRoles = async (slugs, message, type, referenceId) => {
  const users = await prisma.user.findMany({
    where: { role: { slug: { in: slugs } }, isActive: true },
    select: { id: true },
  });
  if (!users.length) return;
  await prisma.notification.createMany({
    data: users.map((u) => ({ userId: u.id, message, type, referenceId })),
  });
};

// Send a notification to a single user by id
const notifyUser = async (userId, message, type, referenceId) => {
  await prisma.notification.create({
    data: { userId, message, type, referenceId },
  });
};

module.exports = { notifyRoles, notifyUser };
