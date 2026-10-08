export const money = (cents, { sign = false } = {}) => {
  const n = (cents ?? 0) / 100;
  const whole = Number.isInteger(Math.round(n * 100) / 100) && Math.round(n * 100) % 100 === 0;
  const s = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return n < 0 ? `−${s}` : sign && n > 0 ? `+${s}` : s;
};
export const money2 = (cents) => ((cents ?? 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export const parse = (s) => new Date(s);
export const hhmm = (s) => s.slice(11, 16);
export function time12(s) {
  const hh = +s.slice(11, 13);
  return `${hh % 12 || 12}:${s.slice(14, 16)} ${hh >= 12 ? 'PM' : 'AM'}`;
}
export const time12short = (s) => time12(s).replace(':00 ', ' ');
export const hhmmTo12 = (t) => time12(`2000-01-01T${t}:00`);
const D = (s) => new Date(`${s.slice(0, 10)}T12:00:00`);
export const longDate = (s) => D(s).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = (s) => D(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
export const fullShortDate = (s) => D(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const mdy = (s) => D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
export const md = (s) => D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const addDays = (s, n) => {
  const d = D(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
export const minutesSince = (ts, now = Date.now()) => Math.max(0, Math.round((now - new Date(ts).getTime()) / 60000));
export const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const dollarsToCents = (v) => Math.round(Number(String(v).replace(/[^0-9.]/g, '')) * 100) || 0;
export const centsToInput = (c) => (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
export const windowLabel = (w) => {
  const a = hhmmTo12(w.from);
  const b = hhmmTo12(w.to);
  return a.slice(-2) === b.slice(-2) ? `${a.slice(0, -3)}–${b}` : `${a}–${b}`;
};
export const METHOD = { card: 'Card', upi: 'UPI', cash: 'Cash', package_credit: 'Package credit', financing: 'Financing', apple_pay: 'Apple Pay' };
