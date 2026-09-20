const bcrypt = require('bcryptjs');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Enter password to hash: ', (password) => {
  if (!password) {
    console.error('No password provided.');
    process.exit(1);
  }
  const hash = bcrypt.hashSync(password, 10);
  console.log('Hash:', hash);
  console.log('Hash length:', hash.length);
  rl.close();
});
