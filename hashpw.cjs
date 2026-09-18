const bcrypt = require('bcryptjs');
const password = 'johnedubasxd123';
const hash = bcrypt.hashSync(password, 10);
console.log('Hash:', hash);
console.log('Hash length:', hash.length);