import { body, param, validationResult } from 'express-validator';

const handleErrors = (message) => (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const fields = errors.array().reduce((acc, err) => {
      acc[err.path] = err.msg;
      return acc;
    }, {});
    return res.status(400).json({ error: message, fields });
  }
  next();
};

// User registration validation
export const userRegister = [
  body('name')
    .trim()
    .notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),

  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6, max: 100 }).withMessage('Password must be at least 6 characters'),

  handleErrors('Registration failed.')
];

// User login validation
export const userLogin = [
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required'),

  handleErrors('Login failed.')
];

// Order creation validation
export const orderCreate = [
  body('customerName')
    .trim()
    .notEmpty().withMessage('Customer name is required')
    .isLength({ max: 100 }).withMessage('Customer name must be less than 100 characters'),

  body('customerEmail')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Valid email is required')
    .normalizeEmail(),

  body('contactNumber')
    .trim()
    .notEmpty().withMessage('Phone number is required')
    .isLength({ min: 8, max: 20 }).withMessage('Phone number must be between 8 and 20 characters'),

  body('items')
    .isArray({ min: 1 }).withMessage('At least one item is required'),

  body('items.*.productName')
    .trim()
    .notEmpty().withMessage('Product name is required'),

  body('items.*.quantity')
    .isInt({ min: 1 }).withMessage('Quantity must be at least 1'),

  body('items.*.unitPrice')
    .isFloat({ min: 0 }).withMessage('Unit price must be a positive number'),

  body('paymentMethod')
    .optional()
    .isLength({ max: 50 }).withMessage('Payment method must be less than 50 characters'),

  body('notes')
    .optional()
    .isLength({ max: 500 }).withMessage('Notes must be less than 500 characters'),

  handleErrors('Invalid order information.')
];

// Status update validation
export const statusUpdate = [
  body('status')
    .trim()
    .notEmpty().withMessage('Status is required')
    .isIn(['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'])
    .withMessage('Invalid status value'),

  handleErrors('Invalid status update.')
];

// Order ID param validation
export const orderIdParam = [
  param('orderId')
    .trim()
    .notEmpty().withMessage('Order ID is required')
    .isLength({ min: 1, max: 50 }).withMessage('Order ID must be between 1 and 50 characters'),

  handleErrors('Invalid order ID.')
];

// User ID param validation
export const userIdParam = [
  param('userId')
    .trim()
    .notEmpty().withMessage('User ID is required')
    .isLength({ min: 1, max: 50 }).withMessage('User ID must be between 1 and 50 characters'),

  handleErrors('Invalid user ID.')
];

// Product creation validation
export const productCreate = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ max: 100 }).withMessage('Product name must be less than 100 characters'),

  body('price')
    .isFloat({ min: 0 }).withMessage('Price must be a positive number'),

  body('category')
    .optional()
    .isLength({ max: 50 }).withMessage('Category must be less than 50 characters'),

  body('stock')
    .optional()
    .isInt({ min: 0 }).withMessage('Stock must be a non-negative integer'),

  body('lowStockThreshold')
    .optional()
    .isInt({ min: 0 }).withMessage('Low stock threshold must be a non-negative integer'),

  handleErrors('Invalid product data.')
];
