import { Production } from './db.js';
export function productionAccessFilter(user, filter = {}) {
  return {
    ...filter,
    ...(user.role === 'admin' ? {} : { assignedEmployee: user.id })
  };
}

export async function orderAccessFilter(user) {
  if (user.role === 'admin') return {};
  if (user.role === 'staff') {
    if (!user.employeeLinked || !user.employeeActive || user.mustChangePassword) return { $and: [{ orderId: { $in: [] } }] };
    return { $and: [{ orderId: { $in: await Production.distinct('orderId', { phase3: true, assignedEmployee: user.id }) } }] };
  }
  return { $or: [{ customerId: user.id }, ...(user.email ? [{ customerId: null, orderSource: { $ne: 'walk_in' }, customerEmail: user.email.toLowerCase() }] : [])] };
}
