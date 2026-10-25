import { publicAsset } from '../utils/assets.js';

export const PAYMENT_METHODS = [
  { id: 'cash', backendValue: 'cash', name: 'Cash - Pay at Shop', accountName: 'Pay in person at BM Printing Services', accountNumber: '' },
  {
    id: 'gcash',
    backendValue: 'GCash',
    name: 'GCash',
    logo: publicAsset('icons/payments/gcash.png'),
    accountName: 'Paulo Jimenez',
    accountNumber: '09772730486'
  },
  {
    id: 'maya',
    backendValue: 'Maya',
    name: 'Maya',
    logo: publicAsset('icons/payments/maya.png'),
    accountName: 'Paulo Jimenez',
    accountNumber: '09772730486'
  },
  {
    id: 'bpi',
    backendValue: 'BPI',
    name: 'BPI',
    logo: publicAsset('icons/payments/bpi.png'),
    accountName: 'Paulo Jimenez',
    accountNumber: '4069811648'
  },
  {
    id: 'gotyme',
    backendValue: 'GoTyme',
    name: 'GoTyme Bank',
    logo: publicAsset('icons/payments/gotyme.png'),
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
