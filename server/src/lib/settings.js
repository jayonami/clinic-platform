import { all, get, run } from '../db.js';

export const DEFAULTS = {
  brand_name: 'Your Brand',
  clinic_name: 'Austin Clinic',
  open_time: '09:00',
  close_time: '18:00',
  lunch_start: '13:00',
  lunch_end: '14:00',
  slot_step_min: '30',
  tax_rate_pct: '8',
  round_totals: '1',
  autofill: '1',
  offer_ttl_min: '30',
  cancel_window_hours: '24',
  financing_lender: 'Affirm',
  financing_months: '3',
  default_deposit_cents: '20000',
};

export function seedDefaultSettings() {
  for (const [k, v] of Object.entries(DEFAULTS)) {
    run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', k, v);
  }
}

export function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of all('SELECT key, value FROM settings')) out[r.key] = r.value;
  return out;
}
export const setting = (key) => get('SELECT value FROM settings WHERE key=?', key)?.value ?? DEFAULTS[key];
export const setSetting = (key, value) =>
  run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
