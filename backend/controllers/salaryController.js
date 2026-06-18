const prisma = require('../config/prisma');
const { getOtMultipliers } = require('./otSettingsController');

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const isoDateUTC = (d) => {
  const dt = new Date(d);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};

const computeSalary = (
  employee,
  attendance,
  calendarDays,
  extraAllowances = [],
  otMults = { dailyMultiplier: 1.5, sundayMultiplier: 2.0, holidayMultiplier: 2.0 },
  holidaySet = new Set(),
) => {
  // Re-classify each attendance row using the current holiday list so that
  // adding a holiday AFTER attendance is saved still rolls up correctly.
  const stdMin = Math.round(employee.standardHours * 60);
  const dailyOtEnabled = employee.dailyOtEnabled !== false;
  const classified = attendance.filter(a => a.outTime).map(a => {
    const isSun = new Date(a.date).getUTCDay() === 0;
    const isHol = holidaySet.has(isoDateUTC(a.date));
    const total = a.totalMinutes || 0;
    let type, mins;
    if (isSun)      { type = 'sunday';  mins = total; }
    else if (isHol) { type = 'holiday'; mins = total; }
    else            { type = 'daily';   mins = dailyOtEnabled ? Math.max(0, total - stdMin) : 0; }
    return { ...a, _otType: type, _otMinutes: mins };
  });

  const presentDays = classified.length;
  const dailyOtMinutes   = classified.filter(a => a._otType === 'daily').reduce((s, a) => s + a._otMinutes, 0);
  const sundayOtMinutes  = classified.filter(a => a._otType === 'sunday').reduce((s, a) => s + a._otMinutes, 0);
  const holidayOtMinutes = classified.filter(a => a._otType === 'holiday').reduce((s, a) => s + a._otMinutes, 0);

  const basicSalary = employee.basicSalary;
  const perDayBasic = basicSalary / calendarDays;
  const earnedBasic = perDayBasic * presentDays;

  const hourlyRate = basicSalary / (calendarDays * employee.standardHours);
  const dailyOtAmt = (dailyOtMinutes / 60) * hourlyRate * otMults.dailyMultiplier;
  const sundayOtAmt = (sundayOtMinutes / 60) * hourlyRate * otMults.sundayMultiplier;
  const holidayOtAmt = (holidayOtMinutes / 60) * hourlyRate * otMults.holidayMultiplier;
  const totalOtAmt = dailyOtAmt + sundayOtAmt + holidayOtAmt;

  const fixedAllowances = employee.allowances.reduce((s, a) => s + a.amount, 0);
  const extraAllowancesTotal = extraAllowances.reduce((s, a) => s + (parseFloat(a.amount) || 0), 0);

  const totalAmount = earnedBasic + fixedAllowances + extraAllowancesTotal + totalOtAmt;

  return {
    presentDays,
    dailyOtMinutes,
    sundayOtMinutes,
    holidayOtMinutes,
    totalAmount: Math.round(totalAmount * 100) / 100,
    breakdown: {
      earnedBasic: Math.round(earnedBasic * 100) / 100,
      fixedAllowances: Math.round(fixedAllowances * 100) / 100,
      extraAllowancesTotal: Math.round(extraAllowancesTotal * 100) / 100,
      dailyOtAmt: Math.round(dailyOtAmt * 100) / 100,
      sundayOtAmt: Math.round(sundayOtAmt * 100) / 100,
      holidayOtAmt: Math.round(holidayOtAmt * 100) / 100,
      totalOtAmt: Math.round(totalOtAmt * 100) / 100,
      hourlyRate: Math.round(hourlyRate * 100) / 100,
    },
  };
};

