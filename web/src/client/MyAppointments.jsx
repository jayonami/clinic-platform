import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { client, tokens } from '../api.js';
import { addDays, md, mdy, money, shortDate, time12, today } from '../format.js';
import { useLoad } from '../hooks.js';
import { Badge, Button, ErrorBox, Modal, Spinner, useSafe } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';
import SignIn from './SignIn.jsx';

const WINDOWS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];
const STATUS = { booked: ['Confirmed', ''], checked_in: ['Checked in', 'green'], in_room: ['In progress', 'steel'], with_provider: ['In progress', 'steel'] };

function RescheduleSheet({ a, onClose, onDone }) {
  const [date, setDate] = useState(addDays(a.start_at.slice(0, 10), 1) < today() ? today() : addDays(a.start_at.slice(0, 10), 1));
  const [tod, setTod] = useState('afternoon');
  const [busy, setBusy] = useState(false);
  const safe = useSafe();
  async function go() {
    setBusy(true);
    const ok = await safe(() => client.post(`/public/client/appointments/${a.id}/reschedule`, { date, time_of_day: tod }), 'Request sent — we’ll text you to confirm');
    setBusy(false);
    if (ok) { onDone(); onClose(); }
  }
  return (
    <Modal sheet title="Ask for a new time" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button busy={busy} onClick={go}>Send request</Button></>}>
      <p className="muted small" style={{ marginBottom: 14 }}>Your current slot stays booked until we confirm the new one.</p>
      <div className="m-field"><label htmlFor="rd">Preferred date</label><input id="rd" type="date" className="input" min={today()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <div className="chips">{WINDOWS.map(([k, l]) => <button key={k} className={`chip ${tod === k ? 'on' : ''}`} onClick={() => setTod(k)}>{l}</button>)}</div>
    </Modal>
  );
}

function CancelSheet({ a, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function go() {
    setBusy(true); setErr('');
    try { await client.post(`/public/client/appointments/${a.id}/cancel`); onDone(); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal sheet title="Cancel this appointment?" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Keep it</Button><Button variant="danger" busy={busy} onClick={go}>Yes, cancel</Button></>}>
      <p className="muted">{a.service_name} on {shortDate(a.start_at)} at {time12(a.start_at)}. We’ll text you a confirmation.</p>
      {err && <div className="form-error" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}

function Signed({ onSignOut }) {
  const nav = useNavigate();
  const state = useLoad(() => client.get('/public/client/appointments'), []);
  const [sheet, setSheet] = useState(null);
  useEffect(() => { if (state.error?.status === 401) onSignOut(); }, [state.error, onSignOut]);
  if (state.error && !state.data) return <Frame back="/" title="My Appointments"><ErrorBox error={state.error} retry={state.reload} /></Frame>;
  if (!state.data) return <Frame back="/" title="My Appointments"><Spinner /></Frame>;
  const d = state.data;
  return (
    <Frame back="/" title="My Appointments" footer={<>
      <Button className="lg" onClick={() => nav('/book')}>Book a new appointment</Button>
      <button className="btn ghost" style={{ color: 'var(--ink-2)' }} onClick={onSignOut}>Sign out ({d.client.name.split(' ')[0]})</button>
    </>}>
      <div className="m-section-title">Upcoming</div>
      <div className="stack">
        {d.upcoming.map((a) => {
          const [text, tone] = STATUS[a.status] ?? ['Confirmed', ''];
          return (
            <div className="m-card" key={a.id}>
              <div className="row between" style={{ alignItems: 'flex-start' }}><b style={{ fontSize: 19 }}>{a.service_name}</b><Badge tone={tone}>{text}</Badge></div>
              <div className="muted" style={{ margin: '8px 0 4px' }}>{a.session_no ? `Session ${a.session_no} of ${a.sessions_total} · ` : ''}{a.clinic}</div>
              <div className="muted">{shortDate(a.start_at)} · {time12(a.start_at)}</div>
              {a.pending_reschedule && <div className="small" style={{ marginTop: 8, color: 'var(--gold-ink)' }}>Reschedule requested — we’ll text you.</div>}
              {a.status === 'booked' && (
                <div className="row" style={{ marginTop: 14 }}>
                  <Button variant="secondary" className="grow" disabled={a.pending_reschedule} onClick={() => setSheet({ type: 'resched', a })}>Reschedule</Button>
                  <Button variant="danger secondary" className="grow" disabled={!a.can_cancel} onClick={() => setSheet({ type: 'cancel', a })}>Cancel</Button>
                </div>
              )}
              {a.status === 'booked' && !a.can_cancel && <div className="xs faint" style={{ marginTop: 8 }}>Within {a.window_hours} hours of your visit — please call the clinic to cancel.</div>}
            </div>
          );
        })}
        {d.requests.map((r) => (
          <div className="m-card" key={`r${r.id}`}>
            <div className="row between"><b style={{ fontSize: 19 }}>{r.service_name}</b><Badge tone="gold">Requested</Badge></div>
            <div className="muted" style={{ marginTop: 6 }}>{shortDate(`${r.preferred_date}T12:00:00`)} · {r.time_of_day} — waiting for confirmation</div>
          </div>
        ))}
        {d.upcoming.length === 0 && d.requests.length === 0 && <div className="m-card muted">Nothing booked yet.</div>}
        {d.outstanding.map((o) => (
          <div className="pay-banner" key={o.id}>
            <div className="grow"><b>{money(o.balance_cents)} outstanding from your last visit</b><span className="small">{md(o.service_date)} · {o.summary}</span></div>
            <Link to={`/pay/${o.id}`} className="btn gold">Pay now</Link>
          </div>
        ))}
      </div>
      <div className="m-section-title">Past visits</div>
      <div className="stack">
        {d.past.map((p) => (
          <div className="m-card row between" key={p.id}>
            <div><b style={{ fontSize: 17 }}>{p.service_name}</b><div className="muted small">{mdy(p.start_at)}{p.session_no ? ` · Session ${p.session_no} of ${p.sessions_total}` : ''}</div></div>
            <Link to={`/book?service=${p.service_id}`} style={{ fontWeight: 700, whiteSpace: 'nowrap', flex: 'none' }}>Book again</Link>
          </div>
        ))}
        {d.past.length === 0 && <div className="muted small">Your visit history will show up here.</div>}
      </div>
      {sheet?.type === 'resched' && <RescheduleSheet a={sheet.a} onClose={() => setSheet(null)} onDone={state.reload} />}
      {sheet?.type === 'cancel' && <CancelSheet a={sheet.a} onClose={() => setSheet(null)} onDone={state.reload} />}
    </Frame>
  );
}

export default function MyAppointments() {
  const [signed, setSigned] = useState(!!tokens.get('client'));
  const out = () => { tokens.set('client', null); setSigned(false); };
  return signed ? <Signed onSignOut={out} /> : <Frame back="/" brand><SignIn onDone={() => setSigned(true)} /></Frame>;
}
