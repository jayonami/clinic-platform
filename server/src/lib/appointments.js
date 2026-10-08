import { all, get, insert, update } from '../db.js';
import { setting } from './settings.js';
import {
  addMinutes, bad, conflict, hhmmToMin, minToHHMM, mkDT, nowLocal, notFound, minutesBetween,
} from './util.js';

const ACTIVE = `('booked','checked_in','in_room','with_provider','done')`;

export const APPT_SQL = `
SELECT a.*, c.name AS client_name, c.phone AS client_phone, c.language AS client_language,
  s.name AS service_name, s.kind AS service_kind, s.duration_min, s.price_cents AS service_price_cents,
  s.sessions_total, p.name AS provider_name, p.short_name AS provider_short, p.initials AS provider_initials,
  ast.short_name AS assistant_short, r.name AS resource_name, r.label AS resource_label, r.kind AS resource_kind,
  CASE WHEN s.sessions_total IS NULL THEN NULL ELSE
    (SELECT COUNT(*) FROM appointments x WHERE x.client_id=a.client_id AND x.service_id=a.service_id
       AND x.status='done' AND x.start_at < a.start_at) + 1 END AS session_no,
  (SELECT group_concat(sv.name, ' + ') FROM appointment_addons ad JOIN services sv ON sv.id=ad.service_id
     WHERE ad.appointment_id=a.id) AS addon_names
FROM appointments a
JOIN clients c ON c.id=a.client_id
JOIN services s ON s.id=a.service_id
JOIN staff p ON p.id=a.provider_id
LEFT JOIN staff ast ON ast.id=a.assistant_id
JOIN resources r ON r.id=a.resource_id`;

export const apptById = (id) => get(`${APPT_SQL} WHERE a.id=?`, id);
export const apptOr404 = (id) => apptById(id) ?? (() => { throw notFound('Appointment not found'); })();
export const apptsForDate = (date) =>
  all(`${APPT_SQL} WHERE substr(a.start_at,1,10)=? AND a.status!='cancelled' ORDER BY a.start_at`, date);

export function hours() {
  return {
    open: hhmmToMin(setting('open_time')),
    close: hhmmToMin(setting('close_time')),
    lunchStart: hhmmToMin(setting('lunch_start')),
    lunchEnd: hhmmToMin(setting('lunch_end')),
    step: +setting('slot_step_min') || 30,
  };
}

/** Throws 409 if the provider or room is busy, or the span touches lunch / closing hours. */
export function assertFree({ provider_id, resource_id, start_at, end_at, exclude_id = null, allowPast = false, ignoreHours = false }) {
  const h = hours();
  const date = start_at.slice(0, 10);
  const sMin = hhmmToMin(start_at.slice(11, 16));
  const eMin = sMin + minutesBetween(start_at, end_at);
  if (end_at.slice(0, 10) !== date) throw bad('Appointment must finish on the same day');
  if (!ignoreHours) {
    if (sMin < h.open || eMin > h.close) throw conflict(`Outside clinic hours (${setting('open_time')}–${setting('close_time')})`, 'hours');
    if (sMin < h.lunchEnd && eMin > h.lunchStart) throw conflict('That time overlaps the lunch break', 'lunch');
  }
  if (!allowPast && start_at.slice(0, 16) < nowLocal().slice(0, 16)) throw conflict('That time is in the past', 'past');
  const clash = get(
    `SELECT a.id, a.provider_id, a.resource_id FROM appointments a
     WHERE a.status IN ${ACTIVE} AND a.id != ? AND a.start_at < ? AND a.end_at > ?
       AND (a.provider_id=? OR a.resource_id=?) LIMIT 1`,
    exclude_id ?? -1, end_at, start_at, provider_id, resource_id,
  );
  if (clash) {
    throw conflict(clash.provider_id === +provider_id ? 'That provider is already booked at this time' : 'That room is already booked at this time', 'busy');
  }
}

/** Time chips for the booking form. */
export function availability({ date, duration, provider_id, resource_id, exclude_id = null }) {
  const h = hours();
  const now = nowLocal();
  const day = all(
    `SELECT start_at, end_at, provider_id, resource_id FROM appointments
     WHERE status IN ${ACTIVE} AND id != ? AND substr(start_at,1,10)=? AND (provider_id=? OR resource_id=?)`,
    exclude_id ?? -1, date, provider_id, resource_id,
  );
  const out = [];
  for (let m = h.open; m + duration <= h.close; m += h.step) {
    const time = minToHHMM(m);
    const start = mkDT(date, time);
    const end = addMinutes(start, duration);
    let reason = null;
    if (m < h.lunchEnd && m + duration > h.lunchStart) reason = 'lunch';
    else if (start < now) reason = 'past';
    else if (day.some((a) => a.start_at < end && a.end_at > start)) reason = 'full';
    out.push({ time, available: !reason, reason });
  }
  return out;
}

