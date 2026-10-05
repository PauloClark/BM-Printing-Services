export const PAYMENT_METHODS = [
  {
    id: 'gcash',
    backendValue: 'GCash',
    name: 'GCash',
    logo: '/icons/payments/gcash.png',
    accountName: 'Paulo Jimenez',
    accountNumber: '09772730486'
  },
  {
    id: 'maya',
    backendValue: 'Maya',
    name: 'Maya',
    logo: '/icons/payments/maya.png',
    accountName: 'Paulo Jimenez',
    accountNumber: '09772730486'
  },
  {
    id: 'bpi',
    backendValue: 'BPI',
    name: 'BPI',
    logo: '/icons/payments/bpi.png',
    accountName: 'Paulo Jimenez',
    accountNumber: '4069811648'
  },
  {
    id: 'gotyme',
    backendValue: 'GoTyme',
    name: 'GoTyme Bank',
    logo: '/icons/payments/gotyme.png',
    accountName: 'Paulo Jimenez',
    accountNumber: '0154 4507 7332'
  }
];

export const getPaymentMethodById = id => PAYMENT_METHODS.find(method => method.id === id) || null;

export const isExactPaymentAmount = (amount, expectedAmount) => {
  const numericAmount = Number(amount);
  const numericExpected = Number(expectedAmount);
  if (!Number.isFinite(numericAmount) || !Number.isFinite(numericExpected)) return false;
  return Math.round(numericAmount * 100) === Math.round(numericExpected * 100);
};
