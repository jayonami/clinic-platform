import { Router } from 'express';
import { get } from '../db.js';
import { checkPin, staffAuth, staffToken } from '../lib/auth.js';
import { rateLimit } from '../lib/rate.js';
import { HttpError, str } from '../lib/util.js';

const r = Router();

r.post('/login', rateLimit('login', 12, 15 * 60e3), (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const user = get('SELECT * FROM staff WHERE lower(email)=? AND active=1', email);
  if (!user || !checkPin(str(req.body.pin, 40), user.pin_hash)) throw new HttpError(401, 'Wrong email or PIN');
  const { pin_hash, ...safe } = user;
  void pin_hash;
  res.json({ token: staffToken(user.id), user: safe });
});

r.get('/me', staffAuth(), (req, res) => res.json({ user: req.user }));

export default r;
