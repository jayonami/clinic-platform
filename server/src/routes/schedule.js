import { Router } from 'express';
import { all, get, insert, tx, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { getSettings } from '../lib/settings.js';
import {
  HttpError, addDays, addMinutes, bad, bool, conflict, fmtDate, int, isDate, isHHMM, mkDT, need, normPhone,
  nowLocal, str, todayStr,
} from '../lib/util.js';
import {
  APPT_SQL, apptById, apptOr404, apptsForDate, assertFree, availability, createAppointment, defaultAssistant,
  pickProviderAndRoom, setStatus, visitsCount,
} from '../lib/appointments.js';
import { compatibleSlotsFor, createOpenSlot, expireStale } from '../lib/waitlist.js';
import { fmtDay, fmtTime12, logEvent, notifyStaff, sms, clinicName } from '../lib/notify.js';

const r = Router();
r.use(staffAuth());

const pending = (rows) => rows.map((w) => ({
  ...w,
  slot_ids: compatibleSlotsFor(w).map((s) => s.id),
}));

export function waitlistView() {
  const rows = all(
    `SELECT w.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name, s.duration_min,
        (SELECT o.id FROM offers o WHERE o.waitlist_id=w.id AND o.status='pending' LIMIT 1) AS offer_id
     FROM waitlist w JOIN clients c ON c.id=w.client_id JOIN services s ON s.id=w.service_id
     WHERE w.status IN ('waiting','offered') ORDER BY w.created_at`,
  );
  return pending(rows);
}

// ---------- calendar ----------
r.get('/calendar', (req, res) => {
  expireStale();
  const date = isDate(req.query.date) ? req.query.date : todayStr();
  const view = req.query.view === 'week' ? 'week' : 'day';
  const provider = req.query.provider_id ? +req.query.provider_id : null;
  const resources = all('SELECT * FROM resources WHERE active=1 ORDER BY sort, id');
  const s = getSettings();
  const base = { date, view, resources, now: nowLocal(), hours: { open: s.open_time, close: s.close_time, lunch_start: s.lunch_start, lunch_end: s.lunch_end, step: +s.slot_step_min } };

  if (view === 'week') {
    const d = new Date(`${date}T12:00:00`);
    const monday = addDays(date, -((d.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((day) => ({
      date: day,
      appointments: apptsForDate(day).filter((a) => !provider || a.provider_id === provider),
    }));
    return res.json({ ...base, days });
  }
  let appointments = apptsForDate(date);
  if (provider) appointments = appointments.filter((a) => a.provider_id === provider);
  const openSlots = all(
    `SELECT o.*, r.name AS resource_name FROM open_slots o JOIN resources r ON r.id=o.resource_id
     WHERE o.status IN ('open','offered') AND substr(o.start_at,1,10)=? ORDER BY o.start_at`, date,
  );
  const requests = all(
    `SELECT b.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name FROM booking_requests b
     JOIN clients c ON c.id=b.client_id JOIN services s ON s.id=b.service_id WHERE b.status='pending' ORDER BY b.created_at`,
  );
  res.json({
    ...base,
    appointments,
    open_slots: openSlots,
    waitlist: waitlistView(),
    requests,
    counts: {
      providers: new Set(all(`SELECT DISTINCT provider_id FROM appointments WHERE substr(start_at,1,10)=? AND status!='cancelled'`, date).map((x) => x.provider_id)).size || resources.length,
      appointments: appointments.length,
      waitlist: get(`SELECT COUNT(*) n FROM waitlist WHERE status IN ('waiting','offered')`).n,
    },
    autofill: s.autofill === '1',
  });
});

r.get('/availability', (req, res) => {
  const { date, service_id, provider_id, resource_id, exclude_id } = req.query;
  need(isDate(date), 'Pick a date');
  const svc = get('SELECT duration_min FROM services WHERE id=?', service_id);
  need(svc, 'Pick a service');
  res.json(availability({
    date, duration: svc.duration_min, provider_id: +provider_id, resource_id: +resource_id, exclude_id: exclude_id ? +exclude_id : null,
  }));
});

// ---------- appointments ----------
r.get('/appointments/:id', (req, res) => {
  const a = apptOr404(req.params.id);
  res.json({
    ...a,
    changes: all(
      `SELECT ch.*, s.short_name AS by_name FROM appointment_changes ch LEFT JOIN staff s ON s.id=ch.by_staff_id
       WHERE ch.appointment_id=? AND ch.type!='create' ORDER BY ch.created_at DESC, ch.id DESC`, a.id,
    ),
    invoice_id: get('SELECT id FROM invoices WHERE appointment_id=?', a.id)?.id ?? null,
  });
});

r.post('/appointments', staffAuth('reception'), (req, res) => {
  const b = req.body;
  need(isDate(b.date) && isHHMM(b.time), 'Pick a date and time');
  const client = get('SELECT * FROM clients WHERE id=?', b.client_id);
  need(client, 'Choose a client');
  const svc = get('SELECT * FROM services WHERE id=? AND active=1', b.service_id);
  need(svc, 'Choose a service');
  const request = b.request_id ? get(`SELECT * FROM booking_requests WHERE id=? AND status='pending'`, b.request_id) : null;
  if (b.request_id && !request) throw conflict('That request was already handled');
  const id = tx(() => {
    const apptId = createAppointment({
      client_id: client.id, service_id: svc.id, provider_id: int(b.provider_id, 'provider'), resource_id: int(b.resource_id, 'room'),
      assistant_id: defaultAssistant(svc, +b.provider_id), start_at: mkDT(b.date, b.time),
      channel: request ? 'online' : 'call_centre', notes: str(b.notes, 500) || null, created_by: req.user.id, request_id: request?.id,
    });
    if (request) update('booking_requests', request.id, { status: 'confirmed', appointment_id: apptId, resolved_at: nowLocal() });
    return apptId;
  });
  const a = apptById(id);
  sms(client.id, 'appointment_confirmed', `${clinicName()}: you're booked for ${svc.name} on ${fmtDay(a.start_at)} at ${fmtTime12(a.start_at)}. Reply or call us to change it.`, req.user.id);
  res.status(201).json(a);
});

function openSlotFor(old, reasonText) {
  const clash = get(
    `SELECT id FROM appointments WHERE status IN ('booked','checked_in','in_room','with_provider','done') AND id!=?
       AND start_at<? AND end_at>? AND (provider_id=? OR resource_id=?) LIMIT 1`,
    old.id, old.end_at, old.start_at, old.provider_id, old.resource_id,
  );
  if (!clash) createOpenSlot({ resource_id: old.resource_id, provider_id: old.provider_id, start_at: old.start_at, end_at: old.end_at, source_appointment_id: old.id, reason: reasonText });
}

export function rescheduleAppointment(id, { date, time, provider_id, resource_id, reason, notify, staffId = null, byClient = false }) {
  const old = apptOr404(id);
  if (!['booked', 'checked_in'].includes(old.status)) throw conflict('Only upcoming appointments can be rescheduled');
  need(isDate(date) && isHHMM(time), 'Pick a new date and time');
  const why = str(reason, 120);
  need(why, 'Choose a reason — every reschedule is logged');
  const pid = provider_id ? int(provider_id, 'provider') : old.provider_id;
  const rid = resource_id ? int(resource_id, 'room') : old.resource_id;
  const start_at = mkDT(date, time);
  const end_at = addMinutes(start_at, old.duration_min);
  if (start_at === old.start_at && pid === old.provider_id && rid === old.resource_id) throw bad('Pick a different time');
  if (rid !== old.resource_id && get('SELECT kind FROM resources WHERE id=?', rid)?.kind !== old.service_kind) throw bad('That column cannot be used for this service');
  tx(() => {
    assertFree({ provider_id: pid, resource_id: rid, start_at, end_at, exclude_id: id });
    update('appointments', id, { start_at, end_at, provider_id: pid, resource_id: rid, status: 'booked', checked_in_at: null });
    insert('appointment_changes', {
      appointment_id: id, type: 'reschedule', from_start: old.start_at, to_start: start_at, reason: why,
      by_staff_id: staffId, by_client: byClient ? 1 : 0, notified: notify ? 1 : 0, created_at: nowLocal(),
    });
    logEvent('reschedule', {
      client_id: old.client_id, appointment_id: id, staff_id: staffId,
      detail: `Moved ${old.start_at.slice(11, 16)} → ${start_at.slice(11, 16)}${old.start_at.slice(0, 10) !== start_at.slice(0, 10) ? ` (${fmtDay(start_at)})` : ''} by ${byClient ? 'client' : get('SELECT short_name FROM staff WHERE id=?', staffId)?.short_name ?? 'staff'}`,
    });
    openSlotFor(old, 'rescheduled');
  });
  if (notify) {
    sms(old.client_id, 'rescheduled', `${clinicName()}: your ${old.service_name} has moved to ${fmtDay(start_at)} at ${fmtTime12(start_at)}. Call us if that doesn't work.`, staffId);
  }
  return apptById(id);
}

r.patch('/appointments/:id', staffAuth('reception'), (req, res) => {
  const b = req.body;
  res.json(rescheduleAppointment(+req.params.id, { ...b, notify: bool(b.notify), staffId: req.user.id }));
});

export function cancelAppointment(id, { reason, notify, staffId = null, byClient = false }) {
  const a = apptOr404(id);
  if (!['booked', 'checked_in'].includes(a.status)) throw conflict('This appointment can no longer be cancelled');
  const why = str(reason, 120);
  need(why, 'Choose a reason — every cancellation is logged');
  tx(() => {
    update('appointments', id, { status: 'cancelled' });
    insert('appointment_changes', {
      appointment_id: id, type: 'cancel', from_start: a.start_at, reason: why, by_staff_id: staffId,
      by_client: byClient ? 1 : 0, notified: notify ? 1 : 0, created_at: nowLocal(),
    });
    logEvent('cancel', { client_id: a.client_id, appointment_id: id, staff_id: staffId, detail: `Cancelled · ${why}` });
    openSlotFor(a, 'cancelled');
  });
  if (notify) sms(a.client_id, 'cancelled', `${clinicName()}: your ${a.service_name} on ${fmtDay(a.start_at)} at ${fmtTime12(a.start_at)} has been cancelled.`, staffId);
  return apptById(id);
}
r.post('/appointments/:id/cancel', staffAuth('reception'), (req, res) =>
  res.json(cancelAppointment(+req.params.id, { reason: req.body.reason, notify: bool(req.body.notify), staffId: req.user.id })));

r.post('/appointments/:id/no-show', staffAuth('reception'), (req, res) => {
  const a = apptOr404(req.params.id);
  if (!['booked', 'checked_in'].includes(a.status)) throw conflict('Only upcoming appointments can be marked no-show');
  tx(() => {
    setStatus(a.id, 'no_show');
    insert('appointment_changes', { appointment_id: a.id, type: 'no_show', from_start: a.start_at, reason: 'No-show', by_staff_id: req.user.id, created_at: nowLocal() });
    const assignee = get(
      `SELECT s.id, s.short_name, (SELECT COUNT(*) FROM followups f WHERE f.assigned_staff_id=s.id AND f.status='open') AS load
       FROM staff s WHERE s.active=1 ORDER BY load, s.id LIMIT 1`,
    );
    insert('followups', { client_id: a.client_id, appointment_id: a.id, assigned_staff_id: assignee?.id, type: 'noshow_call', status: 'open', created_at: nowLocal() });
    logEvent('no_show', { client_id: a.client_id, appointment_id: a.id, staff_id: req.user.id, detail: `Follow-up call auto-assigned to ${assignee?.short_name ?? 'reception'}` });
    if (assignee) notifyStaff(assignee.id, a.id, `Call ${a.client_name} — missed ${a.service_name}`);
    openSlotFor(a, 'no_show');
  });
  sms(a.client_id, 'no_show', `${clinicName()}: we missed you today. Reply to rebook your ${a.service_name}.`, req.user.id);
  res.json(apptById(a.id));
});

r.post('/appointments/:id/status', (req, res) => {
  const to = str(req.body.status, 20);
  need(['booked', 'checked_in', 'in_room', 'with_provider'].includes(to), 'Unsupported status');
  const a = apptOr404(req.params.id);
  if (req.user.role === 'provider' && ![a.provider_id, a.assistant_id].includes(req.user.id)) throw new HttpError(403, 'This appointment belongs to another provider');
  const updated = setStatus(a.id, to);
  if (to === 'checked_in') notifyStaff(a.provider_id, a.id, `${a.client_name} has checked in`);
  if (to === 'in_room') notifyStaff(a.provider_id, a.id, `${a.client_name} is ready in ${a.resource_name}`);
  res.json(updated);
});

r.post('/appointments/:id/notify-provider', (req, res) => {
  const a = apptOr404(req.params.id);
  notifyStaff(a.provider_id, a.id, `${a.client_name} is waiting for you`);
  logEvent('page_provider', { client_id: a.client_id, appointment_id: a.id, staff_id: req.user.id, detail: `Paged ${a.provider_short}` });
  res.json({ ok: true });
});

// ---------- queue + check-in ----------
r.get('/queue', (_req, res) => {
  const rows = apptsForDate(todayStr()).filter((a) => a.status !== 'no_show');
  const invoices = Object.fromEntries(
    all(`SELECT appointment_id, id, status FROM invoices WHERE service_date=?`, todayStr()).map((i) => [i.appointment_id, i]),
  );
  const out = rows.map((a) => ({ ...a, invoice: invoices[a.id] ?? null }));
  res.json({
    now: nowLocal(),
    appointments: out,
    expected: out.length,
    waiting: out.filter((a) => a.status === 'checked_in').length,
  });
});

r.get('/checkin/search', (req, res) => {
  const q = str(req.query.q, 60);
  if (q.length < 2) return res.json([]);
  const like = `%${q.toLowerCase()}%`;
  const digits = normPhone(q);
  const clients = all(
    `SELECT * FROM clients WHERE lower(name) LIKE ? ${digits.length >= 4 ? 'OR phone_norm LIKE ?' : ''} ORDER BY name LIMIT 6`,
    ...(digits.length >= 4 ? [like, `%${digits}%`] : [like]),
  );
  res.json(clients.map((c) => {
    const today = all(
      `${APPT_SQL} WHERE a.client_id=? AND substr(a.start_at,1,10)=? AND a.status IN ('booked','checked_in','in_room','with_provider') ORDER BY a.start_at`,
      c.id, todayStr(),
    );
    const last = get(`SELECT start_at FROM appointments WHERE client_id=? AND status='done' ORDER BY start_at DESC LIMIT 1`, c.id);
    return {
      client: { id: c.id, name: c.name, phone: c.phone, email: c.email, language: c.language },
      visits: visitsCount(c.id), last_visit: last?.start_at ?? null, appointments: today,
    };
  }));
});

r.post('/checkin/walk-in', staffAuth('reception'), (req, res) => {
  const b = req.body;
  const svc = get(`SELECT * FROM services WHERE id=? AND active=1`, b.service_id);
  need(svc, 'Choose the visit reason');
  let client = b.client_id ? get('SELECT * FROM clients WHERE id=?', b.client_id) : null;
  if (!client) {
    const name = str(b.name, 100);
    const phone = str(b.phone, 30);
    need(name && normPhone(phone).length === 10, 'Enter the guest’s name and a 10-digit phone number');
    client = get('SELECT * FROM clients WHERE phone_norm=?', normPhone(phone));
    if (!client) {
      const id = insert('clients', {
        name, phone, phone_norm: normPhone(phone), language: ['English', 'Español', 'Other'].includes(b.language) ? b.language : 'English',
        referred_by: str(b.referred_by, 60) || 'Walk-in', created_at: nowLocal(),
      });
      client = get('SELECT * FROM clients WHERE id=?', id);
    }
  }
  const t = new Date();
  t.setMinutes(Math.floor(t.getMinutes() / 5) * 5, 0, 0);
  const now = `${fmtDate(t)}T${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:00`;
  let start = null;
  let pick = null;
  for (const offset of [0, 15, 30]) {
    const t0 = addMinutes(now, offset);
    pick = pickProviderAndRoom(svc, t0);
    if (pick) { start = t0; break; }
  }
  if (!pick) throw conflict('Nobody is free in the next 30 minutes. Add this guest to the waitlist instead.', 'no_capacity');
  const id = createAppointment({
    client_id: client.id, service_id: svc.id, ...pick, assistant_id: defaultAssistant(svc, pick.provider_id), start_at: start,
    channel: 'walk_in', created_by: req.user.id, status: 'checked_in', allowPast: true,
  });
  notifyStaff(pick.provider_id, id, `${client.name} walked in`);
  res.status(201).json(apptById(id));
});

export default r;
