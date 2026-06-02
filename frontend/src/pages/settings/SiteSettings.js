import React, { useState, useEffect } from 'react';
import { getPublicStatsAPI, updateSiteSettingsAPI } from '../../services/api';
import { toast } from 'react-toastify';

const SiteSettings = () => {
  const [form, setForm] = useState({
    login_title: '',
    login_subtitle: '',
    login_tagline: '',
    login_stat_claims: '',
    login_stat_hospitals: '',
    login_disclaimer: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getPublicStatsAPI()
      .then(({ data }) => setForm({
        login_title:          data.login_title || '',
        login_subtitle:       data.login_subtitle || '',
        login_tagline:        data.login_tagline || '',
        login_stat_claims:    data.login_stat_claims || '',
        login_stat_hospitals: data.login_stat_hospitals || '',
        login_disclaimer:     data.login_disclaimer || '',
      }))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateSiteSettingsAPI(form);
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
        <h2 className="text-base font-semibold text-gray-700 mb-4">Login Page Stats</h2>

        {loading ? (
          <p className="text-sm text-gray-400">Loading...</p>
        ) : (
          <form onSubmit={handleSave} className="space-y-4">

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={form.login_title}
                onChange={e => setForm(f => ({ ...f, login_title: e.target.value }))}
                placeholder="e.g. ClaimOptiq"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
              <input
                type="text"
                value={form.login_subtitle}
                onChange={e => setForm(f => ({ ...f, login_subtitle: e.target.value }))}
                placeholder="e.g. AI ERP Suite"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
              <input
                type="text"
                value={form.login_tagline}
                onChange={e => setForm(f => ({ ...f, login_tagline: e.target.value }))}
                placeholder="e.g. AI-Powered Healthcare Business Operating System by First Care Consultancy"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Claims Managed</label>
              <input
                type="text"
                value={form.login_stat_claims}
                onChange={e => setForm(f => ({ ...f, login_stat_claims: e.target.value }))}
                placeholder="e.g. 4300+"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Hospitals</label>
              <input
                type="text"
                value={form.login_stat_hospitals}
                onChange={e => setForm(f => ({ ...f, login_stat_hospitals: e.target.value }))}
                placeholder="e.g. 50+"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Disclaimer (shown below login card)</label>
              <textarea
                value={form.login_disclaimer}
                onChange={e => setForm(f => ({ ...f, login_disclaimer: e.target.value }))}
                rows={3}
                placeholder="e.g. First Care Consultancy is not registered..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              />
            </div>

            {/* Preview */}
            <div className="mt-2 p-4 bg-primary-600 rounded-lg">
              <p className="text-xs text-primary-200 mb-3 font-medium uppercase tracking-wide">Preview</p>
              <p className="text-xl font-bold text-white leading-tight">{form.login_title || 'ClaimOptiq'}</p>
              <p className="text-sm text-primary-100 mt-0.5 mb-1">{form.login_subtitle || 'AI ERP Suite'}</p>
              <p className="text-xs text-primary-200 mb-3">{form.login_tagline || 'AI-Powered Healthcare Business Operating System by First Care Consultancy'}</p>
              <div className="grid grid-cols-2 gap-3 text-sm text-primary-100">
                <div className="bg-white/10 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-white">{form.login_stat_claims || '—'}</p>
                  <p className="text-xs">Claims Managed</p>
                </div>
                <div className="bg-white/10 rounded-lg p-3 text-center">
                  <p className="text-xl font-bold text-white">{form.login_stat_hospitals || '—'}</p>
                  <p className="text-xs">Hospitals</p>
                </div>
              </div>
            </div>
            {form.login_disclaimer && (
              <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-500 italic">{form.login_disclaimer}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={saving}
              className="bg-primary-600 hover:bg-primary-700 text-white px-5 py-2 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default SiteSettings;
