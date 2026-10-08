import { Router } from 'express';
import { all, get, insert, tx } from '../db.js';
import { clientAuth, clientToken } from '../lib/auth.js';
import { getSettings, setting } from '../lib/settings.js';
import { APPT_SQL, apptById, setStatus, timeOfDayRange } from '../lib/appointments.js';
import { invoiceDetail, recordPayment, refreshInvoice } from '../lib/billing.js';
import { cancelAppointment } from './schedule.js';
import { offerByToken, respondOffer } from '../lib/waitlist.js';
import { rateLimit } from '../lib/rate.js';
import { clinicName, fmtDay, fmtTime12, logEvent, notifyStaff, sms } from '../lib/notify.js';
import {
  HttpError, addDays, conflict, isDate, minutesBetween, need, normPhone, notFound, nowLocal, str, todayStr,
} from '../lib/util.js';
import crypto from 'node:crypto';
import { isDemo } from '../lib/demo.js';

const r = Router();

r.get('/config', (_req, res) => {
  const s = getSettings();
  res.json({
    brand_name: s.brand_name, clinic_name: s.clinic_name, open: s.open_time, close: s.close_time,
    time_windows: timeOfDayRange, cancel_window_hours: +s.cancel_window_hours, dev: isDemo(),
  });
});

r.get('/services', (_req, res) => {
  res.json(all(`SELECT id, name, category, duration_min, price_cents, sessions_total FROM services WHERE active=1 AND online_bookable=1 ORDER BY sort, name`));
});

// ---------- book ----------
r.post('/booking-requests', rateLimit('book', 10, 60 * 60e3), (req, res) => {
  const b = req.body;
  const name = str(b.name, 100);
  need(name.length >= 2, 'Enter your full name');
  need(normPhone(b.phone).length === 10, 'Enter a 10-digit phone number');
  const svc = get('SELECT * FROM services WHERE id=? AND active=1 AND online_bookable=1', b.service_id);
  need(svc, 'Choose a service');
  need(isDate(b.date) && b.date >= todayStr() && b.date <= addDays(todayStr(), 120), 'Pick a date in the next 4 months');
  need(timeOfDayRange[b.time_of_day], 'Pick morning, afternoon or evening');
  const out = tx(() => {
    let client = get('SELECT * FROM clients WHERE phone_norm=?', normPhone(b.phone));
    if (!client) {
      const id = insert('clients', {
        name, phone: str(b.phone, 30), phone_norm: normPhone(b.phone), referred_by: 'Online', created_at: nowLocal(),
      });
      client = get('SELECT * FROM clients WHERE id=?', id);
    }
    const dupe = get(
      `SELECT id FROM booking_requests WHERE client_id=? AND service_id=? AND preferred_date=? AND status='pending'`, client.id, svc.id, b.date,
    );
    if (dupe) throw conflict('You already have a pending request for that day — we’ll text you shortly.');
    const id = insert('booking_requests', {
      client_id: client.id, service_id: svc.id, preferred_date: b.date, time_of_day: b.time_of_day,
      notes: str(b.notes, 500) || null, kind: 'new', status: 'pending', created_at: nowLocal(),
    });
    return { id, client };
  });
  const [from, to] = timeOfDayRange[b.time_of_day];
  res.status(201).json({
    id: out.id, service: svc.name, date: b.date, time_of_day: b.time_of_day, window: { from, to }, notes: str(b.notes, 500) || null, clinic: clinicName(),
  });
});

// ---------- sign in (phone + one-time code) ----------
const codes = new Map();
r.post('/otp', rateLimit('otp', 6, 15 * 60e3), (req, res) => {
  const norm = normPhone(req.body.phone);
  need(norm.length === 10, 'Enter a 10-digit phone number');
  const client = get('SELECT * FROM clients WHERE phone_norm=?', norm);
  const dev = isDemo();
  let dev_code;
  if (client) {
    const code = String(crypto.randomInt(100000, 1000000));
    codes.set(norm, { code, exp: Date.now() + 10 * 60e3, tries: 0 });
    sms(client.id, 'otp', `${clinicName()}: your code is ${code}. It expires in 10 minutes.`);
    if (dev) dev_code = code;
  }
  res.json({ sent: true, dev_code });
});

