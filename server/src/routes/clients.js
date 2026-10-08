import { Router } from 'express';
import { all, get, insert, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { APPT_SQL, visitsCount } from '../lib/appointments.js';
import { bad, conflict, need, normPhone, notFound, nowLocal, str } from '../lib/util.js';
import { sms } from '../lib/notify.js';

const r = Router();
r.use(staffAuth());

const LANGS = ['English', 'Español', 'Other'];

export function moneyStats(clientId) {
  const year = String(new Date().getFullYear());
  const billed = all(
    `SELECT total_cents, paid_cents, service_date FROM invoices WHERE client_id=? AND status IN ('open','partial','paid')`, clientId,
  );
  const lifetime = billed.reduce((s, i) => s + i.total_cents, 0);
  return {
    lifetime_cents: lifetime,
    this_year_cents: billed.filter((i) => i.service_date.startsWith(year)).reduce((s, i) => s + i.total_cents, 0),
    outstanding_cents: billed.reduce((s, i) => s + Math.max(0, i.total_cents - i.paid_cents), 0),
    avg_ticket_cents: billed.length ? Math.round(lifetime / billed.length) : 0,
    invoices: billed.length,
  };
}

r.get('/clients', (req, res) => {
  const q = str(req.query.q, 60).toLowerCase();
  const digits = normPhone(q);
  const rows = all(
    `SELECT c.id, c.name, c.phone, c.email, c.language, c.created_at,
       (SELECT COUNT(*) FROM appointments a WHERE a.client_id=c.id AND a.status='done') AS visits,
       (SELECT MAX(start_at) FROM appointments a WHERE a.client_id=c.id AND a.status='done') AS last_visit,
       (SELECT COALESCE(SUM(total_cents-paid_cents),0) FROM invoices i WHERE i.client_id=c.id AND i.status IN ('open','partial')) AS outstanding_cents
     FROM clients c
     ${q ? `WHERE lower(c.name) LIKE ? ${digits.length >= 3 ? 'OR c.phone_norm LIKE ?' : ''}` : ''}
     ORDER BY c.name LIMIT 100`,
    ...(q ? (digits.length >= 3 ? [`%${q}%`, `%${digits}%`] : [`%${q}%`]) : []),
  );
  res.json(rows);
});

r.get('/clients/:id', (req, res) => {
  const c = get('SELECT * FROM clients WHERE id=?', req.params.id);
  if (!c) throw notFound('Client not found');
  const { token, ...client } = c;
  void token;
  const visits = all(
    `${APPT_SQL} WHERE a.client_id=? AND (a.status IN ('done','no_show') OR a.id IN (SELECT appointment_id FROM invoices WHERE client_id=? AND status!='quotation'))
     ORDER BY a.start_at DESC`, c.id, c.id,
  ).map((a) => {
    const inv = get('SELECT id, total_cents, paid_cents, status FROM invoices WHERE appointment_id=?', a.id);
    const note = get('SELECT notes FROM consultations WHERE appointment_id=?', a.id)?.notes || null;
    return {
      notes: note,
      id: a.id, date: a.start_at.slice(0, 10), service_name: a.service_name, session_no: a.session_no, sessions_total: a.sessions_total,
      provider_short: a.provider_short, status: a.status, invoice_id: inv?.id ?? null,
      amount_cents: inv?.total_cents ?? a.service_price_cents,
      invoice_status: !inv ? null : inv.status === 'paid' ? 'paid' : inv.status === 'quotation' ? 'quote' : 'outstanding',
      balance_cents: inv ? Math.max(0, inv.total_cents - inv.paid_cents) : 0,
    };
  });
  const upcoming = all(
    `${APPT_SQL} WHERE a.client_id=? AND a.status IN ('booked','checked_in') AND a.start_at>=? ORDER BY a.start_at`, c.id, nowLocal().slice(0, 10),
  );
  res.json({
    client: { ...client, visits: visitsCount(c.id) }, visits, upcoming, money: moneyStats(c.id),
    messages: all('SELECT * FROM messages WHERE client_id=? ORDER BY created_at DESC, id DESC LIMIT 15', c.id),
  });
});

function clientRow(b, existing) {
  const name = str(b.name, 100);
  need(name, 'Enter a name');
  const phone = str(b.phone, 30);
  need(normPhone(phone).length === 10, 'Enter a 10-digit phone number');
  const email = str(b.email, 120);
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw bad('That email doesn’t look right');
  const dupe = get('SELECT id FROM clients WHERE phone_norm=? AND id!=?', normPhone(phone), existing?.id ?? -1);
  if (dupe) throw conflict('Another client already has that phone number');
  return {
    name, phone, phone_norm: normPhone(phone), email: email || null,
    language: LANGS.includes(b.language) ? b.language : 'English', referred_by: str(b.referred_by, 60) || null,
  };
}

r.post('/clients', staffAuth('reception'), (req, res) => {
  const id = insert('clients', { ...clientRow(req.body), created_at: nowLocal() });
  res.status(201).json(get('SELECT id, name, phone, email, language FROM clients WHERE id=?', id));
});

r.patch('/clients/:id', staffAuth('reception'), (req, res) => {
  const c = get('SELECT * FROM clients WHERE id=?', req.params.id);
  if (!c) throw notFound('Client not found');
  update('clients', c.id, clientRow({ ...c, ...req.body }, c));
  res.json(get('SELECT id, name, phone, email, language FROM clients WHERE id=?', c.id));
});

r.post('/clients/:id/message', staffAuth('reception'), (req, res) => {
  const body = str(req.body.body, 480);
  need(body, 'Write a message first');
  need(get('SELECT id FROM clients WHERE id=?', req.params.id), 'Client not found');
  const id = sms(+req.params.id, 'manual', body, req.user.id);
  res.status(201).json(get('SELECT * FROM messages WHERE id=?', id));
});

export default r;
