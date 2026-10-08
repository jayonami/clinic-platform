import { get, insert } from '../db.js';
import { nowLocal } from './util.js';
import { setting } from './settings.js';

/** Messages are written to the `messages` table. Swap the body of `deliver` for Twilio/etc. to send real SMS. */
function deliver(_phone, _body) {
  return 'sent';
}

export function sms(clientId, template, body, byStaffId = null) {
  const c = get('SELECT phone FROM clients WHERE id=?', clientId);
  if (!c) return null;
  const status = deliver(c.phone, body);
  return insert('messages', {
    client_id: clientId,
    direction: 'out',
    template,
    body,
    status,
    by_staff_id: byStaffId,
    created_at: nowLocal(),
  });
}

export function logEvent(type, { client_id = null, appointment_id = null, staff_id = null, detail }) {
  return insert('events', { type, client_id, appointment_id, staff_id, detail, created_at: nowLocal() });
}

export function notifyStaff(staffId, appointmentId, body) {
  return insert('notifications', { staff_id: staffId, appointment_id: appointmentId, body, read: 0, created_at: nowLocal() });
}

export const clinicName = () => setting('clinic_name');

const t12 = (hhmm) => {
  let h = +hhmm.slice(0, 2);
  const m = hhmm.slice(3, 5);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ap}`;
};
export const fmtTime12 = (dt) => t12(dt.slice(11, 16));
export const fmtDay = (dt) =>
  new Date(`${dt.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
