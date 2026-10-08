import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, FileText, Receipt, Search, UserX } from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../api.js';
import { mdy, minutesSince, time12, plural } from '../format.js';
import { useDebounced, useLoad, useTick } from '../hooks.js';
import { Avatar, Badge, Button, Field, Load, StatusBadge, useSafe } from '../ui.jsx';

function Qr() {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(`${window.location.origin}/checkin`, { margin: 1, width: 360, color: { dark: '#1d1d18', light: '#ffffff' } }).then(setSrc).catch(() => {}); }, []);
  return src ? <img className="qr" src={src} alt="QR code that opens the self check-in page" /> : <div className="qr skeleton" />;
}

function Match({ m, services, onDone }) {
  const safe = useSafe();
  const [busy, setBusy] = useState(false);
  const [svc, setSvc] = useState('');
  const appt = m.appointments[0];
  async function checkIn() {
    setBusy(true);
    const ok = await safe(async () => {
      if (appt) {
        if (appt.status === 'booked') await api.post(`/appointments/${appt.id}/status`, { status: 'checked_in' });
      } else {
        await api.post('/checkin/walk-in', { client_id: m.client.id, service_id: +svc });
      }
    }, `${m.client.name} is checked in`);
    setBusy(false);
    if (ok) onDone();
  }
  const already = appt && appt.status !== 'booked';
  return (
    <div className="match-card">
      <div className="eyebrow">{m.visits > 0 ? 'Returning guest' : 'Booked guest'} · profile matched</div>
      <h2 style={{ fontSize: 24, margin: '6px 0 4px' }}>{m.client.name}</h2>
      <div className="muted">{m.client.phone}{m.last_visit && ` · last visit ${mdy(m.last_visit)}`} · {plural(m.visits, 'visit')}</div>
      <div style={{ margin: '10px 0 16px' }}>
        {appt
          ? <>Today: {appt.service_name}{appt.session_no ? ` · session ${appt.session_no} of ${appt.sessions_total}` : ''} · {appt.resource_name} · {time12(appt.start_at).replace(':00 ', ' ')}</>
          : <>No appointment today — check them in as a walk-in:
            <select className="select" style={{ marginTop: 8, background: '#fff' }} value={svc} onChange={(e) => setSvc(e.target.value)} aria-label="Visit reason">
              <option value="">Visit reason…</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></>}
      </div>
      <Button className="lg" busy={busy} disabled={already || (!appt && !svc)} onClick={checkIn}>
        {already ? 'Already checked in' : 'Check in — no details to re-enter'}
      </Button>
    </div>
  );
}

function Intake({ services, onDone }) {
  const [form, setForm] = useState({ language: 'English', service_id: '', referred_by: 'Walk-in', name: '', phone: '' });
  const [err, setErr] = useState('');
  const [noCap, setNoCap] = useState(false);
  const [busy, setBusy] = useState(false);
  const safe = useSafe();
  const meta = useLoad(() => api.get('/meta'), []);
  const consults = services.filter((s) => s.kind === 'consult' && s.online_bookable);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setNoCap(false);
    try {
      await api.post('/checkin/walk-in', { ...form, service_id: +form.service_id });
      safe(async () => {}, `${form.name} added to the queue`);
      setForm({ language: 'English', service_id: '', referred_by: 'Walk-in', name: '', phone: '' });
      onDone();
    } catch (ex) { setErr(ex.message); setNoCap(ex.code === 'no_capacity'); } finally { setBusy(false); }
  }
  async function waitlist() {
    const client = await safe(() => api.post('/clients', { name: form.name, phone: form.phone, language: form.language }));
    // an existing phone returns 409 — fall back to the walk-in/search flow in that case
    if (!client) return;
    if (await safe(() => api.post('/waitlist', { client_id: client.id, service_id: +form.service_id }), 'Added to waitlist')) onDone();
  }
  return (
    <form className="card stack" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>New guest intake</h2>
      <Field label="Language">
        <div className="chips">{['English', 'Español', 'Other'].map((l) => <button key={l} type="button" className={`chip ${form.language === l ? 'on' : ''}`} onClick={() => setForm({ ...form, language: l })}>{l}</button>)}</div>
      </Field>
      <div className="row wrap" style={{ alignItems: 'flex-start' }}>
        <div className="grow"><Field label="Full name"><input className="input" value={form.name} onChange={set('name')} required /></Field></div>
        <div className="grow"><Field label="Phone"><input className="input" inputMode="tel" placeholder="(555) 123-4567" value={form.phone} onChange={set('phone')} required /></Field></div>
      </div>
      <Field label="Visit reason"><select className="select" value={form.service_id} onChange={set('service_id')} required>
        <option value="">Choose…</option>{consults.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Referred by"><select className="select" value={form.referred_by} onChange={set('referred_by')}>
        {(meta.data?.referrals ?? ['Walk-in']).map((r) => <option key={r}>{r}</option>)}</select></Field>
      {err && <div className="form-error" role="alert">{err}</div>}
      <div className="row"><Button type="submit" busy={busy}>Add to queue</Button>
        {noCap && <button type="button" className="btn secondary" onClick={waitlist}>Add to waitlist instead</button>}</div>
    </form>
  );
}

