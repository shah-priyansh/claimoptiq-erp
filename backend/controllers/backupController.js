const prisma = require('../config/prisma');
const { loadConfig, saveConfig, BACKUP_DEFAULTS } = require('../utils/backupConfig');
const backupService = require('../services/backupService');
const backupScheduler = require('../services/backupScheduler');
const { isAvailable, keyError } = require('../utils/cryptoBackup');
const { uploadsUsagePct } = require('../utils/diskUsage');

// BigInt (bytesFreed) isn't JSON-serializable — coerce to Number for the wire.
const runToResponse = (run) => ({
  ...run,
  _id: run.id,
  bytesFreed: run.bytesFreed === null || run.bytesFreed === undefined ? 0 : Number(run.bytesFreed),
});

exports.getConfig = async (req, res) => {
  try {
    const cfg = await loadConfig();
    const config = {};
    for (const key of Object.keys(BACKUP_DEFAULTS)) config[key] = cfg[key];
    const diskUsedPct = await uploadsUsagePct();
    res.json({
      config,
      defaults: BACKUP_DEFAULTS,
      encryptionReady: isAvailable(),
      encryptionError: keyError(),
      diskUsedPct,
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateConfig = async (req, res) => {
  try {
    const patch = req.body || {};
    const cfg = await saveConfig(patch);
    // Re-arm cron live whenever schedule-related settings change.
    backupScheduler.reschedule().catch(() => {});
    const config = {};
    for (const key of Object.keys(BACKUP_DEFAULTS)) config[key] = cfg[key];
    res.json({ config });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.run = async (req, res) => {
  try {
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    // Manual runs force past the disk-pressure gate (but still respect the
    // global enable switch inside runBackup).
    const result = await backupService.runBackup({
      trigger: 'manual',
      triggeredById: req.user.id,
      force: true,
      dryRun,
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.listRuns = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const runs = await prisma.backupRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    res.json(runs.map(runToResponse));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getRun = async (req, res) => {
  try {
    const run = await prisma.backupRun.findUnique({
      where: { id: req.params.id },
      include: { triggeredBy: { select: { id: true, name: true } } },
    });
    if (!run) return res.status(404).json({ message: 'Not found' });
    res.json(runToResponse(run));
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
