module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.jsx?$': 'babel-jest'
  },
  testMatch: ['**/tests/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/authReturn.test.js'],
  moduleFileExtensions: ['js', 'mjs', 'cjs', 'json'],
  collectCoverageFrom: ['server/**/*.js', '!server/data/**'],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 180000,
  setupFiles: ['<rootDir>/tests/configureMongoMemory.cjs'],
  transformIgnorePatterns: [
    '/node_modules/'
  ]
};
