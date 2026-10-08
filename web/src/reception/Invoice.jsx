import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { centsToInput, dollarsToCents, METHOD, money, money2, mdy, time12, fullShortDate } from '../format.js';
import { useLoad } from '../hooks.js';
import { Badge, Button, ErrorBox, Field, Load, Modal, Spinner, useSafe } from '../ui.jsx';

function AddLine({ invoiceId, onClose, onDone }) {
  const [tab, setTab] = useState('service');
  const services = useLoad(() => api.get('/services'), []);
  const items = useLoad(() => api.get('/items'), []);
  const [busy, setBusy] = useState(null);
  const safe = useSafe();
  async function add(body, key) {
    setBusy(key);
    const ok = await safe(() => api.post(`/invoices/${invoiceId}/lines`, body), 'Added');
    setBusy(null);
    if (ok) { onDone(); onClose(); }
  }
  return (
    <Modal title="Add to invoice" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="segmented full" style={{ marginBottom: 14 }}>
        <button className={tab === 'service' ? 'on' : ''} onClick={() => setTab('service')}>Service</button>
        <button className={tab === 'product' ? 'on' : ''} onClick={() => setTab('product')}>Product</button>
      </div>
      <div className="stack sm" style={{ maxHeight: 340, overflow: 'auto' }}>
        {tab === 'service' && (services.data ?? []).map((s) => (
          <button key={s.id} className="opt" disabled={!!busy} onClick={() => add({ service_id: s.id }, `s${s.id}`)}>
            <span className="grow"><b>{s.name}</b><br /><span className="small muted">{s.duration_min} min</span></span><b>{money(s.price_cents)}</b>
          </button>
        ))}
        {tab === 'product' && (items.data ?? []).filter((i) => i.sell_price_cents != null).map((i) => (
          <button key={i.id} className="opt" disabled={!!busy} onClick={() => add({ item_id: i.id, qty: 1 }, `i${i.id}`)}>
            <span className="grow"><b>{i.name}</b></span><b>{money(i.sell_price_cents)}</b>
          </button>
        ))}
        {(services.loading || items.loading) && <Spinner />}
      </div>
    </Modal>
  );
}

