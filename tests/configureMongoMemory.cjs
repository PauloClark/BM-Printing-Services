// Keep disposable fixtures on the MongoDB 7.0 line used by the application's
// MongoDB 6 driver and Mongoose 8. Override with BM_TEST_MONGOD_VERSION only
// when explicitly testing another server version.
process.env.MONGOMS_VERSION = process.env.BM_TEST_MONGOD_VERSION || '7.0.14';