const TRANSITIONS = {
  booked: ['checked_in', 'in_room', 'with_provider', 'no_show', 'cancelled'],
  checked_in: ['in_room', 'with_provider', 'booked', 'no_show', 'cancelled'],
  in_room: ['with_provider', 'checked_in', 'done'],
  with_provider: ['done', 'in_room'],
  done: [],
  no_show: ['booked'],
  cancelled: [],
};
export const canTransition = (from, to) => TRANSITIONS[from]?.includes(to);

export function setStatus(id, to) {
  const a = apptOr404(id);
  if (!canTransition(a.status, to)) throw conflict(`Cannot move a ${a.status.replace('_', ' ')} appointment to ${to.replace('_', ' ')}`);
  const now = nowLocal();
  const patch = { status: to };
  if (to === 'checked_in') patch.checked_in_at = a.checked_in_at ?? now;
  if (to === 'in_room') {
    patch.checked_in_at = a.checked_in_at ?? now;
    patch.room_at = now;
  }
  if (to === 'with_provider') {
    patch.checked_in_at = a.checked_in_at ?? now;
    patch.room_at = a.room_at ?? now;
    patch.started_at = now;
  }
  if (to === 'done') patch.finished_at = now;
  if (to === 'booked') Object.assign(patch, { checked_in_at: null, room_at: null, started_at: null });
  update('appointments', id, patch);
  return apptById(id);
}

export function createAppointment({
  client_id, service_id, provider_id, assistant_id = null, resource_id, start_at, channel, notes = null,
  created_by = null, request_id = null, status = 'booked', allowPast = false, ignoreHours = false,
}) {
  const svc = get('SELECT * FROM services WHERE id=? AND active=1', service_id);
  if (!svc) throw bad('Unknown service');
  const res = get('SELECT * FROM resources WHERE id=? AND active=1', resource_id);
  if (!res) throw bad('Unknown room');
  if (!get('SELECT id FROM staff WHERE id=? AND active=1 AND role=\'provider\'', provider_id)) throw bad('Unknown provider');
  if (res.kind !== svc.kind) throw bad(`${svc.name} can't be done in ${res.name}`);
  const end_at = addMinutes(start_at, svc.duration_min);
  assertFree({ provider_id, resource_id, start_at, end_at, allowPast, ignoreHours });
  const now = nowLocal();
  const id = insert('appointments', {
    client_id, service_id, provider_id, assistant_id, resource_id, start_at, end_at, status, channel, notes,
    request_id, created_by, created_at: now, checked_in_at: status === 'checked_in' ? now : null,
  });
  insert('appointment_changes', { appointment_id: id, type: 'create', to_start: start_at, by_staff_id: created_by, created_at: now });
  return id;
}

export function visitsCount(clientId) {
  return get(`SELECT COUNT(*) n FROM appointments WHERE client_id=? AND status='done'`, clientId).n;
}

/** A sensible default provider+room for a service, used by walk-ins and online requests. */
export function pickProviderAndRoom(service, start_at) {
  const end_at = addMinutes(start_at, service.duration_min);
  const providers = all(
    `SELECT s.id FROM staff s JOIN service_providers sp ON sp.staff_id=s.id
     WHERE sp.service_id=? AND s.active=1 AND s.role='provider' ORDER BY s.id`, service.id,
  );
  const rooms = all(`SELECT id FROM resources WHERE kind=? AND active=1 ORDER BY sort, id`, service.kind);
  for (const p of providers) {
    for (const r of rooms) {
      try {
        assertFree({ provider_id: p.id, resource_id: r.id, start_at, end_at });
        return { provider_id: p.id, resource_id: r.id };
      } catch { /* try the next combination */ }
    }
  }
  return null;
}

export function defaultAssistant(service, provider_id) {
  if (service.kind === 'consult' || !(service.assistant_pct > 0)) return null;
  const row = get(
    `SELECT s.id FROM staff s JOIN service_providers sp ON sp.staff_id=s.id
     WHERE sp.service_id=? AND s.id!=? AND s.active=1 AND s.role='provider' ORDER BY s.id LIMIT 1`, service.id, provider_id,
  );
  return row?.id ?? null;
}

export const timeOfDayRange = {
  morning: ['09:00', '12:00'],
  afternoon: ['14:00', '16:00'],
  evening: ['16:00', '18:00'],
};

