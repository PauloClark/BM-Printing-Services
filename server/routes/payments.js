import { Order } from '../db.js';
import { requireOrderAuth } from '../middleware/auth.js';

const customerOnly = (req, res, next) => req.user?.role === 'customer'
  ? next() : res.status(403).json({ error: 'Customer access is required.' });

export default function paymentRoutes(app) {
  app.post('/api/payments/quote', requireOrderAuth, customerOnly, async (_req, res) => {
    res.status(410).json({ error: 'Online checkout has been removed. Use the manual payment flow instead.' });
  });

  app.post('/api/payments/create', requireOrderAuth, customerOnly, async (_req, res) => {
    res.status(410).json({ error: 'Online checkout has been removed. Use the manual payment flow instead.' });
  });
}
