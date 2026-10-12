import { app } from '../server.js';
import { connectMongo } from '../server/db.js';
import { logMongoStartupFailure } from '../server/mongoDiagnostics.js';
import { apiRequestNeedsMongo, restoreApiPath } from './_requestPath.js';

let connection;

export default async function handler(req, res) {
  try {
    restoreApiPath(req);
    if (apiRequestNeedsMongo(req.url)) {
      connection ||= connectMongo();
      await connection;
    }
    return app(req, res);
  } catch (error) {
    connection = undefined;
    logMongoStartupFailure(error);
    return res.status(503).json({ error: 'The service is temporarily unavailable.' });
  }
}
