import mongoose from 'mongoose';
import { AuditLog, Employee, Production } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { authorizeExistingStaffAccount, listAssignableStaff, listStaffAccountCandidates, verifyAssignableStaff } from '../staffDirectory.js';

const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const allowedPermissions = new Set(['view_assigned_jobs', 'update_job_progress']);
const permissions = value => Array.isArray(value) ? [...new Set(value.filter(item => allowedPermissions.has(item)))] : ['view_assigned_jobs', 'update_job_progress'];
const accountId = employee => employee.supabaseUserId || employee.linkedUserId || null;
const findLinkedEmployees = () => Employee.find({ $or: [
  { supabaseUserId: { $type: 'string', $ne: '' } }, { linkedUserId: { $type: 'string', $ne: '' } }
] }).select('supabaseUserId linkedUserId name').lean();
const view = (employee, jobs = {}) => ({
  id: String(employee._id), name: employee.name, email: employee.email || employee.linkedEmail || '', phone: employee.phone || '',
  position: employee.employeeRole || employee.position || 'Production Staff', active: employee.active !== false && !employee.archived,
  supabaseUserId: accountId(employee), linked: Boolean(accountId(employee)), permissions: employee.permissions || ['view_assigned_jobs', 'update_job_progress'],
  mustChangePassword: Boolean(employee.mustChangePassword),
  assignedJobs: jobs[String(accountId(employee))] || 0, createdAt: employee.createdAt, updatedAt: employee.updatedAt
});
const restorationRoster = new Map([
  ['Bobby Abar Marces', 'Manager'], ['Concepcion Nisperos Marces', 'Secretary'],
  ['Marian Hanginon', 'Marketing'], ['Angelica Dumalat', 'Utility'],
  ['Jillian Abar Marces', 'Operator'], ['Eddie Abar Marces Jr.', 'Layout Artist'],
  ['Roland Plaza', 'Sewing Worker']
]);
const sharedStaffEmail = 'staff@bmprinting.com';

