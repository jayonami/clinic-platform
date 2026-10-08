import { Router } from 'express';
import { all, get, insert, run, tx, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { getSettings } from '../lib/settings.js';
import { APPT_SQL, apptOr404, setStatus } from '../lib/appointments.js';
import { buildQuotation } from '../lib/billing.js';
import { HttpError, bad, conflict, need, nowLocal, str, todayStr, isDate } from '../lib/util.js';
import { logEvent, notifyStaff } from '../lib/notify.js';

const r = Router();
r.use(staffAuth());

const mine = (user, a) => user.role === 'reception' || a.provider_id === user.id;
function guard(user, a) {
  if (!mine(user, a)) throw new HttpError(403, 'This visit belongs to another provider');
}

r.get('/my-day', (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : todayStr();
  const staffId = req.user.role === 'provider' ? req.user.id : +req.query.staff_id || null;
  const appts = all(
    `${APPT_SQL} WHERE substr(a.start_at,1,10)=? AND a.status NOT IN ('cancelled','no_show') ${staffId ? 'AND a.provider_id=?' : ''}
     ORDER BY a.start_at`,
    ...(staffId ? [date, staffId] : [date]),
  );
  const s = getSettings();
  const earned = staffId
    ? get(
      `SELECT COALESCE(SUM(l.amount_cents * (1.0*(i.subtotal_cents-i.discount_cents)/NULLIF(i.subtotal_cents,0))),0) AS revenue,
              COALESCE(SUM(ls.commission_cents),0) AS commission
       FROM line_staff ls JOIN invoice_lines l ON l.id=ls.line_id JOIN invoices i ON i.id=l.invoice_id
       JOIN appointments a ON a.id=i.appointment_id
       WHERE ls.staff_id=? AND a.status='done' AND substr(a.start_at,1,10)=? AND i.status!='void'`, staffId, date,
    )
    : { revenue: 0, commission: 0 };
  const done = appts.filter((a) => a.status === 'done').length;
  res.json({
    date, now: nowLocal(),
    appointments: appts,
    lunch: { start: s.lunch_start, end: s.lunch_end },
    summary: { total: appts.length, done, revenue_cents: Math.round(earned.revenue), commission_cents: earned.commission },
    notifications: staffId ? all('SELECT * FROM notifications WHERE staff_id=? AND read=0 ORDER BY created_at DESC LIMIT 10', staffId) : [],
  });
});

r.post('/notifications/read', (req, res) => {
  run('UPDATE notifications SET read=1 WHERE staff_id=?', req.user.id);
  res.json({ ok: true });
});

/** The consultation the provider should open next: in progress first, then whoever has waited longest. */
r.get('/consultations/next', (req, res) => {
  const rows = all(
    `${APPT_SQL} WHERE substr(a.start_at,1,10)=? AND a.status IN ('with_provider','in_room','checked_in') ${req.user.role === 'provider' ? 'AND a.provider_id=?' : ''}
     ORDER BY CASE a.status WHEN 'with_provider' THEN 0 WHEN 'in_room' THEN 1 ELSE 2 END, a.checked_in_at`,
    ...(req.user.role === 'provider' ? [todayStr(), req.user.id] : [todayStr()]),
  );
  res.json({ appointment_id: rows[0]?.id ?? null });
});

function clientPackageNext(clientId) {
  return all(
    `SELECT s.*, (SELECT COUNT(*) FROM appointments a WHERE a.client_id=? AND a.service_id=s.id AND a.status='done') AS done_n
     FROM services s WHERE s.sessions_total IS NOT NULL AND s.active=1`, clientId,
  ).filter((s) => s.done_n > 0 && s.done_n < s.sessions_total);
}

r.get('/consultations/:apptId', (req, res) => {
  const a = apptOr404(req.params.apptId);
  guard(req.user, a);
  const consultation = get('SELECT * FROM consultations WHERE appointment_id=?', a.id);
  const lastVisit = get(
    `SELECT a2.start_at, s.name AS service_name, s.sessions_total, c.notes,
        (SELECT COUNT(*) FROM appointments x WHERE x.client_id=a2.client_id AND x.service_id=a2.service_id AND x.status='done' AND x.start_at<=a2.start_at) AS session_no
     FROM appointments a2 JOIN services s ON s.id=a2.service_id LEFT JOIN consultations c ON c.appointment_id=a2.id
     WHERE a2.client_id=? AND a2.status='done' AND a2.start_at<? ORDER BY a2.start_at DESC LIMIT 1`, a.client_id, a.start_at,
  );
  const pkg = clientPackageNext(a.client_id);
  const options = all(`SELECT id, name, kind, price_cents, sessions_total, duration_min FROM services WHERE active=1 ORDER BY kind='consult', sort, name`).map((s) => {
    const done = s.sessions_total
      ? get(`SELECT COUNT(*) n FROM appointments WHERE client_id=? AND service_id=? AND status='done'`, a.client_id, s.id).n
      : 0;
    return { ...s, session_label: s.sessions_total ? `session ${Math.min(done + 1, s.sessions_total)} of ${s.sessions_total}` : null };
  }).filter((s) => s.id !== a.service_id);
  const suggestedIds = pkg.length ? pkg.map((s) => s.id) : [];
  const items = all(
    `SELECT DISTINCT i.id, i.name, i.sell_price_cents, GROUP_CONCAT(si.service_id) AS service_ids FROM items i
     JOIN service_items si ON si.item_id=i.id WHERE i.active=1 AND i.sell_price_cents IS NOT NULL GROUP BY i.id`,
  ).map((i) => ({ ...i, service_ids: i.service_ids.split(',').map(Number) }));
  const invoice = get('SELECT id, status FROM invoices WHERE appointment_id=?', a.id);
  res.json({
    appointment: a,
    client: get('SELECT id, name, phone, language FROM clients WHERE id=?', a.client_id),
    last_visit: lastVisit,
    consultation: consultation ? { ...consultation, recommended: JSON.parse(consultation.recommended_json) } : null,
    options, suggested_ids: suggestedIds, items, invoice,
  });
});

function ensureStarted(a) {
  if (a.status === 'with_provider') return;
  if (!['booked', 'checked_in', 'in_room'].includes(a.status)) throw conflict('This visit is already finished');
  setStatus(a.id, 'with_provider');
}

r.post('/consultations/:apptId/start', staffAuth('provider'), (req, res) => {
  const a = apptOr404(req.params.apptId);
  guard(req.user, a);
  tx(() => {
    ensureStarted(a);
    if (!get('SELECT id FROM consultations WHERE appointment_id=?', a.id)) {
      insert('consultations', { appointment_id: a.id, provider_id: a.provider_id, started_at: nowLocal() });
    }
  });
  res.json({ ok: true });
});

r.put('/consultations/:apptId', staffAuth('provider'), (req, res) => {
  const a = apptOr404(req.params.apptId);
  guard(req.user, a);
  if (a.status === 'done') throw conflict('This visit is already finished');
  const notes = str(req.body.notes, 5000);
  const row = get('SELECT id FROM consultations WHERE appointment_id=?', a.id);
  if (row) update('consultations', row.id, { notes });
  else insert('consultations', { appointment_id: a.id, provider_id: a.provider_id, notes, started_at: nowLocal() });
  res.json({ ok: true });
});

r.post('/consultations/:apptId/finish', staffAuth('provider'), (req, res) => {
  const a = apptOr404(req.params.apptId);
  guard(req.user, a);
  const notes = str(req.body.notes, 5000);
  need(notes.length >= 3, 'Add a few notes about the visit first');
  const service_ids = [...new Set((req.body.service_ids ?? []).map(Number))].filter(Boolean);
  const item_ids = [...new Set((req.body.item_ids ?? []).map(Number))].filter(Boolean);
  for (const id of service_ids) if (!get('SELECT id FROM services WHERE id=? AND active=1', id)) throw bad('Unknown service');
  const invoice = tx(() => {
    if (a.status === 'done') throw conflict('This visit is already finished');
    ensureStarted(a);
    const existing = get('SELECT id FROM consultations WHERE appointment_id=?', a.id);
    const data = { notes, recommended_json: JSON.stringify({ service_ids, item_ids }), finished_at: nowLocal() };
    if (existing) update('consultations', existing.id, data);
    else insert('consultations', { appointment_id: a.id, provider_id: a.provider_id, started_at: nowLocal(), ...data });
    const inv = buildQuotation(a, { service_ids, item_ids }, req.user.id);
    setStatus(a.id, 'done');
    for (const rec of all(`SELECT id FROM staff WHERE role='reception' AND active=1`)) {
      notifyStaff(rec.id, a.id, `Quotation ready: ${a.client_name} · ${a.provider_short}`);
    }
    logEvent('consultation_done', { client_id: a.client_id, appointment_id: a.id, staff_id: req.user.id, detail: 'Consultation finished — quotation generated' });
    return inv;
  });
  res.json({ invoice_id: invoice.id, total_cents: invoice.total_cents });
});

export default r;
