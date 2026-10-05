import rateLimit from 'express-rate-limit';
import { verifyTurnstileServerToken, verifyWithCloudflare } from '../turnstileVerify.js';

const MAX_TOKEN_LENGTH = 2048;

export default function turnstileRoutes(app, verifyToken = verifyWithCloudflare) {
  const verifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { success: false, error: 'Too many verification attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/turnstile/verify', verifyLimiter, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !token.trim() || token.length > MAX_TOKEN_LENGTH) {
      return res.status(400).json({ success: false });
    }

    const result = await verifyTurnstileServerToken(token, { verifyToken });
    if (result.ok) return res.json({ success: true });
    // Preserves the existing contract: a rejected or missing token returns a
    // bare 400, and only an unavailable verifier returns explanatory copy.
    if (result.status === 400) return res.status(400).json({ success: false });
    return res.status(result.status).json({ success: false, error: result.message });
  });
}