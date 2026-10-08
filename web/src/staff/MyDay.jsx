import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Play } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { greeting, hhmmTo12, longDate, minutesSince, money, time12 } from '../format.js';
import { useLoad, useTick } from '../hooks.js';
import { Badge, Button, Empty, Load, useSafe } from '../ui.jsx';

const timeLabel = (s) => { const t = time12(s); return <>{t.slice(0, -3).replace(/:00$/, '')}<span className="xs faint" style={{ marginLeft: 2 }}>{t.slice(-2)}</span></>; };
const label = { checked_in: ['Waiting', 'gold'], in_room: ['In room', 'steel'], with_provider: ['With you', 'steel'], done: ['Done', ''], booked: ['Upcoming', 'gray'] };

export default function MyDay() {
  const { user } = useAuth();
  const nav = useNavigate();
  const safe = useSafe();
  const providers = useLoad(() => (user.role === 'reception' ? api.get('/meta') : Promise.resolve(null)), []);
  const [asStaff, setAsStaff] = useState('');
  const staffId = user.role === 'reception' ? asStaff || providers.data?.providers?.[0]?.id || '' : '';
  const state = useLoad(() => api.get(`/staff/my-day${staffId ? `?staff_id=${staffId}` : ''}`), [staffId], { live: true });
  const now = useTick(30000);
  const [busy, setBusy] = useState(false);

  async function start(a) {
    setBusy(true);
    const ok = await safe(() => (user.role === 'provider' ? api.post(`/staff/consultations/${a.id}/start`) : Promise.resolve(true)));
    setBusy(false);
    if (ok) nav(`/staff/consultation/${a.id}`);
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <Load state={state}>
        {(d) => {
          const lunchT = `${d.date}T${d.lunch.start}:00`;
          const rows = [...d.appointments.map((a) => ({ t: a.start_at, a })), { t: lunchT, lunch: true }].sort((x, y) => x.t.localeCompare(y.t));
          const active = d.appointments.find((a) => a.status === 'with_provider') ?? d.appointments.find((a) => a.status === 'in_room') ?? d.appointments.find((a) => a.status === 'checked_in');
          const next = active ?? d.appointments.find((a) => a.status === 'booked');
          const total = d.summary.total;
          return (
            <>
              <div className="page-head" style={{ marginBottom: 14 }}>
                <div>
                  <div className="muted">{greeting()}</div>
                  <h1>{user.role === 'provider' ? user.name : 'My day'}</h1>
                </div>
                {user.role === 'reception' && (
                  <select className="select" style={{ width: 'auto' }} aria-label="Provider" value={staffId} onChange={(e) => setAsStaff(e.target.value)}>
                    {(providers.data?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>

              {d.notifications.length > 0 && (
                <div className="banner warn" style={{ marginBottom: 12, alignItems: 'flex-start' }}>
                  <Bell size={18} style={{ marginTop: 2 }} />
                  <div className="grow">{d.notifications.map((n) => <div key={n.id}>{n.body}</div>)}</div>
                  <button className="btn ghost sm" onClick={async () => { await api.post('/staff/notifications/read'); state.reload(); }}>Dismiss</button>
                </div>
              )}

              {next && (
                <div className="card tight row between wrap" style={{ marginBottom: 18, borderColor: 'var(--brand-line)', background: 'var(--brand-soft)' }}>
                  <div><div className="eyebrow" style={{ color: 'var(--brand)' }}>{active ? (active.status === 'with_provider' ? 'In progress' : 'Ready for you') : 'Next up'}</div>
                    <b style={{ fontSize: 18 }}>{next.client_name}</b>
                    <div className="small muted">{next.service_name}{next.resource_kind === 'consult' ? '' : ` · ${next.resource_name}`} · {hhmmTo12(next.start_at.slice(11, 16))}</div></div>
                  <Button icon={Play} busy={busy} onClick={() => start(next)}>
                    {next.status === 'with_provider' ? 'Continue consultation' : next.status === 'booked' ? 'Open consultation' : 'Start consultation'}
                  </Button>
                </div>
              )}

              <div className="eyebrow" style={{ marginBottom: 10 }}>{longDate(d.date)} · {total} appointment{total === 1 ? '' : 's'}</div>
              <div className="stack sm">
                {rows.map((r, i) => {
                  if (r.lunch) return <div key="lunch" className="day-card muted-card"><span className="t">{timeLabel(lunchT)}</span><span>—<br />Lunch</span></div>;
                  const a = r.a;
                  const [text, tone] = label[a.status] ?? ['', 'gray'];
                  const since = a.status === 'checked_in' ? a.checked_in_at : null;
                  return (
                    <button key={a.id} className={`day-card ${a === active ? 'live' : ''}`} onClick={() => nav(`/staff/consultation/${a.id}`)}>
                      <span className="t">{timeLabel(a.start_at)}</span>
                      <span className="grow"><span className="n">{a.client_name}</span><br /><span className="s">{a.service_name}{a.session_no ? ` · session ${a.session_no}/${a.sessions_total}` : ''}{a.resource_kind === 'consult' ? '' : ` · ${a.resource_name}`}</span></span>
                      <Badge tone={tone}>{text}{since ? ` · ${minutesSince(since, now)}m` : ''}</Badge>
                    </button>
                  );
                })}
                {rows.length === 1 && <Empty title="No appointments today">Enjoy the quiet.</Empty>}
              </div>
              <div className="day-foot" style={{ margin: '24px 0 0', borderRadius: 14, border: '1px solid var(--line)' }}>
                <span className="muted">Completed today</span>
                <b>{d.summary.done} of {total} · {money(d.summary.revenue_cents)} earned</b>
              </div>
              {d.summary.commission_cents > 0 && <div className="small muted right" style={{ marginTop: 6 }}>Est. commission {money(d.summary.commission_cents)}</div>}
            </>
          );
        }}
      </Load>
    </div>
  );
}
