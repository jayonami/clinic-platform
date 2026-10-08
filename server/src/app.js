import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib/util.js';
import { sseHandler, broadcast } from './lib/realtime.js';
import { staffAuth } from './lib/auth.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import catalog from './routes/catalog.js';
import schedule from './routes/schedule.js';
import waitlist from './routes/waitlist.js';
import clients from './routes/clients.js';
import billing from './routes/billing.js';
import staff from './routes/staff.js';
import analytics from './routes/analytics.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // hops of proxies in front (Vercel rewrite + Render = 2)
  app.use(express.json({ limit: '100kb' }));
  app.use((_req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    next();
  });

  // any successful write tells connected screens to refresh
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET') res.on('finish', () => res.statusCode < 400 && broadcast());
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/events', staffAuth(), sseHandler);
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  for (const r of [catalog, schedule, waitlist, clients, billing, analytics]) app.use('/api', r);
  app.use('/api/staff', staff);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  const dist = path.resolve(here, '../../web/dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side' });
  });
  return app;
}
