import { all, get, insert, update, tx } from '../db.js';
import { setting } from './settings.js';
import { addMinutes, bad, conflict, minutesBetween, nowLocal, token, notFound } from './util.js';
import { assertFree, createAppointment, defaultAssistant, apptById } from './appointments.js';
import { fmtDay, fmtTime12, logEvent, sms, clinicName } from './notify.js';

export function createOpenSlot({ resource_id, provider_id, start_at, end_at, source_appointment_id = null, reason = null }) {
  if (end_at <= nowLocal()) return null; // nothing left to fill
  const id = insert('open_slots', {
    resource_id, provider_id, start_at, end_at, source_appointment_id, reason, status: 'open', created_at: nowLocal(),
  });
  if (setting('autofill') === '1') autofillSlot(id);
  return id;
}

export function expireStale() {
  const now = nowLocal();
  tx(() => {
    const ttl = +setting('offer_ttl_min') || 30;
    const old = all(`SELECT * FROM offers WHERE status='pending'`).filter(
      (o) => o.created_at < addMinutes(now, -ttl) || (o.slot_start && o.slot_start < now),
    );
    for (const o of old) resolveOffer(o, 'expired');
    for (const s of all(`SELECT id FROM open_slots WHERE status IN ('open','offered') AND end_at < ?`, now)) {
      update('open_slots', s.id, { status: 'expired' });
    }
  });
}

/** Waitlist entries that fit a slot: same room kind and a duration that fits. */
export function candidatesForSlot(slot) {
  const room = get('SELECT kind FROM resources WHERE id=?', slot.resource_id);
  const len = minutesBetween(slot.start_at, slot.end_at);
  return all(
    `SELECT w.*, c.name AS client_name, s.name AS service_name, s.duration_min
     FROM waitlist w JOIN clients c ON c.id=w.client_id JOIN services s ON s.id=w.service_id
     WHERE w.status='waiting' AND s.kind=? AND s.duration_min<=? ORDER BY w.created_at`,
    room.kind, len,
  );
}

export function compatibleSlotsFor(waitlistRow) {
  const svc = get('SELECT kind, duration_min FROM services WHERE id=?', waitlistRow.service_id);
  const now = nowLocal();
  return all(
    `SELECT o.*, r.name AS resource_name, r.kind AS resource_kind, p.short_name AS provider_short
     FROM open_slots o JOIN resources r ON r.id=o.resource_id JOIN staff p ON p.id=o.provider_id
     WHERE o.status='open' AND r.kind=? AND o.end_at>? ORDER BY o.start_at`,
    svc.kind, now,
  ).filter((s) => minutesBetween(s.start_at, s.end_at) >= svc.duration_min);
}

export function autofillSlot(slotId) {
  const slot = get('SELECT * FROM open_slots WHERE id=?', slotId);
  if (!slot || slot.status !== 'open') return null;
  const [first] = candidatesForSlot(slot);
  return first ? makeOffer(first.id, slotId, true) : null;
}

export function makeOffer(waitlistId, slotId, auto = false) {
  return tx(() => {
    const w = get('SELECT * FROM waitlist WHERE id=?', waitlistId);
    const slot = get('SELECT * FROM open_slots WHERE id=?', slotId);
    if (!w || w.status !== 'waiting') throw conflict('That guest is no longer waiting');
    if (!slot || slot.status !== 'open') throw conflict('That slot is no longer open');
    const svc = get('SELECT * FROM services WHERE id=?', w.service_id);
    const room = get('SELECT kind FROM resources WHERE id=?', slot.resource_id);
    if (room.kind !== svc.kind || minutesBetween(slot.start_at, slot.end_at) < svc.duration_min) {
      throw bad(`${svc.name} doesn't fit that slot`);
    }
    const tok = token(12);
    const id = insert('offers', {
      waitlist_id: w.id, client_id: w.client_id, service_id: w.service_id, slot_id: slot.id, slot_start: slot.start_at,
      token: tok, status: 'pending', auto: auto ? 1 : 0, created_at: nowLocal(),
    });
    update('waitlist', w.id, { status: 'offered' });
    update('open_slots', slot.id, { status: 'offered' });
    const link = `${process.env.PUBLIC_URL || ''}/offer/${tok}`;
    sms(w.client_id, 'waitlist_offer',
      `${clinicName()}: a spot opened for ${svc.name} on ${fmtDay(slot.start_at)} at ${fmtTime12(slot.start_at)}. Reply here to claim it: ${link}`);
    logEvent('waitlist_offer', {
      client_id: w.client_id,
      detail: `${svc.name} slot ${fmtTime12(slot.start_at)} ${auto ? 'auto-offered' : 'offered'}`,
    });
    return id;
  });
}

