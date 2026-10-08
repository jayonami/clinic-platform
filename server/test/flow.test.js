// End-to-end API checks against a throw-away in-memory database.
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';
const { test, before, after } = await import('node:test');
const assert = (await import('node:assert/strict')).default;
const { seedDefaultSettings } = await import('../src/lib/settings.js');
const { seedDemo } = await import('../src/seed.js');
const { createApp } = await import('../src/app.js');
const U = await import('../src/lib/util.js');

let server;
let base;
const tokens = {};
const api = async (method, url, body, who = 'rhea') => {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(tokens[who] ? { authorization: `Bearer ${tokens[who]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
};

before(async () => {
  seedDefaultSettings();
  seedDemo();
  server = createApp().listen(0);
  base = `http://localhost:${server.address().port}/api`;
  for (const who of ['rhea', 'carter', 'jessica']) {
    tokens[who] = (await api('POST', '/auth/login', { email: `${who}@clinic.test`, pin: '1234' }, null)).json.token;
  }
});
after(() => server.close());

const today = U.todayStr();
const tomorrow = U.addDays(today, 1);

test('rejects bad PIN and unauthenticated calls', async () => {
  assert.equal((await api('POST', '/auth/login', { email: 'rhea@clinic.test', pin: 'nope' }, null)).status, 401);
  assert.equal((await api('GET', '/calendar', null, null)).status, 401);
  assert.equal((await api('GET', '/analytics', null, 'carter')).status, 403);
});

test('calendar shows the seeded day', async () => {
  const { json } = await api('GET', `/calendar?date=${today}`);
  assert.equal(json.appointments.length, 12);
  assert.equal(json.resources.length, 4);
  assert.equal(json.waitlist.length, 3);
});

test('booking prevents double-booking a provider or room', async () => {
  const clients = (await api('GET', '/clients?q=Grace')).json;
  const meta = (await api('GET', '/meta')).json;
  const jessica = meta.providers.find((p) => p.short_name === 'Jessica K.').id;
  const svc = (await api('GET', '/services')).json.find((s) => s.name.startsWith('Laser Hair'));
  const room1 = meta.resources.find((r) => r.name === 'Therapist 1').id;
  const body = { client_id: clients[0].id, service_id: svc.id, provider_id: jessica, resource_id: room1, date: tomorrow, time: '10:00' };
  const ok = await api('POST', '/appointments', body);
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  const clash = await api('POST', '/appointments', body);
  assert.equal(clash.status, 409);
  const lunch = await api('POST', '/appointments', { ...body, time: '12:30' });
  assert.equal(lunch.status, 409);
  assert.match(lunch.json.error, /lunch/i);
});

test('cancelling reopens a slot and auto-offers it to the waitlist', async () => {
  const cal = (await api('GET', `/calendar?date=${tomorrow}`)).json;
  const appt = cal.appointments[0];
  const bad = await api('POST', `/appointments/${appt.id}/cancel`, {});
  assert.equal(bad.status, 400, 'a reason is mandatory');
  const done = await api('POST', `/appointments/${appt.id}/cancel`, { reason: 'Client cancelled', notify: true });
  assert.equal(done.status, 200);
  const after = (await api('GET', `/calendar?date=${tomorrow}`)).json;
  assert.equal(after.open_slots.length, 1);
  assert.equal(after.open_slots[0].status, 'offered', 'auto-fill should have offered it');
});

test('a guest can accept an offer by link and gets booked', async () => {
  const { default: dbm } = { default: await import('../src/db.js') };
  const offer = dbm.get(`SELECT * FROM offers WHERE status='pending' ORDER BY id DESC LIMIT 1`);
  assert.ok(offer);
  const pub = await fetch(`${base}/public/offers/${offer.token}`).then((r) => r.json());
  assert.equal(pub.status, 'pending');
  const res = await fetch(`${base}/public/offers/${offer.token}/respond`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accept: true }),
  });
  assert.equal(res.status, 200);
  const again = await fetch(`${base}/public/offers/${offer.token}/respond`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accept: true }),
  });
  assert.equal(again.status, 409, 'cannot accept twice');
});

