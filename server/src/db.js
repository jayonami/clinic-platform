import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || path.resolve(here, '../data');
fs.mkdirSync(dataDir, { recursive: true });
export const dbPath = process.env.DB_PATH || path.join(dataDir, 'clinic.db');

export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const cache = new Map();
const stmt = (sql) => {
  let s = cache.get(sql);
  if (!s) cache.set(sql, (s = db.prepare(sql)));
  return s;
};
// node:sqlite rejects undefined and booleans; normalise bound params.
const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? +v : v));

export const all = (sql, ...p) => stmt(sql).all(...norm(p));
export const get = (sql, ...p) => stmt(sql).get(...norm(p)) ?? null;
export const run = (sql, ...p) => {
  const r = stmt(sql).run(...norm(p));
  return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
};
export const insert = (table, row) => {
  const keys = Object.keys(row);
  return run(
    `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
    ...keys.map((k) => row[k]),
  ).id;
};
export const update = (table, id, row) => {
  const keys = Object.keys(row);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...keys.map((k) => row[k]), id);
};

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth++;
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, short_name TEXT NOT NULL, initials TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, pin_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reception','provider')),
  title TEXT, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('consult','procedure','styling')),
  sort INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'General',
  description TEXT NOT NULL DEFAULT '', duration_min INTEGER NOT NULL, price_cents INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('consult','procedure','styling')),
  sessions_total INTEGER, provider_pct REAL NOT NULL DEFAULT 15, assistant_pct REAL NOT NULL DEFAULT 10,
  online_bookable INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS service_providers (
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, staff_id)
);
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, unit_cost_cents INTEGER NOT NULL DEFAULT 0,
  sell_price_cents INTEGER, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS service_items (
  id INTEGER PRIMARY KEY, service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id), qty REAL NOT NULL DEFAULT 1, unit_cost_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, percent REAL NOT NULL,
  weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5', active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL, phone_norm TEXT NOT NULL UNIQUE,
  email TEXT, language TEXT NOT NULL DEFAULT 'English', referred_by TEXT, notes TEXT,
  credit_cents INTEGER NOT NULL DEFAULT 0, token TEXT UNIQUE, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS appointments (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  service_id INTEGER NOT NULL REFERENCES services(id),
  provider_id INTEGER NOT NULL REFERENCES staff(id), assistant_id INTEGER REFERENCES staff(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked'
    CHECK (status IN ('booked','checked_in','in_room','with_provider','done','no_show','cancelled')),
  channel TEXT NOT NULL DEFAULT 'call_centre' CHECK (channel IN ('call_centre','walk_in','online')),
  notes TEXT, request_id INTEGER, created_by INTEGER REFERENCES staff(id),
  checked_in_at TEXT, room_at TEXT, started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_appt_start ON appointments(start_at);
CREATE INDEX IF NOT EXISTS idx_appt_client ON appointments(client_id);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);

CREATE TABLE IF NOT EXISTS appointment_addons (
  id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id), included INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS appointment_changes (
  id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('create','reschedule','cancel','no_show')),
  from_start TEXT, to_start TEXT, reason TEXT, by_staff_id INTEGER REFERENCES staff(id),
  by_client INTEGER NOT NULL DEFAULT 0, notified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS consultations (
  id INTEGER PRIMARY KEY, appointment_id INTEGER NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES staff(id), notes TEXT NOT NULL DEFAULT '',
  recommended_json TEXT NOT NULL DEFAULT '[]', started_at TEXT, finished_at TEXT
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY, appointment_id INTEGER REFERENCES appointments(id),
  client_id INTEGER NOT NULL REFERENCES clients(id), public_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'quotation' CHECK (status IN ('quotation','open','partial','paid','void')),
  subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0, discount_label TEXT,
  tax_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0, paid_cents INTEGER NOT NULL DEFAULT 0,
  quoted_by INTEGER REFERENCES staff(id), quoted_at TEXT, service_date TEXT NOT NULL,
  finalized_at TEXT, collected_on TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_inv_client ON invoices(client_id);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service','product','addon')),
  service_id INTEGER REFERENCES services(id), item_id INTEGER REFERENCES items(id),
  description TEXT NOT NULL, detail TEXT, qty INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL, amount_cents INTEGER NOT NULL, sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS line_staff (
  id INTEGER PRIMARY KEY, line_id INTEGER NOT NULL REFERENCES invoice_lines(id) ON DELETE CASCADE,
  staff_id INTEGER NOT NULL REFERENCES staff(id), role TEXT NOT NULL, pct REAL NOT NULL DEFAULT 0,
  commission_cents INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL, method TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'payment',
  note TEXT, created_by INTEGER REFERENCES staff(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS financing_plans (
  id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  lender TEXT NOT NULL, months INTEGER NOT NULL, financed_cents INTEGER NOT NULL, monthly_cents INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  service_id INTEGER NOT NULL REFERENCES services(id), note TEXT,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','offered','filled','removed')),
  created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS open_slots (
  id INTEGER PRIMARY KEY, resource_id INTEGER NOT NULL REFERENCES resources(id),
  provider_id INTEGER NOT NULL REFERENCES staff(id), start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','offered','filled','expired')),
  source_appointment_id INTEGER, reason TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
  id INTEGER PRIMARY KEY, waitlist_id INTEGER REFERENCES waitlist(id), client_id INTEGER NOT NULL REFERENCES clients(id),
  service_id INTEGER NOT NULL REFERENCES services(id), slot_id INTEGER REFERENCES open_slots(id),
  slot_start TEXT, token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','expired')),
  auto INTEGER NOT NULL DEFAULT 0, appointment_id INTEGER, created_at TEXT NOT NULL, resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS booking_requests (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  service_id INTEGER NOT NULL REFERENCES services(id), preferred_date TEXT NOT NULL,
  time_of_day TEXT NOT NULL CHECK (time_of_day IN ('morning','afternoon','evening')), notes TEXT,
  kind TEXT NOT NULL DEFAULT 'new' CHECK (kind IN ('new','reschedule')), for_appointment_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined')),
  appointment_id INTEGER, created_at TEXT NOT NULL, resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL REFERENCES clients(id),
  direction TEXT NOT NULL DEFAULT 'out', template TEXT, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', by_staff_id INTEGER, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, client_id INTEGER, appointment_id INTEGER, staff_id INTEGER,
  detail TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
CREATE TABLE IF NOT EXISTS followups (
  id INTEGER PRIMARY KEY, client_id INTEGER NOT NULL, appointment_id INTEGER, assigned_staff_id INTEGER,
  type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, staff_id INTEGER NOT NULL, appointment_id INTEGER, body TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
`);
