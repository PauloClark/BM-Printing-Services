import { GoogleGenAI } from '@google/genai';
import rateLimit from 'express-rate-limit';
import { businessKnowledgeSystemInstruction } from '../config/businessKnowledge.js';

const MAX_MESSAGE_LENGTH = 2000;

function logGeminiFailure(error, apiKey) {
  const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : 'HTTP unknown';
  const name = String(error?.name || 'Error').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'Error';
  let message = typeof error?.message === 'string' ? error.message : '';
  if (apiKey) message = message.split(apiKey).join('[REDACTED]');
  message = message
    .replace(/AIza[\w-]{20,}/g, '[REDACTED]')
    .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:key|api_key)=)[^&\s"']+/gi, '$1[REDACTED]')
    .slice(0, 400);
  console.error(`[Gemini Chat] Request failed: ${status} ${name}${message ? ` - ${message}` : ''}`);
}

async function generateGeminiReply(message, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: message,
    config: { systemInstruction: businessKnowledgeSystemInstruction }
  });
  return response.text;
}

export default function chatRoutes(app, generateReply = generateGeminiReply) {
  const chatLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'Too many chat requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.post('/api/chat', chatLimiter, async (req, res) => {
    const message = req.body?.message;
    if (typeof message !== 'string') {
      return res.status(400).json({ error: 'Message must be a string.' });
    }

    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      return res.status(413).json({ error: `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.` });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Chat service is currently unavailable.' });
    }

    try {
      const reply = await generateReply(trimmedMessage, apiKey);
      if (typeof reply !== 'string' || !reply.trim()) {
        return res.status(502).json({ error: 'Unable to generate a reply right now.' });
      }
      return res.json({ reply: reply.trim() });
    } catch (error) {
      logGeminiFailure(error, apiKey);
      return res.status(502).json({ error: 'Unable to generate a reply right now.' });
    }
  });
}