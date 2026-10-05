export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Ready for Pickup', 'Picked Up', 'Completed', 'Cancelled'];
export const STAFF_ROLES = ['admin', 'staff'];
export const isOrderStaff = user => STAFF_ROLES.includes(user?.role);
export const displayOrderStatus = status => ({
  Quoted: 'Pending', 'Payment Pending': 'Confirmed', Paid: 'Confirmed',
  Queued: 'Confirmed', 'In Production': 'Processing', 'Quality Check': 'Processing', Ready: 'Ready for Pickup'
}[status] || status);
export const nextOrderStatus = status => ({
  Pending: 'Confirmed', Confirmed: 'Processing', Processing: 'Ready for Pickup', 'Ready for Pickup': 'Picked Up'
}[displayOrderStatus(status)]);
export const canTransitionOrder = (from, to) => Boolean(nextOrderStatus(from)) &&
  (to === nextOrderStatus(from) || to === 'Cancelled');
export const ORDER_ACTIONS = { Confirmed: 'Confirm Order', Processing: 'Start Processing',
  'Ready for Pickup': 'Mark as Ready for Pickup', 'Picked Up': 'Confirm Pickup', Completed: 'Mark as Completed' };
