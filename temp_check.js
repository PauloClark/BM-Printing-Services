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

    const users = await User.find({}).select('name email role createdAt');
    console.log(`Found ${users.length} users:`);
    users.forEach(u => {
      console.log(`  ${u.name} | ${u.email} | ${u.role} | ${u.createdAt}`);
    });
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
