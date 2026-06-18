const prisma = require('../config/prisma');

const DEFAULT_SETTINGS = { dailyMultiplier: 1.5, sundayMultiplier: 2.0, holidayMultiplier: 2.0 };

const getOrCreate = async () => {
  const existing = await prisma.otSettings.findFirst();
  if (existing) return existing;
  return prisma.otSettings.create({ data: DEFAULT_SETTINGS });
};

exports.getOtMultipliers = getOrCreate;

exports.getOtSettings = async (req, res) => {
  try {
    res.json(await getOrCreate());
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateOtSettings = async (req, res) => {
  try {
    const { dailyMultiplier, sundayMultiplier, holidayMultiplier } = req.body;
    const data = {};
    if (dailyMultiplier !== undefined)   data.dailyMultiplier   = parseFloat(dailyMultiplier);
    if (sundayMultiplier !== undefined)  data.sundayMultiplier  = parseFloat(sundayMultiplier);
    if (holidayMultiplier !== undefined) data.holidayMultiplier = parseFloat(holidayMultiplier);

    for (const [k, v] of Object.entries(data)) {
      if (isNaN(v) || v < 0) return res.status(400).json({ message: `${k} must be zero or a positive number` });
    }

    const existing = await prisma.otSettings.findFirst();
    const settings = existing
      ? await prisma.otSettings.update({ where: { id: existing.id }, data })
      : await prisma.otSettings.create({ data: { ...DEFAULT_SETTINGS, ...data } });

    res.json(settings);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
