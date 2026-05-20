const prisma = require('../config/prisma');

const DEFAULTS = {
  login_stat_claims:    '4300+',
  login_stat_hospitals: '50+',
  login_title:          'ClaimOptiq',
  login_subtitle:       'AI ERP Suite',
  login_tagline:        'AI-Powered Healthcare Business Operating System by First Care Consultancy',
};

// Public — no auth
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