const FILTERS = [['all', 'All'], ['waiting', 'Waiting'], ['active', 'In progress'], ['upcoming', 'Upcoming'], ['done', 'Done']];
const rank = { with_provider: 0, in_room: 1, checked_in: 2, booked: 3, done: 4 };

function QueueRow({ a, now, open, onToggle, reload }) {
  const safe = useSafe();
  const nav = useNavigate();
  const since = a.status === 'checked_in' ? a.checked_in_at : a.status === 'in_room' ? a.room_at : a.status === 'with_provider' ? a.started_at : null;
  const mins = since ? minutesSince(since, now) : null;
  const act = async (fn, msg) => { if (await safe(fn, msg)) reload(); };
  return (
    <div className={`queue-row ${a.status === 'booked' ? 'dim' : ''}`}>
      <button className="head" onClick={onToggle} aria-expanded={open}>
        <Avatar name={a.client_name} tone={a.status === 'done' ? 'brand' : ''} />
        <span className="grow"><b>{a.client_name}</b><br /><span className="small muted">{a.service_name}{a.session_no ? ` · session ${a.session_no}/${a.sessions_total}` : ''}{a.channel === 'online' ? ' · booked online' : ''}</span></span>
        <span style={{ textAlign: 'right' }}>
          {a.status === 'done' ? <Badge>Done · {time12(a.finished_at ?? a.start_at)}</Badge>
            : a.status === 'booked' ? <Badge tone="gray">Upcoming · {a.start_at.slice(11, 16)}</Badge> : <StatusBadge appt={a} minutes={mins} />}
        </span>
        {a.status === 'checked_in' && (
          <span role="button" tabIndex={0} className="icon-btn" aria-label={`Page ${a.provider_short}`} title={`Page ${a.provider_short}`}
            onClick={(e) => { e.stopPropagation(); act(() => api.post(`/appointments/${a.id}/notify-provider`), `${a.provider_short} paged`); }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.click()}><Bell size={18} /></span>
        )}
      </button>
      {open && (
        <div className="actions">
          {a.status === 'booked' && <Button size="sm" onClick={() => act(() => api.post(`/appointments/${a.id}/status`, { status: 'checked_in' }), 'Checked in')}>Check in</Button>}
          {a.status === 'checked_in' && <Button size="sm" onClick={() => act(() => api.post(`/appointments/${a.id}/status`, { status: 'in_room' }), `Sent to ${a.resource_name}`)}>Send to {a.resource_name}</Button>}
          {['checked_in', 'in_room'].includes(a.status) && <Button size="sm" variant="secondary" onClick={() => act(() => api.post(`/appointments/${a.id}/status`, { status: 'with_provider' }), 'Consultation started')}>Start with {a.provider_short}</Button>}
          {a.status !== 'booked' && <Button size="sm" variant="secondary" icon={FileText} onClick={() => nav(`/staff/consultation/${a.id}`)}>Open consultation</Button>}
          {['with_provider', 'done', 'in_room'].includes(a.status) && <Link className="btn sm secondary" to={`/reception/billing/visit/${a.id}`}><Receipt size={15} /> {a.invoice?.status === 'paid' ? 'View invoice' : 'Check out'}</Link>}
          {['booked', 'checked_in'].includes(a.status) && <Button size="sm" variant="danger secondary" icon={UserX} onClick={() => act(() => api.post(`/appointments/${a.id}/no-show`), 'Marked no-show')}>No-show</Button>}
          <Link className="btn sm ghost" to={`/reception/appointments/${a.id}`}>Reschedule / cancel</Link>
        </div>
      )}
    </div>
  );
}

