const mongoose = require('mongoose');
mongoose.connect('mongodb://127.0.0.1:27017/bmprinting').then(() => {
  const userSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, default: '' },
    password: { type: String, default: '' },
    role: { type: String, enum: ['customer', 'admin', 'manager', 'cashier', 'production'], default: 'customer' },
    createdAt: { type: Date, default: Date.now }
  });
  const User = mongoose.model('User', userSchema);
  return User.findOne({ email: 'johnexsdee69@gmail.com' }).then(user => {
    const pw = user.password;
    console.log('Password value:', pw);
    console.log('Password length:', pw.length);
    console.log('Starts with $2b$10$:', pw.startsWith('$2b$10$'));
    console.log('Role:', user.role);
    console.log('Email:', user.email);
    process.exit(0);
  });
}).catch(err => { console.error(err); process.exit(1); });