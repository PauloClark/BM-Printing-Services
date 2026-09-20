const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const readline = require('readline');
require('dotenv').config();

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

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

    const email = await ask('Enter user email: ');
    const newPassword = await ask('Enter new password: ');

    if (!email || !newPassword) {
      console.error('Email and password are required.');
      process.exit(1);
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { password: hashedPassword },
      { new: true }
    );

    if (!user) {
      console.error('User not found.');
      process.exit(1);
    }

    console.log('Updated user:', user.email);
    console.log('Password is now bcrypt-hashed');
    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