export default function CheckIn() {
  const queue = useLoad(() => api.get('/queue'), [], { live: true });
  const services = useLoad(() => api.get('/services'), []);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [matches, setMatches] = useState([]);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const now = useTick(30000);

  useEffect(() => {
    if (dq.trim().length < 2) { setMatches([]); return; }
    let live = true;
    api.get(`/checkin/search?q=${encodeURIComponent(dq.trim())}`).then((r) => live && setMatches(r)).catch(() => {});
    return () => { live = false; };
  }, [dq, queue.data]);

  const d = queue.data;
  const list = (d?.appointments ?? [])
    .filter((a) => (filter === 'all' ? true : filter === 'waiting' ? a.status === 'checked_in' : filter === 'active' ? ['in_room', 'with_provider'].includes(a.status) : filter === 'upcoming' ? a.status === 'booked' : a.status === 'done'))
    .sort((x, y) => rank[x.status] - rank[y.status] || (x.checked_in_at ?? x.start_at).localeCompare(y.checked_in_at ?? y.start_at));
  const count = (f) => (d?.appointments ?? []).filter((a) => (f === 'waiting' ? a.status === 'checked_in' : f === 'active' ? ['in_room', 'with_provider'].includes(a.status) : f === 'upcoming' ? a.status === 'booked' : f === 'done' ? a.status === 'done' : true)).length;

  return (
    <>
      <div className="page-head"><div><h1>Check-in</h1><p>{d ? `${d.expected} expected today · ${d.waiting} waiting now` : ' '}</p></div></div>
      <div className="two-col" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.05fr)', alignItems: 'start' }}>
        <div className="stack">
          <section className="card" style={{ textAlign: 'center' }}>
            <Qr />
            <b style={{ fontSize: 17 }}>Scan to check in</b>
            <div className="muted small" style={{ margin: '2px 0 14px' }}>or search by name / phone below</div>
            <div className="input-icon" style={{ textAlign: 'left' }}><Search size={18} /><input className="input" placeholder="Name or phone number" aria-label="Find guest" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </section>
          {matches.map((m) => <Match key={m.client.id} m={m} services={services.data ?? []} onDone={() => { queue.reload(); setQ(''); }} />)}
          {dq.trim().length >= 2 && matches.length === 0 && <div className="card soft small muted">No guest matches “{dq}”. Use New guest intake below.</div>}
          <Intake services={services.data ?? []} onDone={queue.reload} />
        </div>
        <section className="card">
          <div className="row between" style={{ marginBottom: 12 }}><h2 style={{ margin: 0 }}>Live queue</h2><span className="small muted">updates in real time</span></div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {FILTERS.map(([k, label]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} style={{ padding: '5px 12px', fontSize: 13 }} onClick={() => setFilter(k)}>{label} {count(k)}</button>)}
          </div>
          <Load state={queue}>
            {() => (
              <div className="stack sm">
                {list.map((a) => <QueueRow key={a.id} a={a} now={now} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} reload={queue.reload} />)}
                {list.length === 0 && <div className="empty small">Nobody here yet.</div>}
              </div>
            )}
          </Load>
        </section>
      </div>
    </>
  );
}
