import { all, get, insert, run, update, tx } from '../db.js';
import { setting } from './settings.js';
import { bad, conflict, notFound, nowLocal, token, todayStr } from './util.js';
import { apptById, setStatus } from './appointments.js';
import { sms, clinicName } from './notify.js';

const rnd = (cents) => (setting('round_totals') === '1' ? Math.round(cents / 100) * 100 : Math.round(cents));

export function promoFor(date) {
  const dow = new Date(`${date}T12:00:00`).getDay();
  const promos = all('SELECT * FROM promotions WHERE active=1');
  return promos
    .filter((p) => p.weekdays.split(',').map(Number).includes(dow))
    .sort((a, b) => b.percent - a.percent)[0] ?? null;
}

export function computeTotals(subtotal, date) {
  const promo = promoFor(date);
  const discount = promo ? rnd((subtotal * promo.percent) / 100) : 0;
  const tax = rnd(((subtotal - discount) * +setting('tax_rate_pct')) / 100);
  return {
    subtotal_cents: subtotal,
    discount_cents: discount,
    discount_label: promo ? `${promo.name} · ${+promo.percent}%` : null,
    tax_cents: tax,
    total_cents: subtotal - discount + tax,
  };
}

/** Recompute totals, per-line commissions, paid amount and status. Always call after any change. */
export function refreshInvoice(id) {
  const inv = get('SELECT * FROM invoices WHERE id=?', id);
  if (!inv) throw notFound('Invoice not found');
  const lines = all('SELECT id, amount_cents FROM invoice_lines WHERE invoice_id=?', id);
  const subtotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  const t = computeTotals(subtotal, inv.service_date);
  const ratio = subtotal ? (subtotal - t.discount_cents) / subtotal : 1;
  for (const l of lines) {
    for (const ls of all('SELECT id, pct FROM line_staff WHERE line_id=?', l.id)) {
      update('line_staff', ls.id, { commission_cents: Math.round((l.amount_cents * ratio * ls.pct) / 100) });
    }
  }
  const paid = get('SELECT COALESCE(SUM(amount_cents),0) n FROM payments WHERE invoice_id=?', id).n;
  let status = inv.status;
  if (status !== 'void') {
    if (t.total_cents > 0 && paid >= t.total_cents) status = 'paid';
    else if (paid > 0) status = 'partial';
    else status = inv.finalized_at ? 'open' : 'quotation';
    if (t.total_cents === 0 && inv.finalized_at) status = 'paid';
  }
  update('invoices', id, {
    ...t, paid_cents: paid, status,
    collected_on: status === 'paid' ? inv.collected_on ?? nowLocal() : null,
  });
  return get('SELECT * FROM invoices WHERE id=?', id);
}

function addLine(invoiceId, { kind, service_id = null, item_id = null, description, detail = null, qty = 1, unit, staff = [] }) {
  const sort = get('SELECT COALESCE(MAX(sort),0)+1 n FROM invoice_lines WHERE invoice_id=?', invoiceId).n;
  const id = insert('invoice_lines', {
    invoice_id: invoiceId, kind, service_id, item_id, description, detail, qty,
    unit_price_cents: unit, amount_cents: unit * qty, sort,
  });
  for (const s of staff) insert('line_staff', { line_id: id, staff_id: s.id, role: s.role, pct: s.pct, commission_cents: 0 });
  return id;
}

function serviceLine(invoiceId, appt, svc, { addon = false } = {}) {
  const sessionNo = svc.sessions_total
    ? get(
      `SELECT COUNT(*)+1 n FROM appointments WHERE client_id=? AND service_id=? AND status='done' AND start_at<?`,
      appt.client_id, svc.id, appt.start_at,
    ).n
    : null;
  const staff = [];
  const included = addon && svc.price_cents === 0;
  if (!included) {
    staff.push({ id: appt.provider_id, role: 'provider', pct: svc.provider_pct });
    if (appt.assistant_id && svc.assistant_pct > 0) staff.push({ id: appt.assistant_id, role: 'assistant', pct: svc.assistant_pct });
  }
  return addLine(invoiceId, {
    kind: addon ? 'addon' : 'service', service_id: svc.id, description: svc.name,
    detail: sessionNo ? `Session ${sessionNo} of ${svc.sessions_total} · service` : 'Service',
    unit: svc.price_cents, staff,
  });
}

const PRODUCT_PCT = 8;
export function productLine(invoiceId, appt, item, qty = 1) {
  const seller = appt.assistant_id ?? appt.provider_id;
  return addLine(invoiceId, {
    kind: 'product', item_id: item.id, description: item.name, detail: `Product · ${qty} unit${qty > 1 ? 's' : ''}`,
    qty, unit: item.sell_price_cents, staff: [{ id: seller, role: 'seller', pct: PRODUCT_PCT }],
  });
}

