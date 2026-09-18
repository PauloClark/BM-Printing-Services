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
  const password = 'johnedubasxd11';
  return User.findOneAndUpdate(
    { email: 'johnexsdee69@gmail.com' },
    { password: password },
    { new: true }
  ).then(user => {
    console.log('Updated user password length:', user.password.length);
    console.log('Password starts with $2b$10$:', user.password.startsWith());
    console.log('Role:', user.role);
    console.log('Email:', user.email);
    process.exit(0);
  });
}).catch(err => { console.error(err); process.exit(1); });