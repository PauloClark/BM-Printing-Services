import { body, param, query, param as paramValidator } from 'express-validator';

// Order creation validation
export const orderCreate = [
  body('customer')
    .trim()
    .notEmpty()
    .withMessage('Customer name is required')
    .isLength({ max: 100 })
    .withMessage('Customer name must be less than 100 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('phone')
    .trim()
    .notEmpty()
    .withMessage('Phone number is required')
    .isLength({ min: 8, max: 20 })
    .withMessage('Phone number must be between 8 and 20 characters'),

  body('product')
    .trim()
    .notEmpty()
    .withMessage('Product name is required')
    .isLength({ max: 100 })
    .withMessage('Product name must be less than 100 characters'),

  body('payment')
    .trim()
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(['GCash', 'PayMaya', 'Bank Transfer (BDO/BPI)', 'Credit/Debit Card'])
    .withMessage('Invalid payment method'),

  body('quantity')
    { integer: true }
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),

  body('productId')
    { integer: true }
    .optional()
    .isInt({ min: 1 })
    .withMessage('Product ID must be a positive integer'),

  body('total')
    { float: true }
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Total must be a positive number'),

  body('status')
    .optional()
    .isIn(['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'])
    .withMessage('Invalid status value'),

  body('notes')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Notes must be less than 500 characters'),

  body('userId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('User ID must be less than 50 characters'),

  body('address')
    .optional()
    .isLength({ max: 200 })
    .withMessage('Address must be less than 200 characters'),

  body('unitPrice')
    { float: true }
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Unit price must be a positive number'),

  body('subtotal')
    { float: true }
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Subtotal must be a positive number'),

  body('id')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Order ID must be less than 50 characters'),

  body('orderId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Order ID must be less than 50 characters'),

  body('customerId')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Customer ID must be less than 50 characters'),

  body('paymentMethod')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Payment method must be less than 50 characters'),

  // Chain validation result
  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid order information.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// User registration validation
export const userRegister = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters')
    .isAlpha('en-US', { ignore: ' -' })
    .withMessage('Name must contain only letters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail()
    .custom(async (value) => {
      const existingUser = await User.findOne({ email: value });
      if (existingUser) {
        throw new Error('Email already registered');
      }
      return true;
    }),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6, max: 100 })
    .withMessage('Password must be at least 6 characters'),

  body('confirmPassword')
    .notEmpty()
    .withMessage('Please confirm your password')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Registration failed.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// User login validation
export const userLogin = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Valid email is required')
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Login failed.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// Payment initialization validation
export const paymentInitialize = [
  body('orderId')
    .trim()
    .notEmpty()
    .withMessage('Order ID is required')
    .isLength({ max: 50 })
    .withMessage('Order ID must be less than 50 characters'),

  body('amount')
    { float: true }
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0 })
    .withMessage('Amount must be a positive number'),

  body('paymentMethod')
    .trim()
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(['GCash', 'PayMaya', 'Bank Transfer (BDO/BPI)', 'Credit/Debit Card'])
    .withMessage('Invalid payment method'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Payment initialization failed.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// Order ID param validation
export const orderIdParam = [
  param('orderId')
    .trim()
    .notEmpty()
    .withMessage('Order ID is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Order ID must be between 1 and 50 characters')
    .matches(/^ORD-[A-Z0-9]+$/i)
    .withMessage('Invalid order ID format'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid order ID.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// Status update validation
export const statusUpdate = [
  body('status')
    .trim()
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'])
    .withMessage('Invalid status value'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid status update.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// User ID param validation
export const userIdParam = [
  param('userId')
    .trim()
    .notEmpty()
    .withMessage('User ID is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('User ID must be between 1 and 50 characters'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid user ID.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];

// Quote generation validation
export const quoteGenerate = [
  body('serviceId')
    { integer: true }
    .optional()
    .isInt({ min: 1 })
    .withMessage('Invalid service ID'),

  body('serviceName')
    .trim()
    .optional()
    .notEmpty()
    .withMessage('Service name is required if service ID not provided')
    .isLength({ max: 100 })
    .withMessage('Service name must be less than 100 characters'),

  body('quantity')
    { integer: true }
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),

  body('material')
    .trim()
    .optional()
    .isLength({ max: 50 })
    .withMessage('Material must be less than 50 characters'),

  body('size')
    .trim()
    .optional()
    .isLength({ max: 20 })
    .withMessage('Size must be less than 20 characters'),

  body('designFee')
    { float: true }
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Design fee must be a positive number'),

  body('urgencyFee')
    { float: true }
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Urgency fee must be a positive number'),

  body('discount')
    { float: true }
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Discount must be between 0 and 100'),

  (req, res, next) => {
    const errors = req.validationErrors();
    if (errors) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Quote generation validation failed.',
          fields: errors.reduce((acc, err) => {
            acc[err.path] = err.msg;
            return acc;
          }, {})
        }
      });
    }
    next();
  }
];