export function newInvoice(appt, quotedBy = null) {
  const id = insert('invoices', {
    appointment_id: appt.id, client_id: appt.client_id, public_token: token(16), status: 'quotation',
    service_date: appt.start_at.slice(0, 10), quoted_by: quotedBy, quoted_at: quotedBy ? nowLocal() : null,
    created_at: nowLocal(),
  });
  return id;
}

/** Quotation built from the consultation's recommendations (service ids + retail item ids). */
export function buildQuotation(appt, { service_ids, item_ids = [] }, quotedBy) {
  return tx(() => {
    const existing = get('SELECT * FROM invoices WHERE appointment_id=?', appt.id);
    if (existing && ['partial', 'paid'].includes(existing.status)) throw conflict('This visit has already been billed');
    if (existing) run('DELETE FROM invoice_lines WHERE invoice_id=?', existing.id);
    const id = existing?.id ?? newInvoice(appt, quotedBy);
    update('invoices', id, { quoted_by: quotedBy, quoted_at: nowLocal(), status: 'quotation' });
    // the visit's own service is always billed, then anything the provider recommended
    const ids = [appt.service_id, ...service_ids.filter((x) => x !== appt.service_id)];
    for (const sid of ids) {
      const svc = get('SELECT * FROM services WHERE id=? AND active=1', sid);
      if (svc) serviceLine(id, appt, svc);
    }
    for (const ad of all('SELECT * FROM appointment_addons WHERE appointment_id=?', appt.id)) {
      const asvc = get('SELECT * FROM services WHERE id=?', ad.service_id);
      const lid = serviceLine(id, appt, asvc, { addon: true });
      if (ad.included) update('invoice_lines', lid, { unit_price_cents: 0, amount_cents: 0, detail: 'Included with procedure' });
    }
    for (const iid of item_ids) {
      const item = get('SELECT * FROM items WHERE id=? AND active=1 AND sell_price_cents IS NOT NULL', iid);
      if (item) productLine(id, appt, item);
    }
    return refreshInvoice(id);
  });
}

/** Opened by reception when no consultation produced a quotation (e.g. a walk-in). */
export function invoiceForAppointment(appt, createdBy = null) {
  let inv = get('SELECT * FROM invoices WHERE appointment_id=?', appt.id);
  if (inv) return inv;
  return tx(() => {
    const id = newInvoice(appt, null);
    const svc = get('SELECT * FROM services WHERE id=?', appt.service_id);
    serviceLine(id, appt, svc);
    for (const ad of all('SELECT * FROM appointment_addons WHERE appointment_id=?', appt.id)) {
      const asvc = get('SELECT * FROM services WHERE id=?', ad.service_id);
      const lid = serviceLine(id, appt, asvc, { addon: true });
      if (ad.included) update('invoice_lines', lid, { unit_price_cents: 0, amount_cents: 0, detail: 'Included with procedure' });
    }
    void createdBy;
    return refreshInvoice(id);
  });
}

export function invoiceDetail(id) {
  const inv = get(
    `SELECT i.*, c.name AS client_name, c.phone AS client_phone, c.credit_cents, q.short_name AS quoted_by_name
     FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN staff q ON q.id=i.quoted_by WHERE i.id=?`, id,
  );
  if (!inv) throw notFound('Invoice not found');
  const lines = all('SELECT * FROM invoice_lines WHERE invoice_id=? ORDER BY sort, id', id).map((l) => ({
    ...l,
    staff: all(
      `SELECT ls.id, ls.staff_id, ls.role, ls.pct, ls.commission_cents, s.short_name, s.initials
       FROM line_staff ls JOIN staff s ON s.id=ls.staff_id WHERE ls.line_id=?`, l.id,
    ),
  }));
  const payments = all(
    `SELECT p.*, s.short_name AS by_name FROM payments p LEFT JOIN staff s ON s.id=p.created_by
     WHERE p.invoice_id=? ORDER BY p.created_at, p.id`, id,
  );
  const financing = get('SELECT * FROM financing_plans WHERE invoice_id=?', id);
  const appointment = inv.appointment_id ? apptById(inv.appointment_id) : null;
  const commission = all(
    `SELECT s.id, s.short_name, SUM(ls.commission_cents) AS cents FROM line_staff ls
     JOIN invoice_lines l ON l.id=ls.line_id JOIN staff s ON s.id=ls.staff_id
     WHERE l.invoice_id=? GROUP BY s.id ORDER BY cents DESC`, id,
  );
  return {
    ...inv, lines, payments, financing, appointment, commission,
    balance_cents: Math.max(0, inv.total_cents - inv.paid_cents),
    methods: ['card', 'upi', 'cash', 'package_credit'],
  };
}

