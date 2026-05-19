const prisma = require('../config/prisma');

exports.getHolidays = async (req, res) => {
  try {
    const { year } = req.query;
    const where = {};
    if (year) {
      where.date = {
        gte: new Date(parseInt(year), 0, 1),
        lte: new Date(parseInt(year), 11, 31, 23, 59, 59),
      };
    }
    const holidays = await prisma.holidayMaster.findMany({
      where,
      orderBy: { date: 'asc' },
    });
    res.json(holidays);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createHoliday = async (req, res) => {
  try {
    const { date, name } = req.body;
    const holiday = await prisma.holidayMaster.create({
      data: { date: new Date(date), name },
    });
    res.status(201).json(holiday);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateHoliday = async (req, res) => {
  try {
    const { date, name, isActive } = req.body;
    const data = {};
    if (date !== undefined) data.date = new Date(date);
    if (name !== undefined) data.name = name;
    if (isActive !== undefined) data.isActive = isActive;
    const holiday = await prisma.holidayMaster.update({
      where: { id: req.params.id },
      data,
    });
    res.json(holiday);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Holiday not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteHoliday = async (req, res) => {
  try {
    await prisma.holidayMaster.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Holiday not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
