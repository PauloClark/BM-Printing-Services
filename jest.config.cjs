module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  testMatch: ['**/tests/**/*.test.js'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  collectCoverageFrom: ['server/**/*.js', '!server/data/**'],
  coverageDirectory: 'coverage',
  verbose: true,
  forceExit: true,
  detectOpenHandles: true,
  testTimeout: 30000,
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};
