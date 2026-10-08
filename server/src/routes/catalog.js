import { Router } from 'express';
import { all, get, insert, run, tx, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { getSettings, setSetting } from '../lib/settings.js';
import { bad, bool, int, notFound, str } from '../lib/util.js';

const r = Router();
r.use(staffAuth());

const KINDS = ['consult', 'procedure', 'styling'];

function serviceCost(id) {
  return get('SELECT COALESCE(SUM(qty*unit_cost_cents),0) n FROM service_items WHERE service_id=?', id).n;
}
const withMargin = (s) => {
  const cost = serviceCost(s.id);
  return { ...s, cost_cents: cost, margin_cents: s.price_cents - cost, margin_pct: s.price_cents ? ((s.price_cents - cost) / s.price_cents) * 100 : 0 };
};

r.get('/meta', (_req, res) => {
  res.json({
    settings: getSettings(),
    resources: all('SELECT * FROM resources WHERE active=1 ORDER BY sort, id'),
    providers: all(`SELECT id, name, short_name, initials, title FROM staff WHERE role='provider' AND active=1 ORDER BY id`),
    staff: all('SELECT id, name, short_name, initials, role FROM staff WHERE active=1 ORDER BY id'),
    promotions: all('SELECT * FROM promotions WHERE active=1'),
    reasons: {
      reschedule: ['Client requested', 'Provider unavailable', 'Therapist unavailable', 'Illness', 'Running late', 'Other'],
      cancel: ['Client cancelled', 'No longer needed', 'Provider unavailable', 'Duplicate booking', 'Illness', 'Other'],
    },
    referrals: ['Walk-in', 'Online search', 'Friend or family', 'Social media', 'Doctor referral', 'Other'],
  });
});

r.put('/settings', staffAuth('reception'), (req, res) => {
  const allowed = {
    autofill: (v) => String(bool(v)),
    tax_rate_pct: (v) => String(Math.min(30, Math.max(0, +v || 0))),
    cancel_window_hours: (v) => String(Math.max(0, int(v, 'hours'))),
    offer_ttl_min: (v) => String(Math.max(5, int(v, 'minutes'))),
  };
  for (const [k, fn] of Object.entries(allowed)) if (k in req.body) setSetting(k, fn(req.body[k]));
  res.json(getSettings());
});

r.get('/services', (req, res) => {
  const rows = all(`SELECT * FROM services ${req.query.all ? '' : 'WHERE active=1'} ORDER BY active DESC, sort, name`);
  res.json(rows.map((s) => ({
    ...withMargin(s),
    provider_ids: all('SELECT staff_id FROM service_providers WHERE service_id=?', s.id).map((x) => x.staff_id),
  })));
});

r.get('/services/:id', (req, res) => {
  const s = get('SELECT * FROM services WHERE id=?', req.params.id);
  if (!s) throw notFound('Service not found');
  res.json({
    ...withMargin(s),
    provider_ids: all('SELECT staff_id FROM service_providers WHERE service_id=?', s.id).map((x) => x.staff_id),
    items: all(
      `SELECT si.id, si.item_id, si.qty, si.unit_cost_cents, i.name FROM service_items si
       JOIN items i ON i.id=si.item_id WHERE si.service_id=? ORDER BY si.id`, s.id,
    ),
    categories: all('SELECT DISTINCT category FROM services ORDER BY category').map((x) => x.category),
  });
});

function saveService(id, b) {
  const name = str(b.name, 120);
  if (!name) throw bad('Give the service a name');
  if (!KINDS.includes(b.kind)) throw bad('Choose a room type');
  const duration = int(b.duration_min, 'duration');
  if (duration < 5 || duration > 480) throw bad('Duration must be between 5 and 480 minutes');
  const price = int(b.price_cents, 'price');
  if (price < 0) throw bad('Price can’t be negative');
  const row = {
    name, category: str(b.category, 60) || 'General', description: str(b.description, 1000), duration_min: duration,
    price_cents: price, kind: b.kind, sessions_total: b.sessions_total ? int(b.sessions_total, 'sessions') : null,
    provider_pct: Math.min(100, Math.max(0, +b.provider_pct || 0)), assistant_pct: Math.min(100, Math.max(0, +b.assistant_pct || 0)),
    online_bookable: bool(b.online_bookable), active: b.active === undefined ? 1 : bool(b.active),
  };
  return tx(() => {
    let sid = id;
    if (sid) update('services', sid, row);
    else sid = insert('services', { ...row, sort: 99 });
    run('DELETE FROM service_providers WHERE service_id=?', sid);
    for (const p of b.provider_ids ?? []) {
      if (get(`SELECT id FROM staff WHERE id=? AND role='provider'`, p)) insert('service_providers', { service_id: sid, staff_id: +p });
    }
    run('DELETE FROM service_items WHERE service_id=?', sid);
    for (const it of b.items ?? []) {
      if (!get('SELECT id FROM items WHERE id=?', it.item_id)) throw bad('Unknown item');
      const qty = Number(it.qty);
      if (!(qty > 0)) throw bad('Quantities must be greater than zero');
      insert('service_items', { service_id: sid, item_id: +it.item_id, qty, unit_cost_cents: Math.max(0, int(it.unit_cost_cents, 'unit cost')) });
    }
    return sid;
  });
}
r.post('/services', staffAuth('reception'), (req, res) => res.status(201).json({ id: saveService(null, req.body) }));
r.put('/services/:id', staffAuth('reception'), (req, res) => {
  if (!get('SELECT id FROM services WHERE id=?', req.params.id)) throw notFound('Service not found');
  res.json({ id: saveService(+req.params.id, req.body) });
});

r.get('/items', (_req, res) => res.json(all('SELECT * FROM items WHERE active=1 ORDER BY name')));
r.post('/items', staffAuth('reception'), (req, res) => {
  const name = str(req.body.name, 120);
  if (!name) throw bad('Give the item a name');
  const sell = req.body.sell_price_cents == null || req.body.sell_price_cents === '' ? null : int(req.body.sell_price_cents, 'price');
  const id = insert('items', { name, unit_cost_cents: Math.max(0, int(req.body.unit_cost_cents ?? 0, 'cost')), sell_price_cents: sell, active: 1 });
  res.status(201).json(get('SELECT * FROM items WHERE id=?', id));
});

export default r;
