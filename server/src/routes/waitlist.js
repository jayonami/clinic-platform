import { Router } from 'express';
import { all, get, insert, tx, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { conflict, int, isDate, isHHMM, mkDT, need, normPhone, notFound, nowLocal, str } from '../lib/util.js';
import { apptById, createAppointment, defaultAssistant } from '../lib/appointments.js';
import { compatibleSlotsFor, expireStale, makeOffer, respondOffer } from '../lib/waitlist.js';
import { rescheduleAppointment, waitlistView } from './schedule.js';
import { fmtDay, fmtTime12, sms, clinicName } from '../lib/notify.js';

const r = Router();
r.use(staffAuth());

r.get('/waitlist', (_req, res) => {
  expireStale();
  res.json(waitlistView());
});

r.post('/waitlist', staffAuth('reception'), (req, res) => {
  const b = req.body;
  need(get('SELECT id FROM services WHERE id=? AND active=1', b.service_id), 'Choose a service');
  let client = b.client_id ? get('SELECT * FROM clients WHERE id=?', b.client_id) : null;
  if (!client) {
    need(str(b.name, 100) && normPhone(b.phone).length === 10, 'Enter a name and 10-digit phone number');
    client = get('SELECT * FROM clients WHERE phone_norm=?', normPhone(b.phone));
    if (!client) {
      const id = insert('clients', { name: str(b.name, 100), phone: str(b.phone, 30), phone_norm: normPhone(b.phone), created_at: nowLocal() });
      client = get('SELECT * FROM clients WHERE id=?', id);
    }
  }
  if (get(`SELECT id FROM waitlist WHERE client_id=? AND service_id=? AND status IN ('waiting','offered')`, client.id, b.service_id)) {
    throw conflict('They are already on the waitlist for this service');
  }
  const id = insert('waitlist', { client_id: client.id, service_id: +b.service_id, note: str(b.note, 200) || null, status: 'waiting', created_at: nowLocal() });
  res.status(201).json({ id });
});

r.delete('/waitlist/:id', staffAuth('reception'), (req, res) => {
  const w = get('SELECT * FROM waitlist WHERE id=?', req.params.id);
  if (!w) throw notFound();
  tx(() => {
    for (const o of all(`SELECT * FROM offers WHERE waitlist_id=? AND status='pending'`, w.id)) {
      update('offers', o.id, { status: 'declined', resolved_at: nowLocal() });
      if (o.slot_id) update('open_slots', o.slot_id, { status: 'open' });
    }
    update('waitlist', w.id, { status: 'removed', resolved_at: nowLocal() });
  });
  res.json({ ok: true });
});

r.get('/waitlist/:id/slots', (req, res) => {
  const w = get('SELECT * FROM waitlist WHERE id=?', req.params.id);
  if (!w) throw notFound();
  res.json(compatibleSlotsFor(w));
});

r.post('/waitlist/:id/offer', staffAuth('reception'), (req, res) => {
  const slot_id = int(req.body.slot_id, 'slot');
  res.status(201).json({ offer_id: makeOffer(+req.params.id, slot_id, false) });
});

// reception recording the guest's reply (they replied by phone / SMS)
r.post('/offers/:id/respond', staffAuth('reception'), (req, res) => {
  res.json(respondOffer(+req.params.id, !!req.body.accept, req.user.id));
});

// ---------- online booking requests ----------
r.get('/booking-requests', (_req, res) => {
  res.json(all(
    `SELECT b.*, c.name AS client_name, c.phone AS client_phone, s.name AS service_name, s.duration_min, s.kind AS service_kind,
        a.start_at AS current_start
     FROM booking_requests b JOIN clients c ON c.id=b.client_id JOIN services s ON s.id=b.service_id
     LEFT JOIN appointments a ON a.id=b.for_appointment_id
     WHERE b.status='pending' ORDER BY b.created_at`,
  ));
});

r.post('/booking-requests/:id/confirm', staffAuth('reception'), (req, res) => {
  const b = req.body;
  const reqRow = get(`SELECT * FROM booking_requests WHERE id=? AND status='pending'`, req.params.id);
  if (!reqRow) throw conflict('That request was already handled');
  need(isDate(b.date) && isHHMM(b.time), 'Pick a date and time');
  if (reqRow.kind === 'reschedule') {
    const a = rescheduleAppointment(reqRow.for_appointment_id, {
      date: b.date, time: b.time, provider_id: b.provider_id, resource_id: b.resource_id, reason: 'Client requested', notify: true, staffId: req.user.id, byClient: true,
    });
    update('booking_requests', reqRow.id, { status: 'confirmed', appointment_id: a.id, resolved_at: nowLocal() });
    return res.json(a);
  }
  const svc = get('SELECT * FROM services WHERE id=?', reqRow.service_id);
  const id = tx(() => {
    const apptId = createAppointment({
      client_id: reqRow.client_id, service_id: svc.id, provider_id: int(b.provider_id, 'provider'), resource_id: int(b.resource_id, 'room'),
      assistant_id: defaultAssistant(svc, +b.provider_id), start_at: mkDT(b.date, b.time), channel: 'online',
      notes: reqRow.notes, created_by: req.user.id, request_id: reqRow.id,
    });
    update('booking_requests', reqRow.id, { status: 'confirmed', appointment_id: apptId, resolved_at: nowLocal() });
    return apptId;
  });
  const a = apptById(id);
  sms(a.client_id, 'appointment_confirmed', `${clinicName()}: confirmed! ${svc.name}, ${fmtDay(a.start_at)} at ${fmtTime12(a.start_at)}.`, req.user.id);
  res.status(201).json(a);
});

r.post('/booking-requests/:id/decline', staffAuth('reception'), (req, res) => {
  const row = get(`SELECT * FROM booking_requests WHERE id=? AND status='pending'`, req.params.id);
  if (!row) throw conflict('That request was already handled');
  update('booking_requests', row.id, { status: 'declined', resolved_at: nowLocal() });
  sms(row.client_id, 'request_declined', `${clinicName()}: sorry, we couldn't fit that request. Call us and we'll find a time that works.`, req.user.id);
  res.json({ ok: true });
});

export default r;
