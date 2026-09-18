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
  return User.find({}).then(users => {
    users.forEach(u => console.log('Email:', u.email, 'Role:', u.role, 'Password hash starts:', u.password?.substring(0, 30)));
    process.exit(0);
  });
}).catch(err => { console.error(err); process.exit(1); });