import { HttpError } from './util.js';

const hits = new Map();
/** Tiny in-memory limiter: `limit` hits per `windowMs` per ip+name. */
export const rateLimit = (name, limit, windowMs) => (req, _res, next) => {
  const key = `${name}:${req.ip}`;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) throw new HttpError(429, 'Too many attempts — please wait a few minutes and try again');
  arr.push(now);
  hits.set(key, arr);
  next();
};
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();
