const prisma = require('../config/prisma');

const employeeInclude = {
  allowances: true,
  user: { select: { id: true, name: true, email: true } },
};

const generateEmpNumber = async () => {
  const last = await prisma.employee.findFirst({ orderBy: { empNumber: 'desc' } });
  if (!last) return 'EMP001';
  const num = parseInt(last.empNumber.replace('EMP', ''), 10) + 1;
  return `EMP${String(num).padStart(3, '0')}`;
};

exports.getEmployees = async (req, res) => {
  try {
    const { active } = req.query;
    const where = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    const employees = await prisma.employee.findMany({
      where,
      include: employeeInclude,
      orderBy: { empNumber: 'asc' },
    });
    res.json(employees);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getEmployee = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: employeeInclude,
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    res.json(employee);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getMyEmployee = async (req, res) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { userId: req.user.id },
      include: employeeInclude,
    });
    if (!employee) return res.status(404).json({ message: 'No employee record linked to your account' });
    res.json(employee);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    const { name, basicSalary, shiftStart, shiftEnd, standardHours, userId, allowances = [] } = req.body;
    const empNumber = await generateEmpNumber();
    const employee = await prisma.employee.create({
      data: {
        empNumber,
        name,
        basicSalary: parseFloat(basicSalary),
        shiftStart,
        shiftEnd,
        standardHours: parseFloat(standardHours),
        userId: userId || null,
        allowances: {
          create: allowances.map(a => ({ name: a.name, amount: parseFloat(a.amount) })),
        },
      },
      include: employeeInclude,
    });
    res.status(201).json(employee);
  } catch (error) {
    if (error.code === 'P2002') return res.status(400).json({ message: 'This user is already linked to another employee' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    const { name, basicSalary, shiftStart, shiftEnd, standardHours, userId, isActive, allowances } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (basicSalary !== undefined) data.basicSalary = parseFloat(basicSalary);
    if (shiftStart !== undefined) data.shiftStart = shiftStart;
    if (shiftEnd !== undefined) data.shiftEnd = shiftEnd;
    if (standardHours !== undefined) data.standardHours = parseFloat(standardHours);
    if (userId !== undefined) data.userId = userId || null;
    if (isActive !== undefined) data.isActive = isActive;

    if (allowances !== undefined) {
      await prisma.employeeAllowance.deleteMany({ where: { employeeId: req.params.id } });
      data.allowances = {
        create: allowances.map(a => ({ name: a.name, amount: parseFloat(a.amount) })),
      };
    }

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data,
      include: employeeInclude,
    });
    res.json(employee);
  } catch (error) {
    if (error.code === 'P2025') return res.status(404).json({ message: 'Employee not found' });
    if (error.code === 'P2002') return res.status(400).json({ message: 'This user is already linked to another employee' });
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
