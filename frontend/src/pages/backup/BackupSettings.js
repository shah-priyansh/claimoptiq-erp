import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useConfirm } from '../../context/ConfirmContext';
import {
  getBackupConfigAPI, updateBackupConfigAPI, runBackupAPI, getBackupRunsAPI,
  getBackupServersAPI, createBackupServerAPI, updateBackupServerAPI, deleteBackupServerAPI,
  testBackupServerAPI, setPrimaryBackupServerAPI, replicateBackupServerAPI,
} from '../../services/api';

const TABS = [
  { id: 'global', label: 'Global' },
  { id: 'servers', label: 'Servers' },
  { id: 'runs', label: 'Runs' },
];

const inputCls =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
const labelCls = 'block text-sm font-medium text-gray-700 mb-1';

const fmtBytes = (b) => {
  if (!b) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / Math.pow(1024, i)).toFixed(1)} ${u[i]}`;
};

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer">
    <input
      type="checkbox"
      checked={!!checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
    />
    <span>
      <span className="text-sm font-medium text-gray-700">{label}</span>
      {hint && <span className="block text-xs text-gray-500 mt-0.5">{hint}</span>}
    </span>
  </label>
);

const SectionCard = ({ title, subtitle, children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 p-6 ${className}`}>
    {title && <h2 className="text-base font-semibold text-gray-700 mb-1">{title}</h2>}
    {subtitle && <p className="text-xs text-gray-500 mb-4">{subtitle}</p>}
    {children}
  </div>
);

