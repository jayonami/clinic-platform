import crypto from 'node:crypto';
import { get } from '../db.js';
import { HttpError, token as rand } from './util.js';
import { setting, setSetting } from './settings.js';
import { isDemo } from './demo.js';

function secret() {
  let s = process.env.AUTH_SECRET || (process.env.VERCEL && isDemo() ? 'demo-deployment-secret-fake-data-only' : null) || get("SELECT value FROM settings WHERE key='auth_secret'")?.value;
  if (!s) {
    s = rand(32);
    setSetting('auth_secret', s);
  }
  return s;
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const mac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function sign(payload, ttlSec = 60 * 60 * 12) {
  const body = b64({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec });
  return `${body}.${mac(body)}`;
}
export function verify(tok) {
  if (typeof tok !== 'string') return null;
  const [body, sig] = tok.split('.');
  if (!body || !sig) return null;
  const expect = mac(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

export function hashPin(pin) {
  const salt = crypto.randomBytes(12).toString('hex');
  return `${salt}:${crypto.scryptSync(String(pin), salt, 32).toString('hex')}`;
}
export function checkPin(pin, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(String(pin), salt, 32);
  const s = Buffer.from(hash, 'hex');
  return s.length === h.length && crypto.timingSafeEqual(s, h);
}

const bearer = (req) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  return typeof req.query.token === 'string' ? req.query.token : null; // EventSource can't set headers
};

export const staffAuth = (...roles) => (req, _res, next) => {
  const p = verify(bearer(req));
  if (p?.t !== 'staff') throw new HttpError(401, 'Please sign in');
  const user = get('SELECT id, name, short_name, initials, email, role, title FROM staff WHERE id=? AND active=1', p.id);
  if (!user) throw new HttpError(401, 'Please sign in');
  if (roles.length && !roles.includes(user.role)) throw new HttpError(403, 'Not allowed for your role');
  req.user = user;
  next();
};

export const clientAuth = (req, _res, next) => {
  const p = verify(bearer(req));
  if (p?.t !== 'client') throw new HttpError(401, 'Please sign in');
  const client = get('SELECT * FROM clients WHERE id=?', p.id);
  if (!client) throw new HttpError(401, 'Please sign in');
  req.client = client;
  next();
};

export const clientToken = (clientId) => sign({ t: 'client', id: clientId }, 60 * 60 * 24 * 90);
export const staffToken = (id) => sign({ t: 'staff', id });
export { setting };
