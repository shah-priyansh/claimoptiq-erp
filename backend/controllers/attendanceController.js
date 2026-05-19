const prisma = require('../config/prisma');

const OT_DAILY_MULT = 1.5;
const OT_SUNDAY_MULT = 2.0;
const OT_HOLIDAY_MULT = 2.0;

const getOtType = async (date) => {
  const d = new Date(date);
  const dayOfWeek = d.getDay(); // 0 = Sunday
  if (dayOfWeek === 0) return 'sunday';

  const y = d.getUTCFullYear(), mo = String(d.getUTCMonth() + 1).padStart(2, '0'), da = String(d.getUTCDate()).padStart(2, '0');
  const dayStart = new Date(`${y}-${mo}-${da}T00:00:00.000Z`);
  const dayEnd = new Date(`${y}-${mo}-${da}T23:59:59.999Z`);
  const holiday = await prisma.holidayMaster.findFirst({
    where: { date: { gte: dayStart, lte: dayEnd }, isActive: true },
  });
  if (holiday) return 'holiday';
  return 'daily';
};

const todayDate = () => {
  const now = new Date();
  const y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
  return new Date(`${y}-${m}-${d}T00:00:00.000Z`);
};

exports.clockIn = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });

    const date = todayDate();
    const existing = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
    });
    if (existing) return res.status(400).json({ message: 'Already clocked in today' });

    const record = await prisma.attendanceRecord.create({
      data: { employeeId: employee.id, date, inTime: new Date() },
    });
    res.status(201).json(record);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.clockOut = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });

    const date = todayDate();
    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
    });
    if (!record) return res.status(400).json({ message: 'No clock-in found for today' });
    if (record.outTime) return res.status(400).json({ message: 'Already clocked out today' });

    const outTime = new Date();
    const totalMinutes = Math.floor((outTime - record.inTime) / 60000);
    const stdMinutes = Math.round(employee.standardHours * 60);
    const extraMinutes = Math.max(0, totalMinutes - stdMinutes);
    const otType = extraMinutes > 0 ? await getOtType(date) : 'none';

    // For sunday/holiday, all minutes count as OT
    const effectiveExtraMinutes = (otType === 'sunday' || otType === 'holiday') ? totalMinutes : extraMinutes;

    const updated = await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: { outTime, totalMinutes, extraMinutes: effectiveExtraMinutes, otType },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getMyAttendance = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });

    const { month, year } = req.query;
    const where = { employeeId: employee.id };
    if (month && year) {
      const y = parseInt(year), m = parseInt(month);
      const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`);
      where.date = { gte: from, lte: to };
    }
    const records = await prisma.attendanceRecord.findMany({
      where, orderBy: { date: 'desc' },
    });
    res.json({ employee, records });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getTodayRecord = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });

    const date = todayDate();
    const record = await prisma.attendanceRecord.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
    });
    res.json({ employee, record: record || null });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getAllAttendance = async (req, res) => {
  try {
    const { employeeId, month, year } = req.query;
    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (month && year) {
      const y = parseInt(year), m = parseInt(month);
      const from = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const to = new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`);
      where.date = { gte: from, lte: to };
    }
    const records = await prisma.attendanceRecord.findMany({
      where,
      include: { employee: { select: { id: true, empNumber: true, name: true } } },
      orderBy: [{ date: 'desc' }, { employee: { empNumber: 'asc' } }],
    });
    res.json(records);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.addAttendance = async (req, res) => {
  try {
    const { employeeId, date, inTime, outTime } = req.body;
    const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    const dateObj = new Date(date + 'T00:00:00.000Z');
    const inTimeObj = new Date(inTime);
    const outTimeObj = outTime ? new Date(outTime) : null;

    let totalMinutes = null, extraMinutes = null, otType = 'none';
    if (outTimeObj) {
      totalMinutes = Math.floor((outTimeObj - inTimeObj) / 60000);
      const stdMinutes = Math.round(employee.standardHours * 60);
      const rawExtra = Math.max(0, totalMinutes - stdMinutes);
      otType = rawExtra > 0 ? await getOtType(dateObj) : 'none';
      extraMinutes = (otType === 'sunday' || otType === 'holiday') ? totalMinutes : rawExtra;
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId, date: dateObj } },
      update: { inTime: inTimeObj, outTime: outTimeObj, totalMinutes, extraMinutes, otType },
      create: { employeeId, date: dateObj, inTime: inTimeObj, outTime: outTimeObj, totalMinutes, extraMinutes, otType },
    });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.addMyAttendance = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });

    const { date, inTime, outTime } = req.body;
    const dateObj = new Date(date + 'T00:00:00.000Z');
    const inTimeObj = new Date(inTime);
    const outTimeObj = outTime ? new Date(outTime) : null;

    let totalMinutes = null, extraMinutes = null, otType = 'none';
    if (outTimeObj) {
      totalMinutes = Math.floor((outTimeObj - inTimeObj) / 60000);
      const stdMinutes = Math.round(employee.standardHours * 60);
      const rawExtra = Math.max(0, totalMinutes - stdMinutes);
      otType = rawExtra > 0 ? await getOtType(dateObj) : 'none';
      extraMinutes = (otType === 'sunday' || otType === 'holiday') ? totalMinutes : rawExtra;
    }

    const record = await prisma.attendanceRecord.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: dateObj } },
      update: { inTime: inTimeObj, outTime: outTimeObj, totalMinutes, extraMinutes, otType },
      create: { employeeId: employee.id, date: dateObj, inTime: inTimeObj, outTime: outTimeObj, totalMinutes, extraMinutes, otType },
    });
    res.json(record);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.deleteAttendance = async (req, res) => {
  try {
    await prisma.attendanceRecord.delete({ where: { id: req.params.id } });
    res.json({ message: 'Deleted' });
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Record not found' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.OT_DAILY_MULT = OT_DAILY_MULT;
exports.OT_SUNDAY_MULT = OT_SUNDAY_MULT;
exports.OT_HOLIDAY_MULT = OT_HOLIDAY_MULT;