r.post('/login', rateLimit('login-client', 20, 15 * 60e3), (req, res) => {
  const norm = normPhone(req.body.phone);
  const entry = codes.get(norm);
  if (!entry || entry.exp < Date.now() || entry.tries >= 5) throw new HttpError(401, 'That code has expired — request a new one');
  entry.tries++;
  if (String(req.body.code) !== entry.code) throw new HttpError(401, 'That code isn’t right');
  codes.delete(norm);
  const client = get('SELECT id, name, phone FROM clients WHERE phone_norm=?', norm);
  res.json({ token: clientToken(client.id), client });
});

// ---------- self check-in (QR at the front desk) ----------
r.post('/checkin', rateLimit('checkin', 20, 15 * 60e3), (req, res) => {
  const norm = normPhone(req.body.phone);
  need(norm.length === 10, 'Enter the phone number you booked with');
  const client = get('SELECT * FROM clients WHERE phone_norm=?', norm);
  const appt = client && get(
    `${APPT_SQL} WHERE a.client_id=? AND substr(a.start_at,1,10)=? AND a.status IN ('booked','checked_in','in_room','with_provider') ORDER BY a.start_at LIMIT 1`,
    client.id, todayStr(),
  );
  if (!appt) throw notFound('We couldn’t find a visit for that number today — please see the front desk.');
  if (appt.status === 'booked') {
    setStatus(appt.id, 'checked_in');
    notifyStaff(appt.provider_id, appt.id, `${appt.client_name} checked in`);
  }
  res.json({ first_name: client.name.split(' ')[0], service: appt.service_name, time: fmtTime12(appt.start_at) });
});

// ---------- waitlist offers ----------
r.get('/offers/:token', (req, res) => {
  const o = offerByToken(req.params.token);
  const slot = o.slot_id ? get('SELECT start_at, end_at FROM open_slots WHERE id=?', o.slot_id) : null;
  res.json({
    status: o.status, first_name: o.client_name.split(' ')[0], service: o.service_name, clinic: clinicName(),
    start_at: o.slot_start, minutes: slot ? minutesBetween(slot.start_at, slot.end_at) : o.duration_min,
  });
});
r.post('/offers/:token/respond', rateLimit('offer', 20, 15 * 60e3), (req, res) => {
  const o = offerByToken(req.params.token);
  const out = respondOffer(o.id, !!req.body.accept);
  res.json({ status: out.status });
});

// ---------- signed-in client ----------
const c = Router();
c.use(clientAuth);

c.get('/appointments', (req, res) => {
  const cl = req.client;
  const rows = all(`${APPT_SQL} WHERE a.client_id=? AND a.status!='cancelled' ORDER BY a.start_at DESC`, cl.id);
  const strip = (a) => ({
    id: a.id, service_id: a.service_id, service_name: a.service_name, start_at: a.start_at, end_at: a.end_at, status: a.status,
    session_no: a.session_no, sessions_total: a.sessions_total, clinic: clinicName(),
  });
  const now = nowLocal();
  const upcoming = rows.filter((a) => ['booked', 'checked_in', 'in_room', 'with_provider'].includes(a.status) && a.end_at >= now.slice(0, 16)).reverse();
  const hours = +setting('cancel_window_hours');
  const requests = all(
    `SELECT b.id, b.kind, b.for_appointment_id, b.preferred_date, b.time_of_day, s.name AS service_name FROM booking_requests b
     JOIN services s ON s.id=b.service_id WHERE b.client_id=? AND b.status='pending' ORDER BY b.created_at`, cl.id,
  );
  const pendingReschedule = new Set(requests.filter((x) => x.kind === 'reschedule').map((x) => x.for_appointment_id));
  res.json({
    client: { id: cl.id, name: cl.name, phone: cl.phone },
    upcoming: upcoming.map((a) => ({
      ...strip(a),
      can_cancel: a.status === 'booked' && minutesBetween(now, a.start_at) >= hours * 60,
      pending_reschedule: pendingReschedule.has(a.id),
      window_hours: hours,
    })),
    requests: requests.filter((x) => x.kind === 'new'),
    past: rows.filter((a) => a.status === 'done').slice(0, 12).map(strip),
    outstanding: all(
      `SELECT i.id, i.total_cents, i.paid_cents, i.service_date, (SELECT group_concat(description, ', ') FROM invoice_lines l WHERE l.invoice_id=i.id AND l.kind='service') AS summary
       FROM invoices i WHERE i.client_id=? AND i.status IN ('open','partial') AND i.total_cents>i.paid_cents ORDER BY i.service_date DESC`, cl.id,
    ).map((i) => ({ ...i, balance_cents: i.total_cents - i.paid_cents })),
  });
});

