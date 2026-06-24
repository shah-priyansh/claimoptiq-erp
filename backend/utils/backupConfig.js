// Backup config — stored as SiteSetting key/value rows (no dedicated table),
// mirroring siteSettingController's DEFAULTS + upsert pattern.

const prisma = require('../config/prisma');

const BACKUP_DEFAULTS = {
  backup_enabled: 'false',
  backup_trigger_manual: 'true',
  backup_trigger_cron: 'false',
  backup_cron_expr: '0 3 * * *',
  backup_cron_tz: 'UTC',
  backup_trigger_on_settled: 'true',
  backup_delete_local_after_sync: 'true',
  backup_disk_threshold_pct: '80',
  backup_disk_target_pct: '60',
  backup_run_file_cap: '500',
};

// Returns the merged config (defaults overlaid with persisted rows) plus typed
// accessors.
const loadConfig = async () => {
  const rows = await prisma.siteSetting.findMany({
    where: { key: { in: Object.keys(BACKUP_DEFAULTS) } },
  });
  const merged = { ...BACKUP_DEFAULTS };
  for (const r of rows) merged[r.key] = r.value;

  const bool = (k) => merged[k] === 'true';
  const num = (k) => {
    const n = Number(merged[k]);
    return Number.isFinite(n) ? n : Number(BACKUP_DEFAULTS[k]);
  };
  return { ...merged, bool, num };
};

// Upsert a subset of keys (whitelisted against BACKUP_DEFAULTS).
const saveConfig = async (patch) => {
  const keys = Object.keys(patch).filter((k) => k in BACKUP_DEFAULTS);
  for (const key of keys) {
    const value = String(patch[key]);
    await prisma.siteSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
  return loadConfig();
};

module.exports = { BACKUP_DEFAULTS, loadConfig, saveConfig };
