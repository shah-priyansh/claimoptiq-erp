// Cron scheduler for backups (single-process, runs inside `node server.js`).
//
// reschedule() is called once at boot and again whenever backup config changes
// (from the admin panel) so editing the cron expression re-arms it live.
//
// NOTE: on a single Railway instance this fires once. If the app is ever scaled
// horizontally, every instance would fire — the future fix is a DB advisory lock
// around runBackup. Documented in the plan; not implemented here.

const cron = require('node-cron');
const backupService = require('./backupService');
const { loadConfig } = require('../utils/backupConfig');

let task = null;

const stop = () => {
  if (task) {
    try { task.stop(); } catch { /* ignore */ }
    task = null;
  }
};

const reschedule = async () => {
  stop();
  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    console.warn('[backup] could not load config for scheduler:', err.message);
    return false;
  }
  if (!cfg.bool('backup_enabled') || !cfg.bool('backup_trigger_cron')) return false;

  const expr = cfg.backup_cron_expr;
  const tz = cfg.backup_cron_tz || 'UTC';
  if (!cron.validate(expr)) {
    console.warn(`[backup] invalid cron expression "${expr}" — scheduler not armed`);
    return false;
  }
  task = cron.schedule(expr, () => {
    backupService.runBackup({ trigger: 'cron' }).catch((err) => {
      console.error('[backup] cron run failed:', err.message);
    });
  }, { timezone: tz });
  console.log(`[backup] cron armed: "${expr}" (${tz})`);
  return true;
};

// Boot: clear stale 'running' rows from a crash/redeploy, then arm cron.
const init = async () => {
  try {
    const cleared = await backupService.cleanupStaleRuns();
    if (cleared) console.log(`[backup] marked ${cleared} stale run(s) interrupted`);
  } catch (err) {
    console.warn('[backup] stale-run cleanup failed:', err.message);
  }
  await reschedule();
};

module.exports = { init, reschedule, stop };