export default function employeeRoutes(app) {
  app.post('/api/employees/restore-roster', requireAdmin, async (req, res) => {
    try {
      const rows = Array.isArray(req.body?.employees) ? req.body.employees : [];
      if (rows.length !== restorationRoster.size) return res.status(400).json({ error: 'Provide all seven roster entries with their selected existing authentication account IDs.' });
      const accountIds = rows.map(row => clean(row.supabaseUserId, 200));
      if (accountIds.some(id => !id) || new Set(accountIds).size !== accountIds.length) return res.status(400).json({ error: 'Each employee must use a different existing authentication account.' });
      if (rows.some(row => restorationRoster.get(clean(row.name)) !== clean(row.position, 100))) return res.status(400).json({ error: 'The employee names and positions must exactly match the approved restoration roster.' });
      const accounts = await Promise.all(accountIds.map(verifyAssignableStaff));
      if (accounts.some(account => account.email?.toLowerCase() === sharedStaffEmail)) {
        return res.status(400).json({ error: 'The original shared staff account cannot be linked to the seven-person employee roster.' });
      }
      const plan = [];
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index], account = accounts[index], name = clean(row.name), position = clean(row.position, 100);
        const email = account.email?.toLowerCase();
        if (!email) return res.status(409).json({ error: `The selected account for ${name} has no email address.` });
        const conflict = await Employee.findOne({ $or: [{ name }, { email }, { supabaseUserId: account.id }] }).lean();
        if (conflict && (conflict.name !== name || conflict.email !== email || conflict.supabaseUserId !== account.id)) {
          return res.status(409).json({ error: `The employee name, email, or selected account for ${name} conflicts with an existing record.` });
        }
        plan.push({ name, position, email, supabaseUserId: account.id, action: conflict ? 'already-restored' : 'create' });
      }
      if (req.body?.confirm !== 'RESTORE_APPROVED_ROSTER') return res.json({ dryRun: true, plan: plan.map(({ supabaseUserId, ...item }) => item) });
      const restored = [];
      for (const item of plan) {
        const employee = await Employee.findOneAndUpdate(
          { $or: [{ email: item.email }, { supabaseUserId: item.supabaseUserId }] },
          { $setOnInsert: { name: item.name, email: item.email, position: item.position, active: true, supabaseUserId: item.supabaseUserId, mustChangePassword: true, permissions: ['view_assigned_jobs','update_job_progress'], createdBy: req.user.id } },
          { new: true, upsert: true, runValidators: true }
        );
        restored.push(view(employee));
      }
      await AuditLog.create({ userId: req.user.id, userName: req.user.name || req.user.email || '', role: req.user.role, action: 'RESTORE_EMPLOYEE_ROSTER', module: 'Employees', resourceType: 'Employee', resourceId: 'approved-seven-person-roster', newValue: { count: restored.length }, timestamp: new Date() });
      res.json({ dryRun: false, employees: restored });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'An email or authentication account is already linked.' });
      res.status(error.status || 500).json({ error: error.message || 'Unable to restore the employee roster.' });
    }
  });
  app.get('/api/employees/auth-accounts', requireAdmin, async (_req, res) => {
    try {
      const [accounts, linked] = await Promise.all([
        listAssignableStaff(),
        findLinkedEmployees()
      ]);
      const owners = new Map(linked.map(item => [accountId(item), { employeeId: String(item._id), employeeName: item.name }]));
      res.json({ accounts: accounts.map(account => ({ ...account, linkedEmployee: owners.get(account.id) || null })) });
    } catch (error) { res.status(error.status || 503).json({ error: error.message || 'Unable to load staff accounts.' }); }
  });
  app.get('/api/employees/auth-account-candidates', requireAdmin, async (_req, res) => {
    try {
      const [accounts, linked] = await Promise.all([
        listStaffAccountCandidates(),
        findLinkedEmployees()
      ]);
      const owners = new Map(linked.map(item => [accountId(item), { employeeId: String(item._id), employeeName: item.name }]));
      res.json({ accounts: accounts.map(account => ({ ...account, linkedEmployee: owners.get(account.id) || null })) });
    } catch (error) { res.status(error.status || 503).json({ error: error.message || 'Unable to load existing account candidates.' }); }
  });
  app.post('/api/employees/auth-accounts/authorize', requireAdmin, async (req, res) => {
    try {
      const id = clean(req.body?.userId, 80), email = clean(req.body?.email, 254).toLowerCase();
      const alreadyLinked = await Employee.findOne({ $or: [{ supabaseUserId: id }, { linkedUserId: id }] }).select('name').lean();
      if (alreadyLinked) return res.status(409).json({ error: `This account is already linked to ${alreadyLinked.name}.` });
      const account = await authorizeExistingStaffAccount({ id, email });
      await AuditLog.create({ userId: req.user.id, userName: req.user.name || req.user.email || '', role: req.user.role,
        action: 'STAFF_ACCOUNT_AUTHORIZED', module: 'Employees', resourceType: 'SupabaseUser', resourceId: account.id,
        previousValue: { role: account.previousRole }, newValue: { role: 'staff', email: account.email }, timestamp: new Date() });
      delete account.previousRole;
      res.json({ account });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'This authentication account is already linked to an employee.' });
      res.status(error.status || 503).json({ error: error.message || 'Unable to authorize this account as staff.' });
    }
  });

  app.get('/api/employees', requireAdmin, async (_req, res) => {
    const [employees, workloads] = await Promise.all([
      Employee.find().sort({ active: -1, name: 1 }),
      Production.aggregate([{ $match: { phase3: true, status: { $nin: ['Ready for Pickup', 'Completed', 'Cancelled'] } } }, { $group: { _id: '$assignedEmployee', count: { $sum: 1 } } }])
    ]);
    const jobs = Object.fromEntries(workloads.map(item => [item._id, item.count]));
    res.json({ employees: employees.map(employee => view(employee, jobs)) });
  });

  app.post('/api/employees', requireAdmin, async (req, res) => {
    try {
      const name = clean(req.body?.name), email = clean(req.body?.email, 254).toLowerCase();
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter an employee name and valid email address.' });
      let account = null;
      if (req.body?.supabaseUserId) account = await verifyAssignableStaff(req.body.supabaseUserId);
      if (req.body?.mustChangePassword && !account) return res.status(400).json({ error: 'Link a staff authentication account before requiring a password change.' });
      const employee = await Employee.create({ name, email, phone: clean(req.body?.phone, 30), position: clean(req.body?.position, 100) || 'Production Staff', active: req.body?.active !== false, supabaseUserId: account?.id || null, mustChangePassword: Boolean(account && req.body?.mustChangePassword), permissions: permissions(req.body?.permissions), createdBy: req.user.id });
      res.status(201).json({ employee: view(employee) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'That email or staff authentication account is already linked.' });
      res.status(error.status || 500).json({ error: error.message || 'Unable to add employee.' });
    }
  });

  app.patch('/api/employees/:id', requireAdmin, async (req, res) => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid employee.' });
      const employee = await Employee.findById(req.params.id);
      if (!employee) return res.status(404).json({ error: 'Employee not found.' });
      // Older employee documents may predate the required creator field. A
      // successful authenticated admin edit is the first reliable audit actor.
      if (!employee.createdBy) employee.createdBy = req.user.id;
      if (!employee.email && employee.linkedEmail) employee.email = employee.linkedEmail;
      if (employee.employeeRole) employee.position = employee.employeeRole;
      for (const field of ['name', 'phone', 'position']) if (req.body?.[field] !== undefined) employee[field] = clean(req.body[field], field === 'phone' ? 30 : 120);
      if (req.body?.email !== undefined) {
        const email = clean(req.body.email, 254).toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
        employee.email = email;
      }
      if (req.body?.active !== undefined) employee.active = Boolean(req.body.active);
      if (req.body?.permissions !== undefined) employee.permissions = permissions(req.body.permissions);
      if (req.body && Object.hasOwn(req.body, 'supabaseUserId')) {
        if (req.body.supabaseUserId) {
          const selectedId = (await verifyAssignableStaff(req.body.supabaseUserId)).id;
          const otherOwner = await Employee.findOne({ _id: { $ne: employee._id }, $or: [{ supabaseUserId: selectedId }, { linkedUserId: selectedId }] }).select('name').lean();
          if (otherOwner) return res.status(409).json({ error: `This authentication account is already linked to ${otherOwner.name}.` });
          employee.supabaseUserId = selectedId;
        } else employee.supabaseUserId = null;
      }
      if (req.body && Object.hasOwn(req.body, 'mustChangePassword')) {
        if (req.body.mustChangePassword && !employee.supabaseUserId) return res.status(400).json({ error: 'Link a staff authentication account before requiring a password change.' });
        employee.mustChangePassword = Boolean(req.body.mustChangePassword);
      }
      if (!employee.supabaseUserId) employee.mustChangePassword = false;
      await employee.save();
      res.json({ employee: view(employee) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'That email or staff authentication account is already linked.' });
      res.status(error.status || 500).json({ error: error.message || 'Unable to update employee.' });
    }
  });
}