function resolveOffer(offer, status, appointment_id = null) {
  update('offers', offer.id, { status, resolved_at: nowLocal(), appointment_id });
  if (status === 'accepted') return;
  // declined or expired: put the guest back on the list and re-open the slot for the next person
  if (offer.waitlist_id) update('waitlist', offer.waitlist_id, { status: 'waiting' });
  const slot = offer.slot_id ? get('SELECT * FROM open_slots WHERE id=?', offer.slot_id) : null;
  if (slot && slot.status === 'offered') {
    update('open_slots', slot.id, { status: 'open' });
    if (setting('autofill') === '1' && slot.end_at > nowLocal()) {
      const next = candidatesForSlot(slot).find((c) => c.client_id !== offer.client_id);
      if (next) makeOffer(next.id, slot.id, true);
    }
  }
}

export function offerByToken(tok) {
  const o = get(
    `SELECT o.*, c.name AS client_name, s.name AS service_name, s.duration_min FROM offers o
     JOIN clients c ON c.id=o.client_id JOIN services s ON s.id=o.service_id WHERE o.token=?`, tok,
  );
  if (!o) throw notFound('This offer link is not valid');
  return o;
}

export function respondOffer(offerId, accept, staffId = null) {
  return tx(() => {
    const o = get('SELECT * FROM offers WHERE id=?', offerId);
    if (!o) throw notFound('Offer not found');
    if (o.status !== 'pending') throw conflict(`This offer was already ${o.status}`);
    if (!accept) {
      resolveOffer(o, 'declined');
      return { status: 'declined' };
    }
    const slot = get('SELECT * FROM open_slots WHERE id=?', o.slot_id);
    const svc = get('SELECT * FROM services WHERE id=?', o.service_id);
    if (!slot || slot.status !== 'offered' || slot.end_at < nowLocal()) {
      resolveOffer(o, 'expired');
      throw conflict('Sorry — that spot is no longer available', 'gone');
    }
    try {
      assertFree({
        provider_id: slot.provider_id, resource_id: slot.resource_id, start_at: slot.start_at,
        end_at: addMinutes(slot.start_at, svc.duration_min),
      });
    } catch (e) {
      resolveOffer(o, 'expired');
      throw e;
    }
    const appt = createAppointment({
      client_id: o.client_id, service_id: o.service_id, provider_id: slot.provider_id,
      assistant_id: defaultAssistant(svc, slot.provider_id), resource_id: slot.resource_id, start_at: slot.start_at,
      channel: 'online', created_by: staffId, notes: 'Filled from waitlist',
    });
    resolveOffer(o, 'accepted', appt);
    update('waitlist', o.waitlist_id, { status: 'filled', resolved_at: nowLocal() });
    // keep any unused remainder of the slot open
    const used = addMinutes(slot.start_at, svc.duration_min);
    if (used < slot.end_at) {
      update('open_slots', slot.id, { status: 'filled' });
      createOpenSlot({ resource_id: slot.resource_id, provider_id: slot.provider_id, start_at: used, end_at: slot.end_at, reason: 'remainder' });
    } else update('open_slots', slot.id, { status: 'filled' });
    logEvent('waitlist_fill', {
      client_id: o.client_id, appointment_id: appt, staff_id: staffId,
      detail: `Reopened slot ${o.auto ? 'auto-offered and accepted' : 'offered and accepted'}`,
    });
    sms(o.client_id, 'appointment_confirmed', `${clinicName()}: you're booked — ${svc.name}, ${fmtDay(slot.start_at)} at ${fmtTime12(slot.start_at)}.`);
    return { status: 'accepted', appointment: apptById(appt) };
  });
}