// ─── Global tab ──────────────────────────────────────────────────────────
const GlobalTab = () => {
  const [cfg, setCfg] = useState(null);
  const [meta, setMeta] = useState({ encryptionReady: true, diskUsedPct: null, encryptionError: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getBackupConfigAPI();
      setCfg(data.config);
      setMeta({ encryptionReady: data.encryptionReady, diskUsedPct: data.diskUsedPct, encryptionError: data.encryptionError });
    } catch { toast.error('Failed to load backup config'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: typeof v === 'boolean' ? String(v) : v }));
  const bool = (k) => cfg?.[k] === 'true';

  const save = async () => {
    setSaving(true);
    try { await updateBackupConfigAPI(cfg); toast.success('Backup settings saved'); }
    catch (e) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  if (loading || !cfg) return <p className="text-sm text-gray-400 p-6">Loading...</p>;

  return (
    <div className="space-y-5 max-w-3xl">
      {!meta.encryptionReady && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          Credential encryption is unavailable: {meta.encryptionError}. Set <code className="bg-white/60 px-1 rounded">BACKUP_ENCRYPTION_KEY</code> (64 hex chars) on the server.
        </div>
      )}

      {meta.diskUsedPct !== null && (
        <SectionCard title="Uploads Disk Usage" subtitle={`${meta.diskUsedPct.toFixed(1)}% used · offloads at ${cfg.backup_disk_threshold_pct}%`}>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-primary-500" style={{ width: `${Math.min(100, meta.diskUsedPct)}%` }} />
          </div>
        </SectionCard>
      )}

      <SectionCard title="General" subtitle="Master toggle and post-sync cleanup for offloaded files.">
        <div className="divide-y divide-gray-100">
          <Toggle
            checked={bool('backup_enabled')}
            onChange={set('backup_enabled')}
            label="Backup enabled"
            hint="Master switch. When off, no offload runs at all."
          />
          <Toggle
            checked={bool('backup_delete_local_after_sync')}
            onChange={set('backup_delete_local_after_sync')}
            label="Delete local copy after sync"
            hint="Free disk space once the primary server confirms the copy."
          />
        </div>
      </SectionCard>

      <SectionCard title="Triggers" subtitle="When backup runs should be started.">
        <div className="divide-y divide-gray-100">
          <Toggle
            checked={bool('backup_trigger_manual')}
            onChange={set('backup_trigger_manual')}
            label="Manual runs"
            hint="Allow 'Run now' from the Runs tab."
          />
          <Toggle
            checked={bool('backup_trigger_on_settled')}
            onChange={set('backup_trigger_on_settled')}
            label="On claim settled"
            hint="Offload a claim's files when it's marked settled."
          />
          <Toggle
            checked={bool('backup_trigger_cron')}
            onChange={set('backup_trigger_cron')}
            label="Scheduled (cron)"
            hint="Run automatically on a schedule."
          />
        </div>
        {bool('backup_trigger_cron') && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div>
              <label className={labelCls}>Cron expression</label>
              <input className={inputCls} value={cfg.backup_cron_expr} onChange={(e) => set('backup_cron_expr')(e.target.value)} placeholder="0 3 * * *" />
            </div>
            <div>
              <label className={labelCls}>Timezone</label>
              <input className={inputCls} value={cfg.backup_cron_tz} onChange={(e) => set('backup_cron_tz')(e.target.value)} placeholder="UTC" />
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Disk-Pressure Policy"
        subtitle="Scheduled / on-settled runs only offload when disk usage crosses the threshold, oldest files first, until it drops to the stop value. Manual runs ignore the threshold."
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Offload above %</label>
            <input className={inputCls} type="number" value={cfg.backup_disk_threshold_pct} onChange={(e) => set('backup_disk_threshold_pct')(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Stop at %</label>
            <input className={inputCls} type="number" value={cfg.backup_disk_target_pct} onChange={(e) => set('backup_disk_target_pct')(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Max files / run</label>
            <input className={inputCls} type="number" value={cfg.backup_run_file_cap} onChange={(e) => set('backup_run_file_cap')(e.target.value)} />
          </div>
        </div>
      </SectionCard>

      <button
        onClick={save}
        disabled={saving}
        className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
      >
        {saving ? 'Saving...' : 'Save Settings'}
      </button>
    </div>
  );
};

// ─── Servers tab ─────────────────────────────────────────────────────────
const blankServer = () => ({
  _draft: true, name: '', host: '', port: 22, username: '', authType: 'password',
  remoteBasePath: '/backups', isEnabled: true, password: '', privateKey: '', passphrase: '',
});

const ServersTab = () => {
  const confirm = useConfirm();
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try { const { data } = await getBackupServersAPI(); setServers(data.map((s) => ({ ...s, password: '', privateKey: '', passphrase: '' }))); }
    catch { toast.error('Failed to load servers'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const addRow = () => setServers((s) => [...s, blankServer()]);
  const patch = (idx, k, v) => setServers((s) => s.map((row, i) => (i === idx ? { ...row, [k]: v } : row)));

  const save = async (row, idx) => {
    if (!row.name || !row.host || !row.username) { toast.error('Name, host and username are required'); return; }
    setBusyId(row._id || `draft-${idx}`);
    try {
      const payload = {
        name: row.name, host: row.host, port: Number(row.port) || 22, username: row.username,
        authType: row.authType, remoteBasePath: row.remoteBasePath, isEnabled: row.isEnabled,
      };
      if (row.password) payload.password = row.password;
      if (row.privateKey) payload.privateKey = row.privateKey;
      if (row.passphrase) payload.passphrase = row.passphrase;
      if (row._draft) await createBackupServerAPI(payload);
      else await updateBackupServerAPI(row._id, payload);
      toast.success('Server saved');
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Save failed'); }
    finally { setBusyId(null); }
  };

  const remove = async (row, idx) => {
    if (row._draft) { setServers((s) => s.filter((_, i) => i !== idx)); return; }
    if (!(await confirm(`Delete server "${row.name}"?`, { title: 'Delete backup server', confirmLabel: 'Delete', variant: 'danger' }))) return;
    setBusyId(row._id);
    try { await deleteBackupServerAPI(row._id); toast.success('Server deleted'); load(); }
    catch (e) {
      const msg = e.response?.data?.message || 'Delete failed';
      if (e.response?.status === 409 && await confirm(`${msg}\n\nReplicate those files to other servers now?`, { title: 'Files only on this server', confirmLabel: 'Replicate' })) {
        try { const { data } = await replicateBackupServerAPI(row._id); toast.success(data.message); }
        catch (er) { toast.error(er.response?.data?.message || 'Replicate failed'); }
      } else { toast.error(msg); }
    } finally { setBusyId(null); }
  };

  const test = async (row) => {
    setBusyId(row._id);
    try { const { data } = await testBackupServerAPI(row._id); data.ok ? toast.success('Connection OK') : toast.error(`Failed: ${data.error}`); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Test failed'); }
    finally { setBusyId(null); }
  };

  const makePrimary = async (row) => {
    setBusyId(row._id);
    try { await setPrimaryBackupServerAPI(row._id); toast.success(`${row.name} is now primary`); load(); }
    catch (e) { toast.error(e.response?.data?.message || 'Failed'); }
    finally { setBusyId(null); }
  };

  if (loading) return <p className="text-sm text-gray-400 p-6">Loading...</p>;

  return (
    <div className="space-y-4">
      {servers.length === 0 && (
        <div className="bg-white rounded-xl border border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">No backup servers configured yet.</p>
        </div>
      )}

      {servers.map((row, idx) => {
        const busy = busyId === (row._id || `draft-${idx}`) || busyId === row._id;
        return (
          <div
            key={row._id || idx}
            className={`bg-white rounded-xl border p-6 ${row.isPrimary ? 'border-primary-400 ring-1 ring-primary-100' : 'border-gray-200'}`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => !row._draft && makePrimary(row)}
                  title="Set primary"
                  className={`text-lg leading-none ${row.isPrimary ? 'text-primary-500' : 'text-gray-300 hover:text-gray-400'}`}
                >
                  ★
                </button>
                <h3 className="text-base font-semibold text-gray-800">{row.name || 'New server'}</h3>
                {row.isPrimary && <span className="text-[10px] font-semibold uppercase tracking-wide text-primary-700 bg-primary-50 border border-primary-100 px-1.5 py-0.5 rounded">Primary</span>}
                {row._draft && <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">Unsaved</span>}
                {!row._draft && row.lastTestOk === true && <span className="text-[10px] font-semibold uppercase tracking-wide text-green-700 bg-green-50 border border-green-100 px-1.5 py-0.5 rounded">Reachable</span>}
                {!row._draft && row.lastTestOk === false && <span className="text-[10px] font-semibold uppercase tracking-wide text-red-700 bg-red-50 border border-red-100 px-1.5 py-0.5 rounded">Unreachable</span>}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!row.isEnabled}
                  onChange={(e) => patch(idx, 'isEnabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
                Enabled
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className={labelCls}>Name</label>
                <input className={inputCls} value={row.name} onChange={(e) => patch(idx, 'name', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Host</label>
                <input className={inputCls} value={row.host} onChange={(e) => patch(idx, 'host', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Port</label>
                <input className={inputCls} type="number" value={row.port} onChange={(e) => patch(idx, 'port', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Username</label>
                <input className={inputCls} value={row.username} onChange={(e) => patch(idx, 'username', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Base path</label>
                <input className={inputCls} value={row.remoteBasePath} onChange={(e) => patch(idx, 'remoteBasePath', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Auth</label>
                <select className={inputCls} value={row.authType} onChange={(e) => patch(idx, 'authType', e.target.value)}>
                  <option value="password">Password</option>
                  <option value="key">SSH key</option>
                </select>
              </div>
              {row.authType === 'password' ? (
                <div>
                  <label className={labelCls}>
                    Password {row.hasPassword && <span className="text-green-600 text-xs ml-1">• set</span>}
                  </label>
                  <input
                    className={inputCls}
                    type="password"
                    placeholder={row.hasPassword ? '•••••• (unchanged)' : ''}
                    value={row.password}
                    onChange={(e) => patch(idx, 'password', e.target.value)}
                  />
                </div>
              ) : (
                <>
                  <div className="md:col-span-2">
                    <label className={labelCls}>
                      Private key {row.hasPrivateKey && <span className="text-green-600 text-xs ml-1">• set</span>}
                    </label>
                    <textarea
                      className={`${inputCls} resize-y font-mono text-xs`}
                      rows={2}
                      placeholder={row.hasPrivateKey ? '•••••• (unchanged)' : '-----BEGIN OPENSSH PRIVATE KEY-----'}
                      value={row.privateKey}
                      onChange={(e) => patch(idx, 'privateKey', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>
                      Passphrase {row.hasPassphrase && <span className="text-green-600 text-xs ml-1">• set</span>}
                    </label>
                    <input
                      className={inputCls}
                      type="password"
                      placeholder={row.hasPassphrase ? '•••••• (unchanged)' : ''}
                      value={row.passphrase}
                      onChange={(e) => patch(idx, 'passphrase', e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 mt-5 pt-4 border-t border-gray-100">
              <button
                onClick={() => save(row, idx)}
                disabled={busy}
                className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
              {!row._draft && (
                <button
                  onClick={() => test(row)}
                  disabled={busy}
                  className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
                >
                  Test connection
                </button>
              )}
              <button
                onClick={() => remove(row, idx)}
                disabled={busy}
                className="ml-auto bg-red-50 hover:bg-red-100 text-red-600 px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}

      <button
        onClick={addRow}
        className="w-full bg-white border border-dashed border-gray-300 text-sm font-medium text-gray-500 rounded-xl py-3 hover:border-primary-400 hover:text-primary-600 transition-colors"
      >
        + Add server
      </button>
    </div>
  );
};

// ─── Runs tab ────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  success:     'text-green-700 bg-green-50 border border-green-100',
  partial:     'text-amber-700 bg-amber-50 border border-amber-100',
  failed:      'text-red-700 bg-red-50 border border-red-100',
  running:     'text-blue-700 bg-blue-50 border border-blue-100',
  skipped:     'text-gray-600 bg-gray-100 border border-gray-200',
  interrupted: 'text-orange-700 bg-orange-50 border border-orange-100',
};

const RunsTab = () => {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try { const { data } = await getBackupRunsAPI({ limit: 25 }); setRuns(data); }
    catch { toast.error('Failed to load runs'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (dryRun) => {
    setRunning(true);
    try {
      const { data } = await runBackupAPI(dryRun ? { dryRun: 1 } : {});
      if (data.skipped) toast.info(`Skipped: ${data.reason}`);
      else toast.success(dryRun ? 'Dry run complete' : `Run ${data.status || 'started'}`);
      load();
    } catch (e) { toast.error(e.response?.data?.message || 'Run failed'); }
    finally { setRunning(false); }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => run(false)}
          disabled={running}
          className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
        >
          {running ? 'Running...' : 'Run now'}
        </button>
        <button
          onClick={() => run(true)}
          disabled={running}
          className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
        >
          Dry run
        </button>
        <button
          onClick={load}
          className="ml-auto text-sm font-medium text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400 p-6">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Started</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Trigger</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Status</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Uploaded</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Deleted</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Freed</th>
                  <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase">Errors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                      No runs yet.
                    </td>
                  </tr>
                )}
                {runs.map((r) => (
                  <tr key={r._id} title={r.log} className="hover:bg-gray-50">
                    <td className="py-3 px-4 whitespace-nowrap text-gray-700">{new Date(r.startedAt).toLocaleString()}</td>
                    <td className="py-3 px-4 text-gray-700">{r.trigger}</td>
                    <td className="py-3 px-4">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded ${STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-gray-700">{r.filesUploaded}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{r.filesDeleted}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{fmtBytes(r.bytesFreed)}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{r.errorCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const BackupSettings = () => {
  const [tab, setTab] = useState('global');

  return (
    <div>
      <p className="text-sm text-gray-500 mb-5">
        Offload uploaded files to remote SFTP servers to free local disk space.
      </p>

      <div className="flex gap-2 border-b border-gray-200 mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'global' && <GlobalTab />}
      {tab === 'servers' && <ServersTab />}
      {tab === 'runs' && <RunsTab />}
    </div>
  );
};

export default BackupSettings;
