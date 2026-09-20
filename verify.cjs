const mongoose = require('mongoose');
require('dotenv').config();

(async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';
    await mongoose.connect(uri);
    console.log('Connected to MongoDB');

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

    const email = process.argv[2];
    if (!email) {
      console.error('Usage: node verify.cjs <email>');
      process.exit(1);
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log('User not found');
      process.exit(1);
    }

    console.log('User found:', user.email);
    console.log('Name:', user.name);
    console.log('Role:', user.role);
    console.log('Has password:', !!user.password);
    console.log('Password is hashed:', user.password.startsWith('$2b$') || user.password.startsWith('$2a$'));
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
