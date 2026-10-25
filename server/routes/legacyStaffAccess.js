import { Employee, Order, OrderFile, Production } from '../db.js';
import { orderAccessFilter, productionAccessFilter } from '../orderAccess.js';
import { requireOrderAuth, requireOrderStaff } from '../middleware/auth.js';

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visibleProduction = (production, user) => {
  if (!production || user.role === 'admin') return production;
  const { assignmentHistory, reassignmentNotificationOutbox, exceptionNotificationOutbox, ...safe } = production;
  return safe;
};

export default function legacyStaffAccessRoutes(app, serializeOrder) {
  app.get('/api/production/:orderId', requireOrderStaff, async (req, res) => {
    try {
      const { orderId } = req.params;
      const production = await Production.findOne(productionAccessFilter(req.user, { orderId })).lean();
      const order = (production || req.user.role === 'admin') ? await Order.findOne({ orderId }) : null;

      if (!production && !order) {
        return res.status(404).json({ error: 'Order or production record not found.' });
      }

      return res.json({ success: true, production: visibleProduction(production, req.user), order });
    } catch (error) {
      console.error('Failed to fetch production record:', error);
      return res.status(500).json({ error: 'Unable to fetch production record.' });
    }
  });

  app.get('/api/production', requireOrderStaff, async (req, res) => {
    try {
      const productions = await Production.find(productionAccessFilter(req.user)).sort({ startTime: -1 }).lean();
      const identityIds = [...new Set(productions.map(item => item.assignedEmployee).filter(Boolean))];
      const linkedEmployees = identityIds.length
        ? await Employee.find({ $or: [{ supabaseUserId: { $in: identityIds } }, { linkedUserId: { $in: identityIds } }] }).select('name supabaseUserId linkedUserId').lean()
        : [];
      const employeeNames = new Map(linkedEmployees.flatMap(employee => [employee.supabaseUserId, employee.linkedUserId]
        .filter(Boolean).map(id => [id, employee.name])));
      return res.json({ success: true, productions: productions.map(item => visibleProduction({
        ...item,
        assignedEmployeeName: employeeNames.get(item.assignedEmployee) || item.assignedEmployeeName || (item.assignedEmployee ? 'Unknown employee' : 'Unassigned')
      }, req.user)) });
    } catch (error) {
      console.error('Failed to fetch production records:', error);
      return res.status(500).json({ error: 'Unable to fetch production records.' });
    }
  });

  app.get('/api/files/:orderId', requireOrderAuth, async (req, res) => {
    try {
      const orderId = req.params.orderId.toUpperCase();
      if (req.user.role === 'staff') {
        if (req.authProvider !== 'supabase' || !req.user.employeeLinked || !req.user.employeeActive) {
          return res.status(403).json({ error: 'Your staff account is not linked to an active employee record.' });
        }
        if (req.user.mustChangePassword) return res.status(428).json({ code: 'PASSWORD_CHANGE_REQUIRED', error: 'Change your temporary password before using staff operations.' });
        const production = await Production.exists(productionAccessFilter(req.user, { orderId }));
        if (!production) return res.status(404).json({ error: 'Order files not found.' });
      } else if (req.user.role !== 'admin') {
        const order = await Order.findOne({ orderId, ...(await orderAccessFilter(req.user)) }).select('_id').lean();
        if (!order) return res.status(404).json({ error: 'Order files not found.' });
      }
      const files = await OrderFile.find({ orderId }).sort({ uploadedAt: -1 });
      return res.json({ success: true, files });
    } catch (error) {
      console.error('Failed to fetch files:', error);
      return res.status(500).json({ error: 'Unable to fetch files.' });
    }
  });

  app.get('/api/search/orders', requireOrderStaff, async (req, res) => {
    try {
      const { query, status, customer, startDate, endDate } = req.query;
      const filter = {};

      if (query) {
        const safe = escapeRegex(query);
        filter.$or = [
          { orderId: { $regex: safe, $options: 'i' } },
          { customerName: { $regex: safe, $options: 'i' } }
        ];
      }
      if (status) filter.status = status;
      if (customer) filter.customerName = { $regex: escapeRegex(customer), $options: 'i' };
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
      }

      const accessFilter = req.user.role === 'admin' ? {} : {
        orderId: { $in: await Production.distinct('orderId', productionAccessFilter(req.user)) }
      };
      const orders = await Order.find({ $and: [filter, accessFilter] }).sort({ createdAt: -1 });
      return res.json({ success: true, data: orders.map(serializeOrder) });
    } catch (error) {
      console.error('Search orders failed:', error);
      return res.status(500).json({ success: false, error: 'Search failed.' });
    }
  });
}
