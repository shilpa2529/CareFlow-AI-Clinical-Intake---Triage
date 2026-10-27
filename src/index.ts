import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import syntheticCases from '../data/synthetic_patients.json';
import { getDb } from './db/queries';
import { analyzeRoute } from './routes/analyze';
import { followupRoute } from './routes/followup';
import { intakeRoute } from './routes/intake';
import { labRoute } from './routes/lab';
import { rateLimiter } from './services/ratelimit';
import { MEDICAL_DISCLAIMER } from './services/safety';
import { AppEnv } from './types';

export const app = new Hono<{ Bindings: AppEnv }>();

// Global middleware
app.use('*', logger());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-api-key']
  })
);

// Mount API routes
app.route('/api', intakeRoute);
app.route('/api', analyzeRoute);
app.route('/api', followupRoute);
app.route('/api', labRoute);

// GET /api/health - Health check endpoint
app.get('/api/health', (c) => {
  const apiKey = c.env?.ANTHROPIC_API_KEY || (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : '');
  const model = c.env?.CLAUDE_MODEL || (typeof process !== 'undefined' ? process.env.CLAUDE_MODEL : 'claude-3-5-sonnet-20241022');
  const isDemoMode = !apiKey || apiKey.includes('your_key_here');

  return c.json({
    status: 'healthy',
    service: 'CareFlow AI',
    version: '1.0.0',
    demo_mode: isDemoMode,
    model,
    disclaimer: MEDICAL_DISCLAIMER,
    rate_limits: rateLimiter.getStats(),
    timestamp: new Date().toISOString()
  });
});

// GET /api/presets - Synthetic patient presets for UI dropdown
app.get('/api/presets', (c) => {
  return c.json({
    success: true,
    presets: syntheticCases.map((sc) => ({
      id: sc.id,
      name: sc.name,
      category: sc.category,
      raw_text: sc.raw_text,
      expected_urgency: sc.expected_urgency,
      has_pii: sc.has_pii,
      is_adversarial: sc.is_adversarial
    }))
  });
});

// Fallback index
app.get('/', (c) => {
  return c.redirect('/index.html');
});

export default app;
