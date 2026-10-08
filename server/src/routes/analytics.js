import { Router } from 'express';
import { all, get } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { addDays, nowLocal, todayStr } from '../lib/util.js';
import { getSettings } from '../lib/settings.js';

const r = Router();
const pct = (n, d) => (d ? (n / d) * 100 : null);

function conversion(from, to) {
  const consults = all(
    `SELECT a.id, a.client_id, a.start_at FROM appointments a JOIN services s ON s.id=a.service_id
     WHERE s.kind='consult' AND a.status='done' AND substr(a.start_at,1,10) BETWEEN ? AND ?`, from, to,
  );
  let converted = 0;
  for (const c of consults) {
    const hit = get(
      `SELECT 1 FROM appointments a JOIN services s ON s.id=a.service_id
       WHERE a.client_id=? AND s.kind IN ('procedure','styling') AND a.status IN ('booked','checked_in','in_room','with_provider','done')
         AND a.start_at>? AND substr(a.start_at,1,10)<=? LIMIT 1`,
      c.client_id, c.start_at, addDays(c.start_at.slice(0, 10), 14),
    );
    if (hit) converted++;
  }
  return { rate: pct(converted, consults.length), consults: consults.length, converted };
}

const avgWait = (from, to) =>
  get(
    `SELECT AVG((julianday(COALESCE(room_at, started_at)) - julianday(checked_in_at)) * 1440.0) AS m, COUNT(*) AS n
     FROM appointments WHERE checked_in_at IS NOT NULL AND COALESCE(room_at, started_at) IS NOT NULL
       AND substr(start_at,1,10) BETWEEN ? AND ?`, from, to,
  );

function fillRate(from, to) {
  const x = get(
    `SELECT SUM(status='accepted') AS ok, COUNT(*) AS n FROM offers WHERE status!='pending' AND substr(resolved_at,1,10) BETWEEN ? AND ?`, from, to,
  );
  return { rate: pct(x.ok ?? 0, x.n), offers: x.n };
}

r.get('/analytics', staffAuth('reception'), (_req, res) => {
  const today = todayStr();
  const now = nowLocal();
  const s = getSettings();

  const todayRows = all(`SELECT status, channel FROM appointments WHERE substr(start_at,1,10)=? AND status!='cancelled'`, today);
  const noShows = todayRows.filter((a) => a.status === 'no_show').length;

  const wk = { from: addDays(today, -6), to: today };
  const prevWk = { from: addDays(today, -13), to: addDays(today, -7) };
  // consult→treatment needs a bigger sample than a single week
  const conv = conversion(addDays(today, -27), today);
  const convPrev = conversion(addDays(today, -55), addDays(today, -28));
  const wait = avgWait(wk.from, wk.to);
  const waitPrev = avgWait(prevWk.from, prevWk.to);

  const month = { from: addDays(today, -29), to: today };
  const prevMonth = { from: addDays(today, -59), to: addDays(today, -30) };
  const fill = fillRate(month.from, month.to);
  const fillPrev = fillRate(prevMonth.from, prevMonth.to);

  const outstanding = get(
    `SELECT COUNT(*) n, COALESCE(SUM(total_cents-paid_cents),0) cents FROM invoices WHERE status IN ('open','partial')`,
  );
  const resched = all(`SELECT reason FROM appointment_changes WHERE type='reschedule' AND substr(created_at,1,10)=?`, today);

  const trend = Array.from({ length: 8 }, (_, i) => {
    const to = addDays(today, -7 * (7 - i));
    const from = addDays(to, -6);
    const x = get(
      `SELECT SUM(status='no_show') AS ns, COUNT(*) AS n FROM appointments
       WHERE status IN ('done','no_show') AND substr(start_at,1,10) BETWEEN ? AND ? AND start_at<?`, from, to, now,
    );
    return { from, to, rate: pct(x.ns ?? 0, x.n), no_shows: x.ns ?? 0, total: x.n };
  });

  const exceptions = all(
    `SELECT e.id, e.type, e.detail, e.created_at, c.name AS client_name FROM events e LEFT JOIN clients c ON c.id=e.client_id
     WHERE substr(e.created_at,1,10)=? AND e.type IN ('no_show','reschedule','cancel','waitlist_fill') ORDER BY e.created_at, e.id`, today,
  );

  res.json({
    date: today, clinic_name: s.clinic_name,
    bookings: { total: todayRows.length, no_shows: noShows, no_show_pct: pct(noShows, todayRows.length) },
    conversion: { ...conv, prev: convPrev.rate, delta: conv.rate != null && convPrev.rate != null ? conv.rate - convPrev.rate : null },
    wait: { minutes: wait.m, prev: waitPrev.m, delta: wait.m != null && waitPrev.m != null ? wait.m - waitPrev.m : null },
    outstanding: { cents: outstanding.cents, invoices: outstanding.n },
    waitlist_fill: { ...fill, prev: fillPrev.rate, delta: fill.rate != null && fillPrev.rate != null ? fill.rate - fillPrev.rate : null },
    reschedules: { total: resched.length, untracked: resched.filter((x) => !x.reason).length },
    channels: ['call_centre', 'walk_in', 'online'].map((k) => ({ key: k, count: todayRows.filter((a) => a.channel === k).length })),
    trend, exceptions,
  });
});

export default r;
