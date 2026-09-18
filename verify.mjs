import './server/db.js';
const { User } = await import('./server/db.js');
const u = await User.findOne({ email: 'johnexsdee69@gmail.com' });
console.log(u ? u.email + ' role: ' + u.role : 'not found');