import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain && process.argv.includes('--reset')) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const base = process.env.DB_PATH || path.join(process.env.DATA_DIR || path.resolve(here, '../data'), 'clinic.db');
  for (const f of [base, `${base}-wal`, `${base}-shm`]) fs.rmSync(f, { force: true });
}

const { all, get, insert, run, update, tx } = await import('./db.js');
const { hashPin } = await import('./lib/auth.js');
const { seedDefaultSettings } = await import('./lib/settings.js');
const U = await import('./lib/util.js');
const { createAppointment, setStatus } = await import('./lib/appointments.js');
const { buildQuotation, invoiceForAppointment, refreshInvoice, addInvoiceLine } = await import('./lib/billing.js');

const { addDays, todayStr, fmtDT, nowLocal, addMinutes } = U;

// small deterministic PRNG so every seed looks the same
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedBody() {
  const rnd = mulberry32(2026);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const chance = (p) => rnd() < p;
  const today = todayStr();
  const at = (off, hhmm) => `${addDays(today, off)}T${hhmm}:00`;
  const minsAgo = (n) => fmtDT(new Date(Date.now() - n * 60000));
  const pin = hashPin(process.env.DEMO_PIN || '1234');

  seedDefaultSettings();

  // ---------- people & places ----------
  const staff = {};
  for (const [key, name, short, initials, email, role, title] of [
    ['rhea', 'Rhea Nair', 'Rhea N.', 'RN', 'rhea@clinic.test', 'reception', 'Front desk'],
    ['carter', 'Dr. Michael Carter', 'Dr. Carter', 'MC', 'carter@clinic.test', 'provider', 'Dermatologist'],
    ['jessica', 'Jessica K.', 'Jessica K.', 'JK', 'jessica@clinic.test', 'provider', 'Senior therapist'],
    ['maya', 'Maya T.', 'Maya T.', 'MT', 'maya@clinic.test', 'provider', 'Stylist'],
    ['anika', 'Anika S.', 'Anika S.', 'AS', 'anika@clinic.test', 'provider', 'Spa therapist'],
  ]) staff[key] = insert('staff', { name, short_name: short, initials, email, pin_hash: pin, role, title, active: 1 });

  const res = {};
  [['consult', 'Consult', 'Dr. Carter — Consult', 'consult'], ['room1', 'Therapist 1', 'Therapist 1', 'procedure'],
    ['room2', 'Therapist 2', 'Therapist 2', 'procedure'], ['room3', 'Therapist 3', 'Therapist 3', 'styling']].forEach(([k, name, label, kind], i) => {
    res[k] = insert('resources', { name, label, kind, sort: i, active: 1 });
  });

  // ---------- catalogue ----------
  const svc = {};
  const addSvc = (key, name, category, kind, mins, price, providers, extra = {}) => {
    svc[key] = insert('services', {
      name, category, kind, duration_min: mins, price_cents: price * 100, description: extra.description ?? '',
      sessions_total: extra.sessions ?? null, provider_pct: extra.ppct ?? 15, assistant_pct: extra.apct ?? 0,
      online_bookable: extra.online ?? 1, active: 1, sort: Object.keys(svc).length,
    });
    for (const p of providers) insert('service_providers', { service_id: svc[key], staff_id: staff[p] });
  };
  addSvc('newConsult', 'New Consultation', 'Consultations', 'consult', 30, 50, ['carter'], { description: 'First visit — skin and treatment-plan assessment.' });
  addSvc('consult', 'Consultation', 'Consultations', 'consult', 30, 95, ['carter']);
  addSvc('followup', 'Follow-up', 'Consultations', 'consult', 30, 0, ['carter'], { online: 0, description: 'Complimentary check-in for clients on a treatment plan.' });
  addSvc('skin', 'Skin Consultation', 'Consultations', 'consult', 30, 95, ['carter']);
  addSvc('laser', 'Laser Hair Reduction — Full Body', 'Laser treatments', 'procedure', 90, 950, ['jessica', 'carter'], {
    apct: 10, sessions: 6, description: '6-session package covering full body treatment areas, delivered across two sittings per session. Includes pre-treatment consult and aftercare gel.',
  });
  addSvc('toning', 'Laser Toning', 'Laser treatments', 'procedure', 60, 220, ['jessica', 'carter'], { apct: 10 });
  addSvc('peel', 'Chemical Peel', 'Skin', 'procedure', 45, 180, ['jessica', 'carter'], { apct: 10 });
  addSvc('facial', 'Facial', 'Skin', 'procedure', 60, 120, ['jessica', 'anika']);
  addSvc('hairspa', 'Hair Spa', 'Hair', 'procedure', 60, 85, ['anika', 'maya', 'jessica']);
  addSvc('color', 'Haircut & Color', 'Hair', 'styling', 120, 160, ['maya']);
  addSvc('mani', 'Mani-pedi', 'Nails', 'styling', 60, 75, ['maya']);
  addSvc('thread', 'Threading', 'Brows', 'styling', 15, 25, ['maya'], { ppct: 20, apct: 0 });

  const item = {};
  const addItem = (key, name, cost, sell = null) => { item[key] = insert('items', { name, unit_cost_cents: cost * 100, sell_price_cents: sell ? sell * 100 : null, active: 1 }); };
  addItem('numb', 'Numbing cream', 12);
  addItem('tip', 'Laser tip (consumable)', 8);
  addItem('gel', 'Post-laser soothing gel', 14, 38);
  addItem('gown', 'Disposable gown & drape', 6);
  addItem('spf', 'Mineral sunscreen SPF 50', 14, 32);
  const link = (s, i, qty, cost) => insert('service_items', { service_id: svc[s], item_id: item[i], qty, unit_cost_cents: cost * 100 });
  link('laser', 'numb', 1, 12); link('laser', 'tip', 2, 8); link('laser', 'gel', 1, 14); link('laser', 'gown', 1, 6);
  link('toning', 'tip', 1, 8); link('toning', 'gel', 1, 14);
  link('peel', 'numb', 1, 12); link('peel', 'spf', 1, 14); link('peel', 'gown', 1, 6);
  link('facial', 'spf', 1, 14); link('facial', 'gown', 1, 6);
  insert('promotions', { name: 'Weekday Special', percent: 10, weekdays: '1,2,3,4,5', active: 1 });

  // ---------- clients ----------
  let phoneSeq = 100;
  const clients = {};
  const addClient = (key, name, extra = {}) => {
    const n = phoneSeq++;
    const phone = extra.phone ?? `(555) 0${String(n).slice(0, 2)}-${String(4000 + n * 7).slice(-4)}`;
    clients[key] = insert('clients', {
      name, phone, phone_norm: U.normPhone(phone), email: extra.email ?? null, language: extra.language ?? 'English',
      referred_by: extra.ref ?? null, credit_cents: extra.credit ?? 0, created_at: at(extra.since ?? -300, '10:00'),
    });
  };
  addClient('olivia', 'Olivia Bennett', { phone: '(555) 017-4821', email: 'olivia.bennett@email.com', since: -202 });
  addClient('ethan', 'Ethan Brooks'); addClient('sophia', 'Sophia Reed'); addClient('natalie', 'Natalie Cole');
  addClient('grace', 'Grace Walker', { phone: '(555) 044-2291', credit: 50000 });
  addClient('hannah', 'Hannah Price'); addClient('lucas', 'Lucas Turner'); addClient('noah', 'Noah Mitchell');
  addClient('chloe', 'Chloe Adams'); addClient('ava', 'Ava Phillips'); addClient('tyler', 'Tyler Morgan');
  addClient('lily', 'Lily Simmons'); addClient('kabir', 'Kabir Singh', { language: 'English' });
  addClient('priya', 'Priya Shah'); addClient('zoe', 'Zoe Martin', { language: 'Español' });
  addClient('mia', 'Mia Foster'); addClient('jordan', 'Jordan Lee');
  const pool = [];
  const first = ['Amelia', 'Liam', 'Harper', 'Mason', 'Ella', 'Henry', 'Aria', 'Jack', 'Isla', 'Owen', 'Nora', 'Caleb', 'Ruby', 'Leo', 'Stella', 'Eli', 'Maya', 'Finn', 'Layla', 'Jude'];
  const last = ['Hart', 'Ortiz', 'Young', 'Clark', 'Rivera', 'Scott', 'Patel', 'Nguyen', 'Murphy', 'Bailey', 'Diaz', 'Ward'];
  for (let i = 0; i < 72; i++) {
    const k = `p${i}`;
    addClient(k, `${first[i % first.length]} ${last[(i * 5 + Math.floor(i / first.length)) % last.length]}`, { ref: pick(['Online search', 'Friend or family', 'Walk-in', 'Social media']) });
    pool.push(clients[k]);
  }

  // ---------- history (8 weeks) ----------
  const noShowPlan = [4, 4, 4, 3, 3, 3, 2, 1]; // per 7-day bucket, oldest first
  const waitPlan = [13, 12, 12, 12, 11, 11, 11, 7];
  const convPlan = [0.28, 0.28, 0.3, 0.3, 0.5, 0.55, 0.55, 0.6];
  const bucketOf = (o) => 7 - Math.floor(-o / 7);
  const rows = [];
  const lastConsult = {};
  const followDays = new Set(); // at most one consult→treatment follow-up per day
  const notesPool = [
    'Skin tolerated treatment well. Mild redness, resolved within 2 days. No adverse reaction.',
    'Discussed treatment plan and expectations. Patch test clear. Advised SPF daily.',
    'Reviewed progress — good response. Continue as scheduled.',
    'Client reports less sensitivity than last time. Area well tolerated.',
  ];
  const daySlots = [['consult', '09:30'], ['room1', '10:00'], ['room3', '11:00'], ['room2', '14:00']];
  for (let o = -55; o <= -1; o++) {
    const date = addDays(today, o);
    if (new Date(`${date}T12:00:00`).getDay() === 0) continue;
    const b = bucketOf(o);
    const used = new Set();
    for (const [rk, hhmm] of daySlots) {
      let key;
      if (rk === 'consult') key = pick(['consult', 'consult', 'skin', 'followup', 'newConsult']);
      else if (rk === 'room3') key = pick(['color', 'mani', 'thread']);
      else key = pick(['laser', 'toning', 'peel', 'facial', 'hairspa']);
      const recentConsult = (c) => lastConsult[c] && (new Date(`${date}T12:00:00`) - new Date(`${lastConsult[c]}T12:00:00`)) / 864e5 <= 14;
      let client = pick(pool);
      // keep chance matches out of the consult→treatment numbers: only planned follow-ups should convert
      while (used.has(client) || (rk !== 'consult' && recentConsult(client))) client = pick(pool);
      used.add(client);
      if (rk === 'consult') lastConsult[client] = date;
      const s = get('SELECT * FROM services WHERE id=?', svc[key]);
      const provider = get('SELECT staff_id FROM service_providers WHERE service_id=? ORDER BY rowid LIMIT 1', s.id).staff_id;
      rows.push({ o, b, date, rk, hhmm, key, s, provider, client });
    }
  }
  // choose no-shows / cancellations per bucket
  const byBucket = {};
  rows.forEach((r) => (byBucket[r.b] ??= []).push(r));
  for (const [b, list] of Object.entries(byBucket)) {
    const shuffled = [...list].sort(() => rnd() - 0.5);
    shuffled.slice(0, noShowPlan[b]).forEach((r) => (r.status = 'no_show'));
    shuffled.slice(noShowPlan[b], noShowPlan[b] + 1).forEach((r) => (r.status = 'cancelled'));
  }
  const channels = ['call_centre', 'call_centre', 'walk_in', 'online'];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    r.status ??= 'done';
    const start = `${r.date}T${r.hhmm}:00`;
    const assistant = r.s.assistant_pct > 0 && r.provider !== staff.carter ? staff.carter : null;
    const wait = Math.max(1, Math.round(waitPlan[r.b] + (rnd() - 0.5) * 6));
    const a = {
      client_id: r.client, service_id: r.s.id, provider_id: r.provider, assistant_id: assistant, resource_id: res[r.rk],
      start_at: start, end_at: addMinutes(start, r.s.duration_min), status: r.status, channel: pick(channels), created_by: staff.rhea,
      created_at: at(r.o - 3, '12:00'),
    };
    if (r.status === 'done') {
      a.checked_in_at = addMinutes(start, -(wait + 4));
      a.room_at = addMinutes(start, -4);
      a.started_at = addMinutes(start, 0);
      a.finished_at = a.end_at;
    }
    r.id = insert('appointments', a);
    if (r.status === 'cancelled') {
      insert('appointment_changes', { appointment_id: r.id, type: 'cancel', from_start: start, reason: 'Client cancelled', by_staff_id: staff.rhea, notified: 1, created_at: at(r.o - 1, '16:00') });
    }
    if (r.status === 'no_show') {
      insert('appointment_changes', { appointment_id: r.id, type: 'no_show', from_start: start, reason: 'No-show', by_staff_id: staff.rhea, created_at: start });
    }
    if (r.status !== 'done') continue;
    if (r.s.kind === 'consult') {
      insert('consultations', { appointment_id: r.id, provider_id: r.provider, notes: pick(notesPool), started_at: a.started_at, finished_at: a.finished_at });
      // some consultations turn into a treatment booking within the following days (past ones done, later ones booked)
      if (!r.isFollow && r.o < -1 && chance(convPlan[r.b])) {
        const d = addDays(r.date, 3 + Math.floor(rnd() * 5));
        const off = Math.round((new Date(`${d}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
        if (off !== 0 && new Date(`${d}T12:00:00`).getDay() !== 0 && !followDays.has(d)) {
          followDays.add(d);
          const key = pick(['laser', 'toning', 'peel', 'facial']);
          const fs = get('SELECT * FROM services WHERE id=?', svc[key]);
          rows.push({
            o: off, b: off > 0 ? 7 : bucketOf(off), date: d, rk: 'room1', hhmm: '16:00', key, s: fs, client: r.client, isFollow: true,
            provider: get('SELECT staff_id FROM service_providers WHERE service_id=? ORDER BY rowid LIMIT 1', fs.id).staff_id,
            status: off > 0 ? 'booked' : 'done',
          });
        }
      }
    }
    // billing
    const full = get(`SELECT a.*, 1 AS x FROM appointments a WHERE a.id=?`, r.id);
    const inv = invoiceForAppointment({ ...full, start_at: start });
    if (r.s.kind === 'procedure' && chance(0.3)) {
      update('invoices', inv.id, {});
      addInvoiceLine(inv.id, { item_id: item.spf });
    }
    const total = refreshInvoice(inv.id).total_cents;
    update('invoices', inv.id, { finalized_at: a.finished_at, quoted_at: a.finished_at, quoted_by: r.provider });
    const roll = rnd();
    const pay = (amt, kind = 'payment') => total > 0 && insert('payments', { invoice_id: inv.id, amount_cents: amt, method: pick(['card', 'card', 'upi', 'cash']), kind, created_by: staff.rhea, created_at: a.finished_at });
    if (roll < 0.93) pay(total);
    else if (roll < 0.97) pay(Math.round((total * (0.3 + rnd() * 0.4)) / 100) * 100, 'deposit');
    refreshInvoice(inv.id);
  }

  // Olivia's story from the wireframes (her real treatment history)
  const olivia = [
    [-202, 'newConsult', 'carter', 'consult', '10:00'], [-159, 'hairspa', 'jessica', 'room2', '11:00'],
    [-116, 'peel', 'jessica', 'room1', '10:00'], [-70, 'consult', 'carter', 'consult', '11:00'],
  ];
  const histVisit = (clientKey, off, svcKey, provKey, roomKey, hhmm, notes) => {
    const s = get('SELECT * FROM services WHERE id=?', svc[svcKey]);
    const start = at(off, hhmm);
    const id = insert('appointments', {
      client_id: clients[clientKey], service_id: s.id, provider_id: staff[provKey], assistant_id: s.assistant_pct > 0 && provKey !== 'carter' ? staff.carter : null,
      resource_id: res[roomKey], start_at: start, end_at: addMinutes(start, s.duration_min), status: 'done', channel: 'call_centre', created_by: staff.rhea,
      created_at: at(off - 5, '10:00'), checked_in_at: addMinutes(start, -9), room_at: addMinutes(start, -3), started_at: start, finished_at: addMinutes(start, s.duration_min),
    });
    if (notes) insert('consultations', { appointment_id: id, provider_id: staff[provKey], notes, started_at: start, finished_at: addMinutes(start, s.duration_min) });
    const inv = invoiceForAppointment({ ...get('SELECT * FROM appointments WHERE id=?', id) });
    const total = refreshInvoice(inv.id).total_cents;
    update('invoices', inv.id, { finalized_at: addMinutes(start, s.duration_min) });
    if (total) insert('payments', { invoice_id: inv.id, amount_cents: total, method: 'card', kind: 'payment', created_by: staff.rhea, created_at: addMinutes(start, s.duration_min) });
    refreshInvoice(inv.id);
    return id;
  };
  for (const [off, s, p, rm, t] of olivia) histVisit('olivia', off, s, p, rm, t, null);
  histVisit('olivia', -26, 'laser', 'jessica', 'room1', '10:00', 'Laser hair reduction, session 1/6. Skin tolerated treatment well.');
  histVisit('sophia', -26, 'laser', 'jessica', 'room2', '14:00', 'Laser hair reduction, session 1/6. Mild redness noted, resolved within 2 days. No adverse reaction.');
  histVisit('kabir', -20, 'consult', 'carter', 'consult', '10:30', 'Initial assessment. Plan agreed.');
  histVisit('ava', -12, 'laser', 'jessica', 'room1', '11:00', 'Session 1/6. No concerns.');

  // ---------- today ----------
  const mk = (clientKey, svcKey, provKey, assistKey, roomKey, hhmm, channel, status, extra = {}) => {
    const id = createAppointment({
      client_id: clients[clientKey], service_id: svc[svcKey], provider_id: staff[provKey], assistant_id: assistKey ? staff[assistKey] : null,
      resource_id: res[roomKey], start_at: at(0, hhmm), channel, created_by: staff.rhea, status: 'booked', allowPast: true, notes: extra.notes ?? null,
    });
    const patch = { status };
    if (extra.checkedIn != null) patch.checked_in_at = minsAgo(extra.checkedIn);
    if (extra.room != null) patch.room_at = minsAgo(extra.room);
    if (extra.started != null) patch.started_at = minsAgo(extra.started);
    if (extra.finished != null) patch.finished_at = minsAgo(extra.finished);
    update('appointments', id, patch);
    return id;
  };
  const kabirA = mk('kabir', 'consult', 'carter', null, 'consult', '09:00', 'call_centre', 'done', { checkedIn: 400, room: 392, started: 390, finished: 360 });
  const ethanA = mk('ethan', 'newConsult', 'carter', null, 'consult', '10:00', 'walk_in', 'checked_in', { checkedIn: 6 });
  const sophiaA = mk('sophia', 'followup', 'carter', null, 'consult', '12:00', 'call_centre', 'with_provider', { checkedIn: 25, room: 12, started: 4 });
  mk('priya', 'skin', 'carter', null, 'consult', '15:00', 'walk_in', 'booked');
  mk('noah', 'consult', 'carter', null, 'consult', '17:00', 'online', 'booked');
  const oliviaA = mk('olivia', 'laser', 'jessica', 'carter', 'room1', '10:00', 'call_centre', 'done', { checkedIn: 120, room: 112, started: 110, finished: 8 });
  const hannahA = mk('hannah', 'peel', 'jessica', 'carter', 'room1', '14:00', 'call_centre', 'booked');
  const lucasA = mk('lucas', 'toning', 'jessica', 'carter', 'room2', '09:00', 'call_centre', 'no_show');
  const natalieA = mk('natalie', 'hairspa', 'anika', null, 'room2', '11:00', 'call_centre', 'checked_in', { checkedIn: 2 });
  mk('zoe', 'facial', 'jessica', null, 'room2', '17:00', 'walk_in', 'booked');
  const graceA = mk('grace', 'color', 'maya', null, 'room3', '10:00', 'online', 'in_room', { checkedIn: 30, room: 18 });
  const chloeA = mk('chloe', 'mani', 'maya', null, 'room3', '17:00', 'online', 'booked');
  insert('appointment_addons', { appointment_id: hannahA, service_id: svc.consult, included: 1 });
  insert('appointment_addons', { appointment_id: oliviaA, service_id: svc.consult, included: 1 });

  // Olivia's next session is already on the books for next week
  createAppointment({
    client_id: clients.olivia, service_id: svc.laser, provider_id: staff.jessica, assistant_id: staff.carter, resource_id: res.room1,
    start_at: at(7, '14:00'), channel: 'online', created_by: staff.rhea, status: 'booked',
  });

  // Kabir: finished and paid. Olivia: quotation generated, $200 deposit taken, balance outstanding.
  const kApp = get('SELECT * FROM appointments WHERE id=?', kabirA);
  const kInv = buildQuotation(kApp, { service_ids: [], item_ids: [] }, staff.carter);
  update('invoices', kInv.id, { finalized_at: minsAgo(355) });
  insert('payments', { invoice_id: kInv.id, amount_cents: refreshInvoice(kInv.id).total_cents, method: 'card', kind: 'payment', created_by: staff.rhea, created_at: minsAgo(350) });
  refreshInvoice(kInv.id);
  insert('consultations', { appointment_id: kabirA, provider_id: staff.carter, notes: 'Consultation completed. No treatment needed today.', started_at: minsAgo(390), finished_at: minsAgo(360) });

  const oApp = get('SELECT * FROM appointments WHERE id=?', oliviaA);
  const oInv = buildQuotation(oApp, { service_ids: [], item_ids: [item.gel] }, staff.carter);
  insert('payments', { invoice_id: oInv.id, amount_cents: 20000, method: 'card', kind: 'deposit', created_by: staff.rhea, created_at: minsAgo(115) });
  refreshInvoice(oInv.id);
  insert('consultations', {
    appointment_id: oliviaA, provider_id: staff.carter, notes: 'Session 2 completed. Area well tolerated.', started_at: minsAgo(110), finished_at: minsAgo(8),
    recommended_json: JSON.stringify({ service_ids: [], item_ids: [item.gel] }),
  });
  insert('consultations', { appointment_id: sophiaA, provider_id: staff.carter, notes: '', started_at: minsAgo(4) });

  // reschedules logged today
  const resched = (apptId, from, reason, byShort, whenHHMM) => {
    const a = get('SELECT * FROM appointments WHERE id=?', apptId);
    const ts = at(0, whenHHMM);
    insert('appointment_changes', { appointment_id: apptId, type: 'reschedule', from_start: at(0, from), to_start: a.start_at, reason, by_staff_id: staff.rhea, notified: 1, created_at: ts });
    insert('events', { type: 'reschedule', client_id: a.client_id, appointment_id: apptId, detail: `Moved ${from} → ${a.start_at.slice(11, 16)} by ${byShort}`, created_at: ts });
  };
  resched(hannahA, '15:30', 'Client requested', 'Jessica K.', '11:15');
  resched(natalieA, '12:00', 'Provider unavailable', 'Rhea N.', '08:50');
  resched(graceA, '09:00', 'Client requested', 'Rhea N.', '08:20');
  resched(chloeA, '16:00', 'Client requested', 'Rhea N.', '10:05');
  insert('events', { type: 'no_show', client_id: clients.lucas, appointment_id: lucasA, detail: 'Follow-up call auto-assigned to Jessica K.', created_at: at(0, '09:40') });
  insert('appointment_changes', { appointment_id: lucasA, type: 'no_show', from_start: at(0, '09:00'), reason: 'No-show', by_staff_id: staff.rhea, created_at: at(0, '09:40') });
  insert('followups', { client_id: clients.lucas, appointment_id: lucasA, assigned_staff_id: staff.jessica, type: 'noshow_call', status: 'open', created_at: at(0, '09:40') });
  insert('events', { type: 'waitlist_fill', client_id: clients.jordan, detail: 'Reopened slot auto-offered and accepted', created_at: at(0, '11:40') });

  // waitlist + open slots
  for (const [ck, sk, mins] of [['ava', 'laser', 25], ['tyler', 'consult', 10], ['lily', 'hairspa', 5]]) {
    insert('waitlist', { client_id: clients[ck], service_id: svc[sk], status: 'waiting', created_at: minsAgo(mins) });
  }
  insert('open_slots', { resource_id: res.room1, provider_id: staff.jessica, start_at: at(0, '15:30'), end_at: at(0, '17:00'), status: 'open', reason: 'cancelled', created_at: at(0, '13:40') });
  insert('open_slots', { resource_id: res.consult, provider_id: staff.carter, start_at: at(0, '16:00'), end_at: at(0, '17:00'), status: 'open', reason: 'cancelled', created_at: at(0, '12:20') });

  // waitlist history: this month 9/11 accepted, last month 13/20
  const offer = (daysAgo, status) => insert('offers', {
    client_id: pick(pool), service_id: svc[pick(['laser', 'consult', 'hairspa', 'peel'])], token: U.token(10), status, auto: chance(0.7) ? 1 : 0,
    created_at: at(-daysAgo, '10:00'), resolved_at: at(-daysAgo, '10:20'),
  });
  for (let i = 0; i < 11; i++) offer(1 + Math.floor(rnd() * 28), i < 9 ? 'accepted' : 'declined');
  for (let i = 0; i < 20; i++) offer(31 + Math.floor(rnd() * 28), i < 13 ? 'accepted' : 'expired');

  // an online request waiting for reception
  insert('booking_requests', {
    client_id: clients.mia, service_id: svc.laser, preferred_date: addDays(today, 1), time_of_day: 'morning', notes: 'First time — a bit nervous!',
    kind: 'new', status: 'pending', created_at: minsAgo(35),
  });

  // messages + notifications
  insert('messages', { client_id: clients.olivia, direction: 'out', template: 'appointment_confirmed', body: `Austin Clinic: you're booked for Laser Hair Reduction — Full Body today at 10:00 AM.`, status: 'sent', created_at: at(-3, '12:00') });
  insert('notifications', { staff_id: staff.carter, appointment_id: ethanA, body: 'Ethan Brooks has checked in', read: 0, created_at: minsAgo(6) });
  insert('notifications', { staff_id: staff.rhea, appointment_id: oliviaA, body: 'Quotation ready: Olivia Bennett · Dr. Carter', read: 0, created_at: minsAgo(8) });
  void natalieA; void setStatus; void run; void all; void nowLocal;
  console.log(`Seeded demo clinic (${all('SELECT COUNT(*) n FROM appointments')[0].n} appointments). Sign-in PIN for every demo user: ${process.env.DEMO_PIN || '1234'}`);
}

export const seedDemo = () => tx(seedBody);

if (isMain) seedDemo();
