import { createClient } from '@supabase/supabase-js';
import { roleFromSupabaseUser } from '../shared/roles.js';
import { Order, User } from './db.js';

const text = value => typeof value === 'string' ? value.trim() : '';
const publicCustomer = (id, values = {}) => ({
  id, name: text(values.name) || 'Customer', email: text(values.email), phone: text(values.phone),
  role: 'customer', accountType: values.accountType || 'Customer', status: values.status || 'Active',
  createdAt: values.createdAt || null, totalOrders: Number(values.totalOrders || 0), source: values.source || 'unknown'
});

async function listSupabaseCustomers() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase customer directory is not configured.'), { code: 'SUPABASE_DIRECTORY_UNAVAILABLE' });
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const users = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw Object.assign(new Error('Supabase customer accounts could not be loaded.'), { code: 'SUPABASE_DIRECTORY_UNAVAILABLE' });
    users.push(...data.users);
    if (data.users.length < 100) break;
  }
  return users.filter(user => roleFromSupabaseUser(user) === 'customer' && !user.deleted_at).map(mapSupabaseCustomer);
}

export function mapSupabaseCustomer(user) {
  const metadata = user.user_metadata || {};
  const providers = user.app_metadata?.providers || [user.app_metadata?.provider].filter(Boolean);
  const provider = providers.includes('google') ? 'Google' : user.phone && !user.email ? 'Phone' : 'Email';
  const banned = user.banned_until && new Date(user.banned_until) > new Date();
  return publicCustomer(user.id, {
    name: metadata.full_name || metadata.name || user.email || user.phone,
    email: user.email, phone: user.phone || metadata.phone,
    accountType: `${provider} account`, status: banned ? 'Suspended' : user.email && !user.email_confirmed_at ? 'Pending verification' : 'Active',
    createdAt: user.created_at, source: 'supabase'
  });
}

export async function buildCustomerDirectory() {
  const [legacyUsers, orders] = await Promise.all([
    User.find({ role: 'customer' }).select('id name email phone createdAt role').lean(),
    Order.find({}).select('customerId customerName customerEmail contactNumber createdAt').sort({ createdAt: 1 }).lean()
  ]);
  const directory = new Map(legacyUsers.map(user => [user.id, publicCustomer(user.id, {
    ...user, accountType: 'Legacy account', source: 'mongodb'
  })]));
  const warnings = [];
  try {
    for (const customer of await listSupabaseCustomers()) {
      const existing = directory.get(customer.id);
      directory.set(customer.id, existing ? { ...existing, ...customer, totalOrders: existing.totalOrders } : customer);
    }
  } catch (error) {
    warnings.push({ code: error.code || 'SUPABASE_DIRECTORY_UNAVAILABLE', message: 'Supabase-only accounts without orders may be omitted until the Auth Admin directory is configured.' });
  }
  let orphanedOrders = 0;
  for (const order of orders) {
    if (!order.customerId) { orphanedOrders += 1; continue; }
    const existing = directory.get(order.customerId);
    if (existing) {
      existing.totalOrders += 1;
      if (!existing.phone && order.contactNumber) existing.phone = order.contactNumber;
      if (!existing.createdAt || order.createdAt < existing.createdAt) existing.createdAt = order.createdAt;
    } else {
      directory.set(order.customerId, publicCustomer(order.customerId, {
        name: order.customerName, email: order.customerEmail, phone: order.contactNumber,
        accountType: 'Authenticated order account', status: 'Order-linked', createdAt: order.createdAt,
        totalOrders: 1, source: 'order'
      }));
    }
  }
  return { customers: [...directory.values()].sort((a, b) => a.name.localeCompare(b.name)), warnings, orphanedOrders };
}
