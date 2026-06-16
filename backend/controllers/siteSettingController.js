const prisma = require('../config/prisma');

const DEFAULTS = {
  login_stat_claims:    '4300+',
  login_stat_hospitals: '50+',
  login_title:          'ClaimOptiq',
  login_subtitle:       'AI ERP Suite',
  login_tagline:        'AI-Powered Healthcare Business Operating System by First Care Consultancy',
  login_disclaimer:     'First Care Consultancy is not registered and not regulated by the Insurance Regulatory and Development Authority of India and doesn\'t have any tie up with insurance companies and Third party administrators.',

  // Invoice template (PDF branding) — editable from Settings → Invoice Template
  invoice_company_name:           'First Care Consultancy',
  invoice_company_address:        'G-13, Nishal Center, Near Nishal Circle, Pal RTO, Surat -395009',
  invoice_company_phone:          '9376467973',
  invoice_company_email:          'firstcareconsultancy.surat@gmail.com',
  invoice_company_website:        'http://firstcareconsultancy.in',
  invoice_logo_url:               '',
  invoice_terms:                  'Payment should be settled before 7th date of Every Month.\nYou Can Pay Payment by Cash /UPI/Internet banking etc.\nThanks for doing business with us!',
  invoice_bank_name:              'HDFC BANK, NANPURA',
  invoice_bank_account_no:        '50200112657030',
  invoice_bank_ifsc:              'HDFC0001026',
  invoice_bank_account_holder:    'FIRST CARE CONSULTANCY',
  invoice_upi_id:                 '',
  invoice_authorized_signatory:   'First Care Consultancy',
  // Platform-wide default GST rate (per-hospital GST override was removed
  // 2026-06-16). Stored as a string ('18' / '0' / '12') and parsed at use-site.
  invoice_default_gst_rate:       '0',
  // Platform-wide invoice number prefix — appears as PREFIX/YYYY-YY/0001 on
  // issued invoices. Replaces the previous per-hospital invoicePrefix field.
  invoice_number_prefix:          'FCC',
  // Platform-wide default TDS — points at a TdsRate master row id. The
  // per-hospital tdsRate / tdsRateId columns were retired 2026-06-16; this
  // is now the single fallback when an invoice doesn't carry an override.
  invoice_default_tds_rate_id:    '',
};

// Public — no auth (login page fields). Invoice template fields are also returned because rendering uses them
// but they're not sensitive — bank details on outgoing invoices are visible to the customer anyway.
exports.getPublicSettings = async (req, res) => {
  try {
    const rows = await prisma.siteSetting.findMany({
      where: { key: { in: Object.keys(DEFAULTS) } },
    });
    const result = { ...DEFAULTS };
    rows.forEach(r => { result[r.key] = r.value; });
    res.json(result);
  } catch {
    res.json(DEFAULTS);
  }
};

// Superadmin only
exports.updateSettings = async (req, res) => {
  try {
    const allowed = Object.keys(DEFAULTS);
    const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k));
    await Promise.all(
      updates.map(([key, value]) =>
        prisma.siteSetting.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) },
        })
      )
    );
    res.json({ message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to save settings', error: err.message });
  }
};

// Multer middleware sets req.file. Saves the relative URL to invoice_logo_url and returns it.
exports.uploadInvoiceLogo = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    const url = `/uploads/${req.file.filename}`;
    await prisma.siteSetting.upsert({
      where: { key: 'invoice_logo_url' },
      update: { value: url },
      create: { key: 'invoice_logo_url', value: url },
    });
    res.json({ message: 'Logo uploaded', invoice_logo_url: url });
  } catch (err) {
    res.status(500).json({ message: 'Failed to upload logo', error: err.message });
  }
};

// Helper for invoice rendering — returns the invoice template subset with defaults applied.
exports.getInvoiceTemplate = async () => {
  const keys = Object.keys(DEFAULTS).filter((k) => k.startsWith('invoice_'));
  const rows = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
  const out = {};
  for (const k of keys) out[k] = DEFAULTS[k];
  for (const r of rows) out[r.key] = r.value;
  return out;
};
