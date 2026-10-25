import { FULFILLED_ORDER_STATUSES, isFulfilledOrderStatus } from '../shared/orderWorkflow.js';

describe('fulfilled order status mapping', () => {
  it('recognizes both canonical and historical fulfilled statuses exactly once', () => {
    expect(FULFILLED_ORDER_STATUSES).toEqual(['Picked Up', 'Completed']);
    expect(isFulfilledOrderStatus('Picked Up')).toBe(true);
    expect(isFulfilledOrderStatus('Completed')).toBe(true);
    expect(['Picked Up', 'Completed', 'Ready for Pickup', 'Cancelled'].filter(isFulfilledOrderStatus)).toHaveLength(2);
  });

  it('does not classify uncollected or cancelled orders as fulfilled', () => {
    expect(isFulfilledOrderStatus('Ready for Pickup')).toBe(false);
    expect(isFulfilledOrderStatus('Cancelled')).toBe(false);
  });
});
