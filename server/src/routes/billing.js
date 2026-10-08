import { Router } from 'express';
import { all, get, update } from '../db.js';
import { staffAuth } from '../lib/auth.js';
import { apptOr404 } from '../lib/appointments.js';
import {
  addInvoiceLine, checkout, invoiceDetail, invoiceForAppointment, recordPayment, refreshInvoice, removeInvoiceLine,
} from '../lib/billing.js';
import { bad, conflict, int, need, str } from '../lib/util.js';

const r = Router();
r.use(staffAuth());

const METHODS = ['card', 'upi', 'cash', 'package_credit'];

r.get('/invoices', (req, res) => {
  const status = str(req.query.status, 20) || 'outstanding';
  const where = {
    outstanding: `i.status IN ('open','partial')`,
    quotation: `i.status='quotation'`,
    paid: `i.status='paid'`,
    all: `i.status!='void'`,
  }[status] ?? `i.status IN ('open','partial')`;
  const q = str(req.query.q, 60).toLowerCase();
  const rows = all(
    `SELECT i.id, i.status, i.total_cents, i.paid_cents, i.service_date, c.name AS client_name, c.id AS client_id,
       (SELECT group_concat(description, ', ') FROM invoice_lines l WHERE l.invoice_id=i.id AND l.kind!='product') AS summary
     FROM invoices i JOIN clients c ON c.id=i.client_id
     WHERE ${where} ${q ? 'AND lower(c.name) LIKE ?' : ''} ORDER BY i.service_date DESC, i.id DESC LIMIT 200`,
    ...(q ? [`%${q}%`] : []),
  );
  const totals = get(
    `SELECT COUNT(*) n, COALESCE(SUM(total_cents-paid_cents),0) cents FROM invoices WHERE status IN ('open','partial')`,
  );
  res.json({ invoices: rows, outstanding: { count: totals.n, cents: totals.cents } });
});

r.get('/invoices/:id', (req, res) => res.json(invoiceDetail(+req.params.id)));

r.get('/invoices/for-appointment/:apptId', (req, res) => {
  const appt = apptOr404(req.params.apptId);
  if (appt.status === 'cancelled' || appt.status === 'no_show') throw conflict('There is nothing to bill for this appointment');
  res.json(invoiceDetail(invoiceForAppointment(appt, req.user.id).id));
});

r.post('/invoices/:id/lines', staffAuth('reception'), (req, res) => {
  addInvoiceLine(+req.params.id, { service_id: req.body.service_id, item_id: req.body.item_id, qty: req.body.qty });
  res.json(invoiceDetail(+req.params.id));
});
r.delete('/invoices/:id/lines/:lineId', staffAuth('reception'), (req, res) => {
  removeInvoiceLine(+req.params.id, +req.params.lineId);
  res.json(invoiceDetail(+req.params.id));
});

r.post('/invoices/:id/payments', staffAuth('reception'), (req, res) => {
  const method = str(req.body.method, 20);
  need(METHODS.includes(method), 'Choose a payment method');
  recordPayment(+req.params.id, {
    amount_cents: int(req.body.amount_cents, 'amount'), method, kind: req.body.kind === 'deposit' ? 'deposit' : 'payment', note: str(req.body.note, 120) || null,
  }, req.user.id);
  res.status(201).json(invoiceDetail(+req.params.id));
});

r.post('/invoices/:id/checkout', staffAuth('reception'), (req, res) => {
  const method = str(req.body.method, 20);
  need(METHODS.includes(method), 'Choose a payment method');
  const mode = req.body.mode === 'split' ? 'split' : 'full';
  checkout(+req.params.id, { method, mode, deposit_cents: mode === 'split' ? int(req.body.deposit_cents, 'deposit') : 0 }, req.user.id);
  res.json(invoiceDetail(+req.params.id));
});

r.post('/invoices/:id/void', staffAuth('reception'), (req, res) => {
  const inv = refreshInvoice(+req.params.id);
  if (inv.paid_cents > 0) throw bad('Refund recorded payments before voiding');
  update('invoices', inv.id, { status: 'void' });
  res.json(invoiceDetail(inv.id));
});

export default r;
