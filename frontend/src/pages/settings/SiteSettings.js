import React, { useState, useEffect } from 'react';
import { getPublicStatsAPI, updateSiteSettingsAPI, uploadInvoiceLogoAPI, getTdsRatesAPI } from '../../services/api';
import { toast } from 'react-toastify';
import SearchableSelect from '../../components/ui/SearchableSelect';

const STATIC_BASE = (process.env.REACT_APP_API_URL || 'http://localhost:5001/api').replace(/\/api\/?$/, '');
const resolveLogoSrc = (url) => {
  if (!url) return null;
  return url.startsWith('http') ? url : `${STATIC_BASE}${url}`;
};

const TABS = [
  { id: 'login', label: 'Login Page' },
  { id: 'invoice', label: 'Invoice Template' },
];

const SiteSettings = () => {
  const [tab, setTab] = useState('login');
  const [form, setForm] = useState({
    // Login
    login_title: '', login_subtitle: '', login_tagline: '',
    login_stat_claims: '', login_stat_hospitals: '', login_disclaimer: '',
    // Invoice template
    invoice_company_name: '', invoice_company_address: '', invoice_company_phone: '',
    invoice_company_email: '', invoice_company_website: '', invoice_logo_url: '',
    invoice_terms: '',
    invoice_bank_name: '', invoice_bank_account_no: '', invoice_bank_ifsc: '',
    invoice_bank_account_holder: '', invoice_upi_id: '', invoice_authorized_signatory: '',
    invoice_default_gst_rate: '0',
    invoice_number_prefix: 'FCC',
    invoice_default_tds_rate_id: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [tdsRates, setTdsRates] = useState([]);
  const [loadingTdsRates, setLoadingTdsRates] = useState(true);

  useEffect(() => {
    getPublicStatsAPI()
      .then(({ data }) => setForm((f) => ({ ...f, ...data })))
      .catch(() => toast.error('Failed to load settings'))
      .finally(() => setLoading(false));
    getTdsRatesAPI({ active: 'true' })
      .then(({ data }) => setTdsRates(data || []))
      .catch(() => setTdsRates([]))
      .finally(() => setLoadingTdsRates(false));
  }, []);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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

  if (loading) return <p className="text-sm text-gray-400 p-6">Loading...</p>;

  const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

  return (
    <div>
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

      <form onSubmit={handleSave} className="space-y-5">
        {tab === 'login' && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 max-w-lg">
            <h2 className="text-base font-semibold text-gray-700 mb-4">Login Page</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input value={form.login_title} onChange={set('login_title')} placeholder="e.g. ClaimOptiq" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Subtitle</label>
                <input value={form.login_subtitle} onChange={set('login_subtitle')} placeholder="e.g. AI ERP Suite" className={inputCls} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tagline</label>
                <input value={form.login_tagline} onChange={set('login_tagline')} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Claims Managed</label>
                  <input value={form.login_stat_claims} onChange={set('login_stat_claims')} placeholder="e.g. 4300+" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Hospitals</label>
                  <input value={form.login_stat_hospitals} onChange={set('login_stat_hospitals')} placeholder="e.g. 50+" className={inputCls} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Disclaimer</label>
                <textarea rows={3} value={form.login_disclaimer} onChange={set('login_disclaimer')} className={`${inputCls} resize-none`} />
              </div>
            </div>
          </div>
        )}

        {tab === 'invoice' && (
          <div className="space-y-5 max-w-3xl">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-1">Company Branding</h2>
              <p className="text-xs text-gray-500 mb-4">Appears in the invoice header (logo and address block).</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                  <input value={form.invoice_company_name} onChange={set('invoice_company_name')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                  <div className="flex items-center gap-3">
                    {form.invoice_logo_url ? (
                      <img
                        src={resolveLogoSrc(form.invoice_logo_url)}
                        alt="Invoice logo"
                        className="w-16 h-16 object-contain rounded-lg border border-gray-200 bg-white p-1"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 flex items-center justify-center text-xs text-gray-400">No logo</div>
                    )}
                    <div className="flex-1 space-y-1">
                      <label className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
                          className="hidden"
                          disabled={uploadingLogo}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploadingLogo(true);
                            try {
                              const { data } = await uploadInvoiceLogoAPI(file);
                              setForm((f) => ({ ...f, invoice_logo_url: data.invoice_logo_url }));
                              toast.success('Logo uploaded');
                            } catch (err) {
                              toast.error(err.response?.data?.message || 'Upload failed');
                            } finally {
                              setUploadingLogo(false);
                              e.target.value = '';
                            }
                          }}
                        />
                        {uploadingLogo ? 'Uploading...' : 'Choose file'}
                      </label>
                      {form.invoice_logo_url && (
                        <button
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, invoice_logo_url: '' }))}
                          className="ml-2 text-xs text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      )}
                      <p className="text-xs text-gray-400">PNG / JPG / WEBP. Max 10MB.</p>
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                  <textarea rows={2} value={form.invoice_company_address} onChange={set('invoice_company_address')} className={`${inputCls} resize-none`} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input value={form.invoice_company_phone} onChange={set('invoice_company_phone')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input value={form.invoice_company_email} onChange={set('invoice_company_email')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Website</label>
                  <input value={form.invoice_company_website} onChange={set('invoice_company_website')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Authorized Signatory</label>
                  <input value={form.invoice_authorized_signatory} onChange={set('invoice_authorized_signatory')} className={inputCls} />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-1">Tax &amp; Numbering Defaults</h2>
              <p className="text-xs text-gray-500 mb-4">
                Applied to every new invoice. You can still edit GST + TDS on each draft before issuing.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default GST Rate (%)</label>
                  <input
                    type="number" min="0" max="100" step="0.01"
                    value={form.invoice_default_gst_rate}
                    onChange={set('invoice_default_gst_rate')}
                    placeholder="e.g. 18"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default TDS Rate</label>
                  <SearchableSelect
                    isLoading={loadingTdsRates}
                    value={form.invoice_default_tds_rate_id}
                    onChange={(v) => setForm((f) => ({ ...f, invoice_default_tds_rate_id: v || '' }))}
                    placeholder="No default TDS"
                    searchPlaceholder="Search TDS rates..."
                    noneLabel="— No default —"
                    allowClear
                    options={tdsRates.map((r) => ({
                      value: r._id,
                      label: `${r.taxName} — ${r.rate}%${r.section ? ` (${r.section})` : ''}`,
                    }))}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Carries name + section onto the invoice PDF.
                    {' '}
                    <a href="/tds-rates" className="text-primary-600 hover:underline">Add new rates here</a>.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Prefix</label>
                  <input
                    type="text"
                    maxLength={10}
                    value={form.invoice_number_prefix}
                    onChange={(e) => set('invoice_number_prefix')({ target: { value: e.target.value.toUpperCase().slice(0, 10) } })}
                    placeholder="FCC"
                    className={inputCls}
                  />
                  <p className="text-xs text-gray-400 mt-1">Appears as PREFIX/YYYY-YY/0001 on issued invoices.</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-1">Terms & Conditions</h2>
              <p className="text-xs text-gray-500 mb-4">One condition per line. Shown on every invoice.</p>
              <textarea rows={5} value={form.invoice_terms} onChange={set('invoice_terms')} className={`${inputCls} resize-y font-mono`} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-base font-semibold text-gray-700 mb-1">Bank Details</h2>
              <p className="text-xs text-gray-500 mb-4">Shown in the footer of every invoice. UPI ID enables an auto-generated payment QR code.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                  <input value={form.invoice_bank_name} onChange={set('invoice_bank_name')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Holder Name</label>
                  <input value={form.invoice_bank_account_holder} onChange={set('invoice_bank_account_holder')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                  <input value={form.invoice_bank_account_no} onChange={set('invoice_bank_account_no')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">IFSC Code</label>
                  <input value={form.invoice_bank_ifsc} onChange={set('invoice_bank_ifsc')} className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">UPI ID (for QR)</label>
                  <input value={form.invoice_upi_id} onChange={set('invoice_upi_id')} placeholder="e.g. company@hdfc" className={inputCls} />
                </div>
              </div>
            </div>
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
    </div>
  );
};

export default SiteSettings;
