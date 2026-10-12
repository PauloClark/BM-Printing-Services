import { app } from '../server.js';
import { connectMongo } from '../server/db.js';

let connection;

export default async function handler(req, res) {
  try {
    connection ||= connectMongo();
    await connection;
    return app(req, res);
  } catch (error) {
    connection = undefined;
    console.error('API startup failed:', error.message);
    return res.status(503).json({ error: 'The service is temporarily unavailable.' });
  }
}
