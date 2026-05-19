const prisma = require('../config/prisma');
const { OT_DAILY_MULT, OT_SUNDAY_MULT, OT_HOLIDAY_MULT } = require('./attendanceController');

const daysInMonth = (year, month) => new Date(year, month, 0).getDate();

const computeSalary = (employee, attendance, calendarDays, extraAllowances = []) => {
  const presentDays = attendance.filter(a => a.outTime).length;
  const dailyOtMinutes = attendance.filter(a => a.otType === 'daily').reduce((s, a) => s + (a.extraMinutes || 0), 0);
  const sundayOtMinutes = attendance.filter(a => a.otType === 'sunday').reduce((s, a) => s + (a.extraMinutes || 0), 0);
  const holidayOtMinutes = attendance.filter(a => a.otType === 'holiday').reduce((s, a) => s + (a.extraMinutes || 0), 0);

  const basicSalary = employee.basicSalary;
  const perDayBasic = basicSalary / calendarDays;
  const earnedBasic = perDayBasic * presentDays;

  const hourlyRate = basicSalary / (calendarDays * employee.standardHours);
  const dailyOtAmt = (dailyOtMinutes / 60) * hourlyRate * OT_DAILY_MULT;
  const sundayOtAmt = (sundayOtMinutes / 60) * hourlyRate * OT_SUNDAY_MULT;
  const holidayOtAmt = (holidayOtMinutes / 60) * hourlyRate * OT_HOLIDAY_MULT;
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
    const [allAttendance, allExisting] = await Promise.all([
      prisma.attendanceRecord.findMany({
        where: { employeeId: { in: empIds }, date: { gte: monthStart, lte: monthEnd } },
      }),
      prisma.salaryRecord.findMany({
        where: { employeeId: { in: empIds }, month: monthStart },
      }),
    ]);

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
      const calc = computeSalary(emp, attendance, calDays, extraAllowances);

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
    res.json(records);
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
    res.json(records);
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
      const attendance = await prisma.attendanceRecord.findMany({
        where: {
          employeeId: record.employeeId,
          date: {
            gte: new Date(`${ry}-${String(rm).padStart(2, '0')}-01T00:00:00.000Z`),
            lte: new Date(`${ry}-${String(rm).padStart(2, '0')}-${String(rLastDay).padStart(2, '0')}T23:59:59.999Z`),
          },
        },
      });
      const calc = computeSalary(record.employee, attendance, record.calendarDays, extraAllowances);
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