export function recordPayment(invoiceId, { amount_cents, method, kind = 'payment', note = null }, staffId = null) {
  return tx(() => {
    const inv = refreshInvoice(invoiceId);
    if (inv.status === 'void') throw conflict('This invoice is void');
    if (!Number.isInteger(amount_cents) || amount_cents <= 0) throw bad('Enter an amount greater than zero');
    const balance = inv.total_cents - inv.paid_cents;
    if (amount_cents > balance) throw bad('That is more than the balance due');
    if (method === 'package_credit') {
      const c = get('SELECT credit_cents FROM clients WHERE id=?', inv.client_id);
      if (c.credit_cents < amount_cents) throw bad('Not enough package credit on file');
      run('UPDATE clients SET credit_cents = credit_cents - ? WHERE id=?', amount_cents, inv.client_id);
    }
    insert('payments', { invoice_id: invoiceId, amount_cents, method, kind, note, created_by: staffId, created_at: nowLocal() });
    return refreshInvoice(invoiceId);
  });
}

/** Reception "collect and complete checkout". mode: 'full' pays the balance; 'split' takes a deposit and finances the rest. */
export function checkout(invoiceId, { method, mode = 'full', deposit_cents = 0 }, staffId) {
  return tx(() => {
    let inv = refreshInvoice(invoiceId);
    if (inv.status === 'paid') throw conflict('This invoice is already paid');
    if (inv.status === 'void') throw conflict('This invoice is void');
    if (!inv.finalized_at) update('invoices', invoiceId, { finalized_at: nowLocal() });
    const balance = inv.total_cents - inv.paid_cents;
    if (mode === 'split') {
      if (!Number.isInteger(deposit_cents) || deposit_cents < 0 || deposit_cents >= balance) throw bad('Deposit must be less than the balance');
      if (deposit_cents > 0) recordPayment(invoiceId, { amount_cents: deposit_cents, method, kind: 'deposit' }, staffId);
      const financed = balance - deposit_cents;
      const months = +setting('financing_months') || 3;
      const lender = setting('financing_lender');
      insert('financing_plans', {
        invoice_id: invoiceId, lender, months, financed_cents: financed, monthly_cents: Math.round(financed / months),
        created_at: nowLocal(),
      });
      insert('payments', {
        invoice_id: invoiceId, amount_cents: financed, method: 'financing', kind: 'financed',
        note: `${lender} · ${months} mo`, created_by: staffId, created_at: nowLocal(),
      });
    } else {
      recordPayment(invoiceId, { amount_cents: balance, method }, staffId);
    }
    inv = refreshInvoice(invoiceId);
    if (inv.appointment_id) {
      const a = apptById(inv.appointment_id);
      if (a && ['checked_in', 'in_room', 'with_provider'].includes(a.status)) setStatus(a.id, 'done');
    }
    if (inv.status === 'paid') {
      sms(inv.client_id, 'receipt', `${clinicName()}: thanks! We received $${(inv.total_cents / 100).toFixed(2)} for your visit on ${inv.service_date}.`, staffId);
    }
    return inv;
  });
}

export function addInvoiceLine(invoiceId, { service_id, item_id, qty = 1 }) {
  return tx(() => {
    const inv = refreshInvoice(invoiceId);
    if (['paid', 'void'].includes(inv.status)) throw conflict('This invoice can no longer be edited');
    const appt = inv.appointment_id ? apptById(inv.appointment_id) : null;
    const ctx = appt ?? { id: 0, client_id: inv.client_id, provider_id: inv.quoted_by, assistant_id: null, start_at: `${inv.service_date}T00:00:00` };
    if (service_id) {
      const svc = get('SELECT * FROM services WHERE id=? AND active=1', service_id);
      if (!svc) throw bad('Unknown service');
      if (!ctx.provider_id) throw bad('No provider to attribute this service to');
      serviceLine(invoiceId, ctx, svc);
    } else if (item_id) {
      const item = get('SELECT * FROM items WHERE id=? AND active=1 AND sell_price_cents IS NOT NULL', item_id);
      if (!item) throw bad('Unknown product');
      if (!ctx.provider_id) throw bad('No staff member to attribute this product to');
      productLine(invoiceId, ctx, item, Math.max(1, Math.min(20, +qty || 1)));
    } else throw bad('Choose a service or product');
    return refreshInvoice(invoiceId);
  });
}

export function removeInvoiceLine(invoiceId, lineId) {
  return tx(() => {
    const inv = refreshInvoice(invoiceId);
    if (['paid', 'void'].includes(inv.status)) throw conflict('This invoice can no longer be edited');
    if (inv.paid_cents > 0) throw conflict('Lines can’t be removed once a payment is recorded');
    run('DELETE FROM invoice_lines WHERE id=? AND invoice_id=?', lineId, invoiceId);
    return refreshInvoice(invoiceId);
  });
}

export const todayISO = todayStr;