exports.computeSalary = async (req, res) => {
  try {
    const { month, year, employeeId } = req.body;
    const m = parseInt(month), y = parseInt(year);
    const calDays = daysInMonth(y, m);
    const monthStart = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = new Date(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59.999Z`);

    const empWhere = { isActive: true };
    if (employeeId) empWhere.id = employeeId;
    const employees = await prisma.employee.findMany({ where: empWhere, include: { allowances: true } });
    const empIds = employees.map(e => e.id);

    // Single batch fetch for all employees instead of N+1
    const [allAttendance, allExisting, otMults, holidays] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { employeeId: { in: empIds }, date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.salaryRecord.findMany({
        where: { employeeId: { in: empIds }, month: monthStart },
      }),
      getOtMultipliers(),
      prisma.holidayMaster.findMany({
        where: { date: { gte: monthStart, lte: monthEnd }, isActive: true },
      }),
    ]);
    const holidaySet = new Set(holidays.map(h => isoDateUTC(h.date)));

    const attendanceByEmp = {};
    allAttendance.forEach(a => {
      if (!attendanceByEmp[a.employeeId]) attendanceByEmp[a.employeeId] = [];
      attendanceByEmp[a.employeeId].push(a);
    });
    const existingByEmp = {};
    allExisting.forEach(r => { existingByEmp[r.employeeId] = r; });

    // Run all upserts in parallel
    const results = await Promise.all(employees.map(async (emp) => {
      const existing = existingByEmp[emp.id];
      if (existing?.isFinalized) return existing;

      const attendance = attendanceByEmp[emp.id] || [];
      const extraAllowances = existing?.extraAllowances || [];
      const calc = computeSalary(emp, attendance, calDays, extraAllowances, otMults, holidaySet);

      const record = await prisma.salaryRecord.upsert({
        where: { employeeId_month: { employeeId: emp.id, month: monthStart } },
        update: {
          basicSalary: emp.basicSalary, calendarDays: calDays,
          presentDays: calc.presentDays, dailyOtMinutes: calc.dailyOtMinutes,
          sundayOtMinutes: calc.sundayOtMinutes, holidayOtMinutes: calc.holidayOtMinutes,
          totalAmount: calc.totalAmount,
        },
        create: {
          employeeId: emp.id, month: monthStart, basicSalary: emp.basicSalary,
          calendarDays: calDays, presentDays: calc.presentDays,
          dailyOtMinutes: calc.dailyOtMinutes, sundayOtMinutes: calc.sundayOtMinutes,
          holidayOtMinutes: calc.holidayOtMinutes, extraAllowances: [],
          totalAmount: calc.totalAmount,
        },
        include: { employee: { include: { allowances: true } } },
      });
      return { ...record, breakdown: calc.breakdown };
    }));

    res.json(results);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getSalaryRecords = async (req, res) => {
  try {
    const { month, year, employeeId } = req.query;
    const where = {};
    if (employeeId) where.employeeId = employeeId;
    if (month && year) {
      const y = parseInt(year), m = parseInt(month);
      where.month = new Date(`${y}-${String(m).padStart(2, '0')}-01T00:00:00.000Z`);
    }
    const records = await prisma.salaryRecord.findMany({
      where,
      include: { employee: { include: { allowances: true } } },
      orderBy: [{ month: 'desc' }, { employee: { empNumber: 'asc' } }],
    });

    // Attach sundayPresentDays / holidayPresentDays / holidayCount per record
    // by joining attendance + holiday list. Cheap enough for a monthly view.
    const withCounts = await Promise.all(records.map(async (r) => {
      const m0 = r.month;
      const y0 = m0.getUTCFullYear(), mo0 = m0.getUTCMonth() + 1;
      const last = new Date(Date.UTC(y0, mo0, 0)).getUTCDate();
      const mStart = new Date(`${y0}-${String(mo0).padStart(2, '0')}-01T00:00:00.000Z`);
      const mEnd = new Date(`${y0}-${String(mo0).padStart(2, '0')}-${String(last).padStart(2, '0')}T23:59:59.999Z`);
      const [attendance, holidays] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { employeeId: r.employeeId, date: { gte: mStart, lte: mEnd }, outTime: { not: null } },
        }),
        prisma.holidayMaster.findMany({
          where: { date: { gte: mStart, lte: mEnd }, isActive: true },
        }),
      ]);
      const holidaySet = new Set(holidays.map(h => isoDateUTC(h.date)));
      let sundayPresentDays = 0, holidayPresentDays = 0;
      for (const a of attendance) {
        const d = new Date(a.date);
        if (d.getUTCDay() === 0) sundayPresentDays += 1;
        else if (holidaySet.has(isoDateUTC(a.date))) holidayPresentDays += 1;
      }
      return { ...r, sundayPresentDays, holidayPresentDays, holidayCount: holidays.length };
    }));

    res.json(withCounts);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getMySalary = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });
    const records = await prisma.salaryRecord.findMany({
      where: { employeeId: employee.id },
      include: { employee: { include: { allowances: true } } },
      orderBy: { month: 'desc' },
    });

    const withCounts = await Promise.all(records.map(async (r) => {
      const m0 = r.month;
      const y0 = m0.getUTCFullYear(), mo0 = m0.getUTCMonth() + 1;
      const last = new Date(Date.UTC(y0, mo0, 0)).getUTCDate();
      const mStart = new Date(`${y0}-${String(mo0).padStart(2, '0')}-01T00:00:00.000Z`);
      const mEnd = new Date(`${y0}-${String(mo0).padStart(2, '0')}-${String(last).padStart(2, '0')}T23:59:59.999Z`);
      const [attendance, holidays] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { employeeId: r.employeeId, date: { gte: mStart, lte: mEnd }, outTime: { not: null } },
        }),
        prisma.holidayMaster.findMany({
          where: { date: { gte: mStart, lte: mEnd }, isActive: true },
        }),
      ]);
      const holidaySet = new Set(holidays.map(h => isoDateUTC(h.date)));
      let sundayPresentDays = 0, holidayPresentDays = 0;
      for (const a of attendance) {
        const d = new Date(a.date);
        if (d.getUTCDay() === 0) sundayPresentDays += 1;
        else if (holidaySet.has(isoDateUTC(a.date))) holidayPresentDays += 1;
      }
      return { ...r, sundayPresentDays, holidayPresentDays, holidayCount: holidays.length };
    }));

    res.json(withCounts);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateSalaryRecord = async (req, res) => {
  try {
    const { extraAllowances, isFinalized } = req.body;
    const record = await prisma.salaryRecord.findUnique({
      where: { id: req.params.id },
      include: { employee: { include: { allowances: true } } },
    });
    if (!record) return res.status(404).json({ message: 'Record not found' });
    if (record.isFinalized && !isFinalized === false) {
      return res.status(400).json({ message: 'Cannot edit a finalized salary record' });
    }

    const data = {};
    if (extraAllowances !== undefined) {
      data.extraAllowances = extraAllowances;
      // Recompute total
      const ry = record.month.getUTCFullYear(), rm = record.month.getUTCMonth() + 1;
      const rLastDay = new Date(Date.UTC(ry, rm, 0)).getUTCDate();
      const rMonthStart = new Date(`${ry}-${String(rm).padStart(2, '0')}-01T00:00:00.000Z`);
      const rMonthEnd = new Date(`${ry}-${String(rm).padStart(2, '0')}-${String(rLastDay).padStart(2, '0')}T23:59:59.999Z`);
      const [attendance, otMults, holidays] = await Promise.all([
        prisma.attendanceRecord.findMany({
          where: { employeeId: record.employeeId, date: { gte: rMonthStart, lte: rMonthEnd } },
        }),
        getOtMultipliers(),
        prisma.holidayMaster.findMany({
          where: { date: { gte: rMonthStart, lte: rMonthEnd }, isActive: true },
        }),
      ]);
      const holidaySet = new Set(holidays.map(h => isoDateUTC(h.date)));
      const calc = computeSalary(record.employee, attendance, record.calendarDays, extraAllowances, otMults, holidaySet);
      data.totalAmount = calc.totalAmount;
    }
    if (isFinalized !== undefined) data.isFinalized = isFinalized;

    const updated = await prisma.salaryRecord.update({
      where: { id: req.params.id },
      data,
      include: { employee: { include: { allowances: true } } },
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
