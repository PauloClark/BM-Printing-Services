import { Employee } from '../db.js';
import { requireOrderAuth } from '../middleware/auth.js';
import { updateStaffPassword } from '../staffDirectory.js';

export default function staffPasswordRoutes(app, authLimiter, { updateStaffPasswordFn = updateStaffPassword } = {}) {
  app.patch('/api/auth/staff/password', authLimiter, requireOrderAuth, async (req, res) => {
    if (req.authProvider !== 'supabase' || req.user.role !== 'staff') return res.status(403).json({ error: 'A staff account is required.' });
    const newPassword = req.body?.newPassword;
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100) return res.status(400).json({ error: 'Password must contain 8–100 characters.' });
    try {
      const employee = await Employee.findOne({ $or: [{ supabaseUserId: req.user.id }, { linkedUserId: req.user.id }], active: true, archived: { $ne: true } });
      if (!employee) return res.status(403).json({ error: 'Your staff account is not linked to an active employee record.' });
      await updateStaffPasswordFn(req.user.id, newPassword);
      if (employee.mustChangePassword) await Employee.updateOne({ _id: employee._id }, { $set: { mustChangePassword: false, passwordChangedAt: new Date() } });
      res.json({ success: true, mustChangePassword: false });
    } catch (error) {
      res.status(error.status || 503).json({ error: error.message || 'Unable to update the staff password.' });
    }
  });
}