c.post('/appointments/:id/cancel', (req, res) => {
  const a = apptById(req.params.id);
  if (!a || a.client_id !== req.client.id) throw notFound('Appointment not found');
  const hours = +setting('cancel_window_hours');
  if (minutesBetween(nowLocal(), a.start_at) < hours * 60) {
    throw conflict(`Appointments can be cancelled online up to ${hours} hours ahead. Please call the clinic.`, 'window');
  }
  cancelAppointment(a.id, { reason: 'Client cancelled', notify: true, byClient: true });
  res.json({ ok: true });
});

c.post('/appointments/:id/reschedule', (req, res) => {
  const a = apptById(req.params.id);
  if (!a || a.client_id !== req.client.id) throw notFound('Appointment not found');
  if (a.status !== 'booked') throw conflict('This appointment can’t be rescheduled online');
  need(isDate(req.body.date) && req.body.date >= todayStr(), 'Pick a date');
  need(timeOfDayRange[req.body.time_of_day], 'Pick morning, afternoon or evening');
  if (get(`SELECT id FROM booking_requests WHERE for_appointment_id=? AND status='pending'`, a.id)) {
    throw conflict('You already asked to reschedule this one — we’ll text you soon.');
  }
  const id = insert('booking_requests', {
    client_id: a.client_id, service_id: a.service_id, preferred_date: req.body.date, time_of_day: req.body.time_of_day,
    notes: str(req.body.notes, 300) || null, kind: 'reschedule', for_appointment_id: a.id, status: 'pending', created_at: nowLocal(),
  });
  logEvent('reschedule_request', { client_id: a.client_id, appointment_id: a.id, detail: `Asked to move to ${fmtDay(`${req.body.date}T00:00:00`)} (${req.body.time_of_day})` });
  res.status(201).json({ id });
});

function ownInvoice(req) {
  const inv = get('SELECT * FROM invoices WHERE id=?', req.params.id);
  if (!inv || inv.client_id !== req.client.id) throw notFound('Invoice not found');
  return refreshInvoice(inv.id);
}

c.get('/invoices/:id', (req, res) => {
  const inv = ownInvoice(req);
  const d = invoiceDetail(inv.id);
  res.json({
    id: d.id, status: d.status, service_date: d.service_date, clinic: clinicName(),
    lines: d.lines.map((l) => ({ id: l.id, description: l.description, amount_cents: l.amount_cents, detail: l.detail })),
    subtotal_cents: d.subtotal_cents, discount_cents: d.discount_cents, discount_label: d.discount_label, tax_cents: d.tax_cents,
    total_cents: d.total_cents, paid_cents: d.paid_cents, balance_cents: d.balance_cents,
    payable: ['open', 'partial'].includes(d.status) && d.balance_cents > 0,
    financing: { lender: setting('financing_lender'), months: +setting('financing_months') },
  });
});

/** Demo payment gateway: no card data is collected or stored. Plug a real processor in here. */
c.post('/invoices/:id/pay', rateLimit('pay', 15, 15 * 60e3), (req, res) => {
  const inv = ownInvoice(req);
  if (!['open', 'partial'].includes(inv.status)) throw conflict('This invoice isn’t ready for payment');
  const method = str(req.body.method, 20);
  need(['card', 'apple_pay', 'affirm'].includes(method), 'Choose how to pay');
  const balance = inv.total_cents - inv.paid_cents;
  need(balance > 0, 'Nothing is due');
  tx(() => {
    if (method === 'affirm') {
      const months = +setting('financing_months') || 3;
      insert('financing_plans', {
        invoice_id: inv.id, lender: setting('financing_lender'), months, financed_cents: balance,
        monthly_cents: Math.round(balance / months), created_at: nowLocal(),
      });
      insert('payments', {
        invoice_id: inv.id, amount_cents: balance, method: 'financing', kind: 'financed',
        note: `${setting('financing_lender')} · ${months} mo (client app)`, created_at: nowLocal(),
      });
      refreshInvoice(inv.id);
    } else {
      recordPayment(inv.id, { amount_cents: balance, method: 'card', note: method === 'apple_pay' ? 'Apple Pay (client app)' : 'Card (client app)' });
    }
  });
  sms(inv.client_id, 'receipt', `${clinicName()}: payment received — thank you!`);
  res.json({ ok: true, status: refreshInvoice(inv.id).status });
});

r.use('/client', c);
export default r;
