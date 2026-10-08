import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { client, tokens } from '../api.js';
import { mdy, money, money2 } from '../format.js';
import { useLoad } from '../hooks.js';
import { Button, ErrorBox, Spinner } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';

const METHODS = [['card', 'Card'], ['apple_pay', 'Apple Pay'], ['affirm', 'Affirm']];

export default function PayInvoice() {
  const { id } = useParams();
  const nav = useNavigate();
  const [method, setMethod] = useState('card');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [paid, setPaid] = useState(false);
  const state = useLoad(() => (tokens.get('client') ? client.get(`/public/client/invoices/${id}`) : Promise.resolve(null)), [id]);
  if (!tokens.get('client') || state.error?.status === 401) return <Navigate to="/my" replace />;
  if (state.error) return <Frame back="/my" title="Invoice"><ErrorBox error={state.error} retry={state.reload} /></Frame>;
  if (!state.data) return <Frame back="/my" title="Invoice"><Spinner /></Frame>;
  const d = state.data;

  async function pay() {
    setBusy(true); setErr('');
    try { await client.post(`/public/client/invoices/${d.id}/pay`, { method }); setPaid(true); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (paid) {
    return (
      <Frame brand footer={<Button className="lg" onClick={() => nav('/my')}>Back to my appointments</Button>}>
        <div className="big-check"><Check size={58} strokeWidth={2.5} /></div>
        <h1 style={{ textAlign: 'center' }}>Payment received</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '10px 0 24px', fontSize: 17 }}>Thank you — a receipt is on its way by text.</p>
        <div className="m-card"><div className="row between"><span className="muted">Paid</span><b>{money2(d.balance_cents)}</b></div>
          <div className="row between" style={{ marginTop: 8 }}><span className="muted">Method</span><b>{METHODS.find(([k]) => k === method)[1]}</b></div></div>
      </Frame>
    );
  }
  const monthly = Math.round(d.balance_cents / d.financing.months);
  return (
    <Frame back="/my" title="Invoice" footer={d.payable ? <Button className="lg" busy={busy} onClick={pay}>Pay {money2(d.balance_cents)}</Button> : null}>
      <div className="muted" style={{ fontSize: 16.5 }}>{d.clinic} · {mdy(d.service_date)}</div>
      <h1 style={{ margin: '6px 0 22px', fontSize: 32 }}>{money2(d.balance_cents)} due</h1>
      <div className="m-card">
        {d.lines.map((l) => <div key={l.id} className="row between" style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}><span>{l.description}</span><b>{money(l.amount_cents)}</b></div>)}
        {d.discount_cents > 0 && <div className="row between muted" style={{ padding: '10px 0 4px' }}><span>{d.discount_label}</span><span>−{money(d.discount_cents)}</span></div>}
        <div className="row between muted" style={{ padding: '4px 0 10px', borderBottom: '1px solid var(--line)' }}><span>Tax</span><span>{money(d.tax_cents)}</span></div>
        {d.paid_cents > 0 && <div className="row between muted" style={{ paddingTop: 10 }}><span>Already paid</span><span>{money(d.paid_cents)}</span></div>}
      </div>
      {d.payable ? (
        <>
          <div className="m-section-title" style={{ textTransform: 'none', letterSpacing: 0, fontSize: 16 }}>Pay with</div>
          <div className="chips" role="radiogroup" aria-label="Payment method" style={{ flexWrap: 'nowrap' }}>
            {METHODS.map(([k, l]) => <button key={k} role="radio" aria-checked={method === k} className={`chip ${method === k ? 'on' : ''}`} onClick={() => setMethod(k)}>{l}</button>)}
          </div>
          {method === 'affirm' && <p className="muted small" style={{ marginTop: 12 }}>Split it into {d.financing.months} payments of about {money2(monthly)}, financed by {d.financing.lender}.</p>}
          <p className="xs faint" style={{ marginTop: 14 }}>Demo checkout — no card details are collected or stored here.</p>
          {err && <div className="banner bad" role="alert" style={{ marginTop: 12 }}>{err}</div>}
        </>
      ) : <div className="banner" style={{ marginTop: 18 }}>{d.status === 'paid' ? 'This invoice is already paid.' : 'This invoice isn’t ready for payment yet — the clinic will let you know.'} <Link to="/my">Back</Link></div>}
    </Frame>
  );
}