test('consultation → quotation → split checkout', async () => {
  const q = (await api('GET', '/queue')).json;
  const sophia = q.appointments.find((a) => a.client_name === 'Sophia Reed');
  const ctx = await api('GET', `/staff/consultations/${sophia.id}`, null, 'carter');
  assert.equal(ctx.status, 200);
  assert.ok(ctx.json.suggested_ids.length, 'package follow-on should be suggested');
  assert.equal((await api('POST', `/staff/consultations/${sophia.id}/finish`, { notes: '' }, 'carter')).status, 400);
  const fin = await api('POST', `/staff/consultations/${sophia.id}/finish`, {
    notes: 'Good progress, continue plan.', service_ids: ctx.json.suggested_ids, item_ids: [ctx.json.items[0].id],
  }, 'carter');
  assert.equal(fin.status, 200, JSON.stringify(fin.json));
  const inv = (await api('GET', `/invoices/${fin.json.invoice_id}`)).json;
  assert.equal(inv.status, 'quotation');
  assert.ok(inv.lines.length >= 2);
  assert.ok(inv.lines.every((l) => l.staff.length > 0 || l.amount_cents === 0), 'every billable line is attributed to staff');
  const co = await api('POST', `/invoices/${inv.id}/checkout`, { method: 'card', mode: 'split', deposit_cents: 20000 });
  assert.equal(co.status, 200, JSON.stringify(co.json));
  assert.equal(co.json.status, 'paid');
  assert.equal(co.json.financing.financed_cents, inv.total_cents - 20000);
  assert.equal((await api('POST', `/invoices/${inv.id}/checkout`, { method: 'card' })).status, 409, 'cannot pay twice');
});

test('Olivia’s invoice matches the wireframe maths', async () => {
  const c = (await api('GET', '/clients?q=Olivia')).json[0];
  const profile = (await api('GET', `/clients/${c.id}`)).json;
  const today = profile.visits.find((v) => v.date === U.todayStr());
  const inv = (await api('GET', `/invoices/${today.invoice_id}`)).json;
  assert.equal(inv.subtotal_cents, 98800);
  assert.equal(inv.discount_cents, 9900);
  assert.equal(inv.tax_cents, 7100);
  assert.equal(inv.total_cents, 96000);
  assert.equal(inv.balance_cents, 76000);
  const split = await api('POST', `/invoices/${inv.id}/checkout`, { method: 'card', mode: 'split', deposit_cents: 20000 });
  assert.equal(split.json.financing.monthly_cents, Math.round(56000 / 3));
});

test('client portal: OTP sign-in, own data only, cancel window enforced', async () => {
  const otp = await fetch(`${base}/public/otp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '(555) 044-2291' }) }).then((r) => r.json());
  assert.ok(otp.dev_code);
  const bad = await fetch(`${base}/public/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5550442291', code: '000000' }) });
  assert.equal(bad.status, 401);
  const login = await fetch(`${base}/public/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: '5550442291', code: otp.dev_code }) }).then((r) => r.json());
  const mine = await fetch(`${base}/public/client/appointments`, { headers: { authorization: `Bearer ${login.token}` } }).then((r) => r.json());
  assert.equal(mine.client.name, 'Grace Walker');
  const olivia = (await api('GET', '/clients?q=Olivia')).json[0];
  const ov = (await api('GET', `/clients/${olivia.id}`)).json;
  const stolen = await fetch(`${base}/public/client/invoices/${ov.visits[0].invoice_id}`, { headers: { authorization: `Bearer ${login.token}` } });
  assert.equal(stolen.status, 404, 'cannot read another client’s invoice');
});

test('online booking request lands with reception and can be confirmed', async () => {
  const svc = (await fetch(`${base}/public/services`).then((r) => r.json())).find((s) => s.name === 'Hair Spa');
  const post = (body) => fetch(`${base}/public/booking-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ name: 'A', phone: '12', service_id: svc.id, date: tomorrow, time_of_day: 'morning' })).status, 400);
  const ok = await post({ name: 'Test Person', phone: '(555) 777-1212', service_id: svc.id, date: tomorrow, time_of_day: 'afternoon' });
  assert.equal(ok.status, 201);
  const reqs = (await api('GET', '/booking-requests')).json;
  const mine = reqs.find((r) => r.client_name === 'Test Person');
  assert.ok(mine);
  const meta = (await api('GET', '/meta')).json;
  const confirm = await api('POST', `/booking-requests/${mine.id}/confirm`, {
    date: tomorrow, time: '15:00', provider_id: meta.providers.find((p) => p.short_name === 'Anika S.').id,
    resource_id: meta.resources.find((r) => r.name === 'Therapist 2').id,
  });
  assert.equal(confirm.status, 201, JSON.stringify(confirm.json));
  assert.equal(confirm.json.channel, 'online');
});
