import('./server.js', { assert: { type: 'module' } })
  .then(mod => {
    console.log('Server module loaded successfully');
  })
  .catch(err => {
    console.error('Failed to load server module:', err.message);
  });