function RecordPayment({ inv, onClose, onDone }) {
  const [amount, setAmount] = useState(centsToInput(inv.balance_cents));
  const [method, setMethod] = useState('card');
  const [deposit, setDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    setBusy(true); setErr('');
    try {
      await api.post(`/invoices/${inv.id}/payments`, { amount_cents: dollarsToCents(amount), method, kind: deposit ? 'deposit' : 'payment' });
      onDone(); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Record payment" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Record</Button></>}>
      <div className="stack">
        <Field label="Amount ($)"><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
        <Field label="Method"><select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          {inv.methods.map((m) => <option key={m} value={m} disabled={m === 'package_credit' && inv.credit_cents <= 0}>{METHOD[m]}{m === 'package_credit' ? ` (${money(inv.credit_cents)} on file)` : ''}</option>)}</select></Field>
        <label className="checkbox"><input type="checkbox" checked={deposit} onChange={(e) => setDeposit(e.target.checked)} /> This is a deposit</label>
        {err && <div className="form-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

function InvoiceView({ id }) {
  const state = useLoad(() => api.get(`/invoices/${id}`), [id], { live: true });
  const meta = useLoad(() => api.get('/meta'), []);
  const safe = useSafe();
  const [method, setMethod] = useState('card');
  const [mode, setMode] = useState('full');
  const [deposit, setDeposit] = useState('');
  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showComm, setShowComm] = useState(false);
  const inv = state.data;
  const s = meta.data?.settings;

  useEffect(() => {
    if (inv && deposit === '' && s) setDeposit(centsToInput(Math.min(+s.default_deposit_cents, Math.max(0, inv.balance_cents - 100))));
  }, [inv, s, deposit]);

  const calc = useMemo(() => {
    if (!inv) return null;
    const dep = Math.min(dollarsToCents(deposit), inv.balance_cents);
    const months = +(s?.financing_months ?? 3);
    const financed = Math.max(0, inv.balance_cents - dep);
    return { dep, months, financed, monthly: Math.round(financed / months), lender: s?.financing_lender ?? 'Affirm' };
  }, [inv, deposit, s]);

  async function checkout() {
    setBusy(true); setErr('');
    try {
      await api.post(`/invoices/${inv.id}/checkout`, { method, mode, deposit_cents: calc.dep });
      state.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const editable = inv && !['paid', 'void'].includes(inv.status);
  const splitInvalid = mode === 'split' && (calc?.dep >= inv?.balance_cents || calc?.dep < 0);

  return (
    <Load state={state}>
      {(inv) => (
        <>
          <div className="page-head">
            <div>
              <Link to="/reception/billing" className="back-link"><ArrowLeft size={16} /> All invoices</Link>
              <h1>Invoice</h1>
              <p><Link to={`/reception/clients/${inv.client_id}`}>{inv.client_name}</Link>
                {inv.appointment && <> · {inv.appointment.resource_name}{inv.appointment.checked_in_at && ` · checked in ${time12(inv.appointment.checked_in_at)}`}</>}</p>
            </div>
            <Badge tone={inv.status === 'paid' ? 'green' : inv.status === 'quotation' ? 'gold' : 'red'}>{inv.status === 'paid' ? 'Paid in full' : inv.status === 'quotation' ? 'Quotation' : inv.status === 'void' ? 'Void' : 'Balance due'}</Badge>
          </div>
          <div className="cal-layout" style={{ gridTemplateColumns: 'minmax(0, 1fr) 400px' }}>
            <section className="card">
              {inv.quoted_by_name && inv.quoted_at && (
                <div className="banner" style={{ marginBottom: 14 }}><Check size={18} /> Quotation auto-generated from {inv.quoted_by_name}’s recommendation · {fullShortDate(inv.quoted_at)}, {time12(inv.quoted_at)}</div>
              )}
              {inv.lines.map((l) => (
                <div className="line-item" key={l.id}>
                  <div className="row between" style={{ alignItems: 'flex-start' }}>
                    <div>
                      <b style={{ fontSize: 17 }}>{l.description}</b>
                      <div className="muted small">{l.detail}</div>
                    </div>
                    <div className="row">
                      <b style={{ fontSize: 17, color: l.amount_cents === 0 ? 'var(--ink-3)' : undefined }}>{money(l.amount_cents)}</b>
                      {editable && inv.paid_cents === 0 && (
                        <button className="icon-btn" aria-label={`Remove ${l.description}`} onClick={async () => { if (await safe(() => api.del(`/invoices/${inv.id}/lines/${l.id}`))) state.reload(); }}><Trash2 size={16} /></button>
                      )}
                    </div>
                  </div>
                  <div>
                    {l.staff.map((st, i) => (
                      <span key={st.id} className={`staff-chip ${st.role === 'seller' || i > 0 ? 'alt' : ''}`} title={`${st.role} · ${st.pct}% commission`}>{st.short_name} — auto-filled</span>
                    ))}
                  </div>
                </div>
              ))}
              {editable && <button className="dash-btn" style={{ marginTop: 8 }} onClick={() => setAdding(true)}><Plus size={16} /> Add service</button>}

              <div className="totals" style={{ marginTop: 18, borderTop: '1px solid var(--line-strong)', paddingTop: 10 }}>
                <div><span>Subtotal</span><span>{money(inv.subtotal_cents)}</span></div>
                {inv.discount_cents > 0 && <div><span>{inv.discount_label}</span><span>−{money(inv.discount_cents)}</span></div>}
                <div><span>Tax</span><span>{money(inv.tax_cents)}</span></div>
                <div className="grand"><span>Total due</span><span>{money(inv.total_cents)}</span></div>
              </div>
              <div className="sumbox small row wrap" style={{ gap: 18, marginTop: 14, justifyContent: 'flex-start' }}>
                <span>Service date — <b>{mdy(inv.service_date)}</b></span>
                <span>Collected on — <b>{inv.collected_on ? fullShortDate(inv.collected_on) : 'pending'}</b></span>
                <button className="btn ghost sm" style={{ padding: '0 4px' }} onClick={() => setShowComm((v) => !v)}>Commission — <b>computed automatically</b></button>
              </div>
              {showComm && (
                <div className="sumbox small" style={{ marginTop: 8 }}>
                  {inv.commission.map((c) => <div key={c.id}><span>{c.short_name}</span><b>{money2(c.cents)}</b></div>)}
                  {inv.commission.length === 0 && <span>No commissionable lines.</span>}
                </div>
              )}
            </section>

            <aside className="stack">
              {inv.status === 'paid' ? (
                <section className="card stack">
                  <div className="banner ok"><Check size={18} /> Paid in full</div>
                  {inv.financing && <div className="sumbox"><div><span>Financed with</span><b>{inv.financing.lender} · {inv.financing.months} mo</b></div><div><span>Monthly</span><b>{money2(inv.financing.monthly_cents)} × {inv.financing.months}</b></div></div>}
                </section>
              ) : inv.status === 'void' ? <section className="card"><Badge tone="gray">Void</Badge></section> : (
                <>
                  <section className="card">
                    <h2>Payment method</h2>
                    <div className="method-grid">
                      {inv.methods.map((m) => (
                        <button key={m} className={method === m ? 'on' : ''} disabled={m === 'package_credit' && inv.credit_cents < (mode === 'split' ? calc.dep : inv.balance_cents)} onClick={() => setMethod(m)}
                          title={m === 'package_credit' ? `${money(inv.credit_cents)} credit on file` : ''}>{METHOD[m]}</button>
                      ))}
                    </div>
                  </section>
                  <section className="card stack">
                    <h2 style={{ margin: 0 }}>Collect now or split</h2>
                    <label className={`pay-opt ${mode === 'full' ? 'on' : ''}`}><input type="radio" name="mode" checked={mode === 'full'} onChange={() => setMode('full')} /> Pay in full — {money(inv.balance_cents)} remaining</label>
                    <label className={`pay-opt ${mode === 'split' ? 'on' : ''}`}><input type="radio" name="mode" checked={mode === 'split'} onChange={() => setMode('split')} /> Deposit now, EMI the rest</label>
                    {mode === 'split' && (
                      <>
                        <Field label="Deposit today ($)" error={splitInvalid ? 'Deposit must be less than the balance' : ''}>
                          <input className="input" inputMode="decimal" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
                        </Field>
                        <div className="sumbox">
                          <div><span>Collect today</span><b>{money(calc.dep)}</b></div>
                          <div><span>Financed with</span><b>{calc.lender} · {calc.months} mo</b></div>
                          <div><span>Monthly</span><b>{money2(calc.monthly)} × {calc.months}</b></div>
                        </div>
                      </>
                    )}
                  </section>
                </>
              )}
              <section className="card">
                <div className="row between"><h2 style={{ margin: 0 }}>Payments recorded</h2>
                  {editable && inv.balance_cents > 0 && <button className="btn ghost sm" onClick={() => setRecording(true)}>+ Record payment</button>}</div>
                <div className="stack sm" style={{ marginTop: 12 }}>
                  {inv.payments.length === 0 && <span className="muted small">Nothing collected yet.</span>}
                  {inv.payments.map((p) => (
                    <div key={p.id} className="row between">
                      <div><b>{money2(p.amount_cents)} · {p.kind === 'deposit' ? 'Deposit' : p.kind === 'financed' ? 'Financed' : 'Payment'}</b>
                        <div className="small muted">{METHOD[p.method] ?? p.method} · {mdy(p.created_at)}, {time12(p.created_at)}</div></div>
                      <Badge>Recorded</Badge>
                    </div>
                  ))}
                </div>
              </section>
              {editable && (
                <>
                  {err && <div className="form-error" role="alert">{err}</div>}
                  <Button className="lg" busy={busy} disabled={inv.balance_cents <= 0 || splitInvalid} onClick={checkout}>
                    Collect {money(mode === 'split' ? calc.dep : inv.balance_cents)} and complete checkout
                  </Button>
                </>
              )}
            </aside>
          </div>
          {adding && <AddLine invoiceId={inv.id} onClose={() => setAdding(false)} onDone={state.reload} />}
          {recording && <RecordPayment inv={inv} onClose={() => setRecording(false)} onDone={state.reload} />}
        </>
      )}
    </Load>
  );
}

export default function Invoice({ byAppointment }) {
  const params = useParams();
  const nav = useNavigate();
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!byAppointment) return;
    api.get(`/invoices/for-appointment/${params.apptId}`).then((i) => nav(`/reception/billing/${i.id}`, { replace: true })).catch(setErr);
  }, [byAppointment, params.apptId, nav]);
  if (byAppointment) return err ? <ErrorBox error={err} /> : <Spinner label="Preparing invoice…" />;
  return <InvoiceView id={params.id} />;
}
