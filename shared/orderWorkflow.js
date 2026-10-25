export const ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Ready for Pickup', 'Picked Up', 'Completed', 'Cancelled'];
export const FULFILLED_ORDER_STATUSES = ['Picked Up', 'Completed'];
export const isFulfilledOrderStatus = status => FULFILLED_ORDER_STATUSES.includes(status);
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

export const PRODUCTION_OVERVIEW_STATUSES = ['Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Delayed'];
export const productionOverviewStatus = status => ({
  Pending: 'Queued', Assigned: 'Queued', Acknowledged: 'Queued', Queueing: 'Queued', Queued: 'Queued',
  'In Progress': 'In Production', 'In Production': 'In Production',
  'Submitted for Review': 'Quality Check', 'Quality Check': 'Quality Check', Approved: 'Quality Check',
  Ready: 'Ready', 'Ready for Pickup': 'Ready',
  Completed: 'Completed', Delayed: 'Delayed', 'Correction Required': 'In Production'
}[status] || status);
