// Disk-usage helper for the space-pressure offload policy.
// Returns the percentage of the filesystem holding `backend/uploads` that
// is currently used, so backupService can decide whether to offload.

const fs = require('fs');
const path = require('path');

const uploadsDir = path.join(__dirname, '..', 'uploads');

// Used % of the uploads filesystem (0–100), relative to total capacity and
// using blocks available to an unprivileged user (matches what `df` shows).
// Returns null if statfs is unavailable so callers can fail open.
const uploadsUsagePct = async () => {
  try {
    const stats = await fs.promises.statfs(uploadsDir);
    const total = stats.blocks;
    const availToUser = stats.bavail;
    if (!total) return null;
    const used = total - availToUser;
    return Math.max(0, Math.min(100, (used / total) * 100));
  } catch {
    return null;
  }
};

// Bytes available to an unprivileged user on the uploads filesystem.
const uploadsBytesFree = async () => {
  try {
    const stats = await fs.promises.statfs(uploadsDir);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch {
    return null;
  }
};

module.exports = { uploadsUsagePct, uploadsBytesFree, uploadsDir };
