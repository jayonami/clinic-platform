import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const bad = (msg, code) => new HttpError(400, msg, code);
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const conflict = (msg, code = 'conflict') => new HttpError(409, msg, code);
export function need(cond, msg) {
  if (!cond) throw bad(msg);
}

const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDT = (d) => `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
export const nowLocal = () => fmtDT(new Date());
export const todayStr = () => fmtDate(new Date());
export const addMinutes = (s, m) => fmtDT(new Date(new Date(s).getTime() + m * 60000));
export const minutesBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 60000);
export const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
};
export const toHHMM = (s) => s.slice(11, 16);
export const mkDT = (date, hhmm) => `${date}T${hhmm}:00`;
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const isHHMM = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
export const hhmmToMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
export const minToHHMM = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export const normPhone = (p) => String(p ?? '').replace(/\D/g, '').slice(-10);
export const token = (n = 18) => crypto.randomBytes(n).toString('base64url');
export const cents = (v) => Math.round(Number(v) * 100);
export const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
export const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
export function int(v, label = 'value') {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`Invalid ${label}`);
  return n;
}
