const prisma = require('../config/prisma');
const { notifyRoles, notifyUser } = require('../utils/createNotifications');

const TYPES = ['ot', 'leave', 'off_swap'];
const parseDateOnly = (v) => {
  if (!v) return null;
  // Keep it a pure calendar day (UTC midnight) so it lines up with attendance /
  // the salary day-by-day loop, which key on the UTC date.
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
};
const fmtDate = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const typeLabel = (t) => (t === 'ot' ? 'OT' : t === 'off_swap' ? 'off-day swap' : 'leave');

const requestInclude = {
  employee: { select: { id: true, name: true, empNumber: true, userId: true } },
  reviewedBy: { select: { id: true, name: true } },
};

const myEmployee = (userId) =>
  prisma.employee.findUnique({ where: { userId }, select: { id: true, name: true } });

// ── Employee self-service ────────────────────────────────────────────────────

exports.createMyRequest = async (req, res) => {
  try {
    const emp = await myEmployee(req.user.id);
    if (!emp) return res.status(404).json({ message: 'No employee record linked to your account' });

    const { type, date, swapWorkedDate, otHours, leavePaid, reason } = req.body;
    if (!TYPES.includes(type)) return res.status(400).json({ message: 'Invalid request type' });
    const d = parseDateOnly(date);
    if (!d) return res.status(400).json({ message: 'A valid date is required' });

    const data = { employeeId: emp.id, type, date: d, reason: (reason || '').trim(), status: 'pending' };
    if (type === 'ot') {
      const h = parseFloat(otHours);
      if (!(h > 0)) return res.status(400).json({ message: 'OT hours must be greater than 0' });
      data.otHours = h;
    } else if (type === 'leave') {
      data.leavePaid = leavePaid !== false;
    } else if (type === 'off_swap') {
      const sw = parseDateOnly(swapWorkedDate);
      if (!sw) return res.status(400).json({ message: 'Pick the off day you actually worked to cover this leave' });
      data.swapWorkedDate = sw;
    }

    const request = await prisma.staffRequest.create({ data, include: requestInclude });
    const detail =
      type === 'ot' ? `${data.otHours}h OT`
        : type === 'leave' ? `${data.leavePaid ? 'paid' : 'unpaid'} leave`
          : 'off-day swap';
    await notifyRoles(['super_admin'], `${emp.name} requested ${detail} for ${fmtDate(d)}`, 'staff_request', request.id);
    res.status(201).json(request);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

exports.getMyRequests = async (req, res) => {
  try {
    const emp = await myEmployee(req.user.id);
    if (!emp) return res.status(404).json({ message: 'No employee record linked to your account' });
    const requests = await prisma.staffRequest.findMany({
      where: { employeeId: emp.id }, include: requestInclude, orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// An employee may withdraw their own request while it is still pending.
exports.cancelMyRequest = async (req, res) => {
  try {
    const emp = await myEmployee(req.user.id);
    if (!emp) return res.status(404).json({ message: 'No employee record linked to your account' });
    const r = await prisma.staffRequest.findUnique({ where: { id: req.params.id } });
    if (!r || r.employeeId !== emp.id) return res.status(404).json({ message: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    await prisma.staffRequest.delete({ where: { id: r.id } });
    res.json({ message: 'Request cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// ── Admin ────────────────────────────────────────────────────────────────────

exports.getRequests = async (req, res) => {
  try {
    const { status, employeeId } = req.query;
    const where = {};
    if (status) where.status = status;
    if (employeeId) where.employeeId = employeeId;
    const [requests, pendingCount] = await Promise.all([
      prisma.staffRequest.findMany({ where, include: requestInclude, orderBy: [{ createdAt: 'desc' }] }),
      prisma.staffRequest.count({ where: { status: 'pending' } }),
    ]);
    res.json({ requests, pendingCount });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Approve / reject — super_admin only (enforced on the route).
exports.reviewRequest = async (req, res) => {
  try {
    const { action, reviewNote } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'action must be "approve" or "reject"' });
    }
    const r = await prisma.staffRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: { select: { id: true, name: true, userId: true } } },
    });
    if (!r) return res.status(404).json({ message: 'Request not found' });
    if (r.status !== 'pending') return res.status(400).json({ message: 'This request has already been reviewed' });

    const status = action === 'approve' ? 'approved' : 'rejected';
    const updated = await prisma.staffRequest.update({
      where: { id: r.id },
      data: { status, reviewNote: (reviewNote || '').trim(), reviewedById: req.user.id, reviewedAt: new Date() },
      include: requestInclude,
    });
    if (r.employee.userId) {
      await notifyUser(
        r.employee.userId,
        `Your ${typeLabel(r.type)} request for ${fmtDate(r.date)} was ${status}`,
        'staff_request', r.id,
      );
    }
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
