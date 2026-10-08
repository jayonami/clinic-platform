import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarPlus } from 'lucide-react';
import { api } from '../api.js';
import { fullShortDate, mdy, money, money2, md, time12 } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Badge, Button, Empty, Load, Modal, useSafe } from '../ui.jsx';
import { ClientForm } from './Clients.jsx';

function Message({ client, onClose, onSent }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const safe = useSafe();
  async function send() {
    setBusy(true);
    const ok = await safe(() => api.post(`/clients/${client.id}/message`, { body }), 'Text sent');
    setBusy(false);
    if (ok) { onSent(); onClose(); }
  }
  return (
    <Modal title={`Text ${client.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!body.trim()} onClick={send}>Send</Button></>}>
      <textarea className="textarea" value={body} onChange={(e) => setBody(e.target.value)} maxLength={480} placeholder="Write a short message…" aria-label="Message" />
      <div className="xs faint" style={{ marginTop: 6 }}>{body.length}/480 · sent to {client.phone}</div>
    </Modal>
  );
}

export default function ClientProfile() {
  const { id } = useParams();
  const nav = useNavigate();
  const state = useLoad(() => api.get(`/clients/${id}`), [id], { live: true });
  const [modal, setModal] = useState(null);
  return (
    <>
      <Link to="/reception/clients" className="back-link"><ArrowLeft size={16} /> All clients</Link>
      <Load state={state}>
        {({ client, visits, upcoming, money: m, messages }) => (
          <>
            <div className="page-head"><h1>{client.name}</h1>
              <Button icon={CalendarPlus} onClick={() => nav(`/reception/appointments/new?client=${client.id}`)}>Book appointment</Button></div>
            <div className="cal-layout" style={{ gridTemplateColumns: 'minmax(0, 420px) minmax(0, 1fr)' }}>
              <div className="stack">
                <section className="card stack">
                  <div className="row"><Avatar name={client.name} tone="gold" size="lg" />
                    <div><h2 style={{ fontSize: 20, margin: 0 }}>{client.name}</h2>{client.visits >= 5 ? <Badge tone="gold">VIP · {client.visits} visits</Badge> : <Badge tone="gray">{client.visits} visit{client.visits === 1 ? '' : 's'}</Badge>}</div></div>
                  <div className="stack sm">
                    {[['Phone', client.phone], ['Email', client.email || '—'], ['Language', client.language], ['Client since', mdy(client.created_at)]].map(([k, v]) => (
                      <div key={k} className="row between"><span className="muted">{k}</span><b>{v}</b></div>
                    ))}
                  </div>
                  <div className="row"><Button variant="secondary" className="grow" onClick={() => setModal('message')}>Message</Button><Button variant="secondary" className="grow" onClick={() => setModal('edit')}>Edit details</Button></div>
                </section>
                <section className="card">
                  <h2>Money spent</h2>
                  <div className="two-col" style={{ gap: 18 }}>
                    <div><div className="small muted">Lifetime</div><div style={{ fontSize: 26, fontWeight: 800 }}>{money(m.lifetime_cents)}</div></div>
                    <div><div className="small muted">This year</div><div style={{ fontSize: 26, fontWeight: 800 }}>{money(m.this_year_cents)}</div></div>
                    <div><div className="small muted">Outstanding</div><div style={{ fontSize: 26, fontWeight: 800, color: m.outstanding_cents ? 'var(--red)' : undefined }}>{money(m.outstanding_cents)}</div></div>
                    <div><div className="small muted">Avg ticket</div><div style={{ fontSize: 26, fontWeight: 800 }}>{money(m.avg_ticket_cents)}</div></div>
                  </div>
                </section>
                {messages.length > 0 && (
                  <section className="card"><h2>Recent texts</h2>
                    <div className="stack sm">{messages.slice(0, 5).map((x) => <div key={x.id} className="small"><span className="faint">{md(x.created_at)} · </span>{x.body}</div>)}</div></section>
                )}
              </div>
              <div className="stack">
                {upcoming.length > 0 && (
                  <section className="card"><h2>Upcoming</h2>
                    <div className="stack sm">{upcoming.map((a) => (
                      <Link key={a.id} to={`/reception/appointments/${a.id}`} className="opt" style={{ color: 'inherit' }}>
                        <span className="grow"><b>{a.service_name}</b><br /><span className="small muted">{fullShortDate(a.start_at)} · {time12(a.start_at)} · {a.provider_short}</span></span><Badge tone="gray">{a.status === 'checked_in' ? 'Checked in' : 'Booked'}</Badge>
                      </Link>))}</div></section>
                )}
                <section className="card table-scroll">
                  <h2>Visit history</h2>
                  {visits.length === 0 ? <Empty title="No visits yet" /> : (
                    <table className="table">
                      <thead><tr><th>Date</th><th>Service</th><th>Provider</th><th className="num">Amount</th><th>Status</th></tr></thead>
                      <tbody>
                        {visits.map((v) => (
                          <tr key={v.id} className={v.invoice_id ? 'click' : ''} onClick={() => v.invoice_id && nav(`/reception/billing/${v.invoice_id}`)}>
                            <td style={{ whiteSpace: 'nowrap' }}>{mdy(v.date)}</td>
                            <td>{v.service_name}{v.session_no ? ` · session ${v.session_no}/${v.sessions_total}` : ''}{v.notes && <div className="xs muted" style={{ marginTop: 2 }}>{v.notes}</div>}</td>
                            <td>{v.provider_short}</td><td className="num">{money(v.amount_cents)}</td>
                            <td>{v.status === 'no_show' ? <Badge tone="red">No-show</Badge> : v.invoice_status === 'paid' ? <Badge>Paid</Badge> : v.invoice_status === 'outstanding' ? <Badge tone="red" title={`${money2(v.balance_cents)} due`}>Outstanding</Badge> : v.invoice_status === 'quote' ? <Badge tone="gold">Quote</Badge> : <Badge tone="gray">—</Badge>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              </div>
            </div>
            {modal === 'message' && <Message client={client} onClose={() => setModal(null)} onSent={state.reload} />}
            {modal === 'edit' && <ClientForm initial={client} onClose={() => setModal(null)} onSaved={state.reload} />}
          </>
        )}
      </Load>
    </>
  );
}
