const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const {
  getEmployees, getEmployee, getMyEmployee, createEmployee, updateEmployee,
} = require('../controllers/employeeController');
const {
  clockIn, clockOut, getMyAttendance, getTodayRecord,
  getAllAttendance, addAttendance, addMyAttendance, deleteAttendance,
} = require('../controllers/attendanceController');
const {
  computeSalary, getSalaryRecords, getMySalary, updateSalaryRecord,
} = require('../controllers/salaryController');
const {
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
} = require('../controllers/holidayController');
const {
  getOtSettings, updateOtSettings,
} = require('../controllers/otSettingsController');

router.use(protect);

// Employees
router.get('/employees', checkPermission('staff', 'view'), getEmployees);
router.post('/employees', checkPermission('staff', 'create'), createEmployee);
router.get('/employees/me', getMyEmployee);
router.get('/employees/:id', checkPermission('staff', 'view'), getEmployee);
router.put('/employees/:id', checkPermission('staff', 'edit'), updateEmployee);

// Attendance — employee self-service
router.post('/attendance/clock-in', clockIn);
router.post('/attendance/clock-out', clockOut);
router.post('/attendance/my', addMyAttendance);
router.get('/attendance/today', getTodayRecord);
router.get('/attendance/my', getMyAttendance);

// Attendance — admin
router.get('/attendance', checkPermission('staff', 'view'), getAllAttendance);
router.post('/attendance', checkPermission('staff', 'edit'), addAttendance);
router.delete('/attendance/:id', checkPermission('staff', 'delete'), deleteAttendance);

// Salary
router.post('/salary/compute', checkPermission('staff', 'edit'), computeSalary);
router.get('/salary', checkPermission('staff', 'view'), getSalaryRecords);
router.get('/salary/my', getMySalary);
router.put('/salary/:id', checkPermission('staff', 'edit'), updateSalaryRecord);

// Holidays
router.get('/holidays', checkPermission('staff', 'view'), getHolidays);
router.post('/holidays', checkPermission('staff', 'create'), createHoliday);
router.put('/holidays/:id', checkPermission('staff', 'edit'), updateHoliday);
router.delete('/holidays/:id', checkPermission('staff', 'delete'), deleteHoliday);

// OT Settings
router.get('/ot-settings', checkPermission('staff', 'view'), getOtSettings);
router.put('/ot-settings', checkPermission('staff', 'edit'), updateOtSettings);

module.exports = router;
