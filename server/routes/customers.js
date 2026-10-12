import { requireAdmin } from '../middleware/auth.js';
import { buildCustomerDirectory } from '../customerDirectory.js';

export default function customerRoutes(app) {
  app.get('/api/search/customers', requireAdmin, async (req, res) => {
    try {
      const query = String(req.query.query || '').trim().toLocaleLowerCase();
      const directory = await buildCustomerDirectory();
      const customers = query ? directory.customers.filter(customer =>
        [customer.name, customer.email].some(value => String(value || '').toLocaleLowerCase().includes(query))) : directory.customers;
      res.set('Cache-Control', 'no-store');
      res.json({ success: true, customers, count: customers.length, warnings: directory.warnings, orphanedOrders: directory.orphanedOrders });
    } catch {
      res.status(503).json({ success: false, error: 'Customer directory could not be loaded. Please retry.' });
    }
  });
}
