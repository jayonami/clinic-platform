import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Receipt, UserCheck } from 'lucide-react';
import { api } from '../api.js';
import { fullShortDate, hhmmTo12, shortDate, time12, today } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Badge, Button, Field, Load, StatusBadge, useSafe } from '../ui.jsx';

export default function EditAppointment() {
  const { id } = useParams();
  const nav = useNavigate();
  const safe = useSafe();
  const state = useLoad(() => api.get(`/appointments/${id}`), [id], { live: true });
  const meta = useLoad(() => api.get('/meta'), []);
  const [tab, setTab] = useState('reschedule');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [providerId, setProviderId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [more, setMore] = useState(false);
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  const [slots, setSlots] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const a = state.data;

  useEffect(() => {
    if (a && !date) { setDate(a.start_at.slice(0, 10)); setProviderId(a.provider_id); setResourceId(a.resource_id); }
  }, [a, date]);
  useEffect(() => {
    if (!a || !date) return;
    let live = true;
    api.get(`/availability?date=${date}&service_id=${a.service_id}&provider_id=${providerId || a.provider_id}&resource_id=${resourceId || a.resource_id}&exclude_id=${a.id}`)
      .then((r) => live && setSlots(r.filter((s) => s.reason !== 'lunch' && s.reason !== 'past'))).catch(() => {});
    return () => { live = false; };
  }, [a, date, providerId, resourceId]);

  const editable = a && ['booked', 'checked_in'].includes(a.status);
  const reasons = meta.data?.reasons?.[tab === 'cancel' ? 'cancel' : 'reschedule'] ?? [];

  async function save() {
    setBusy(true);
    setError('');
    try {
      if (tab === 'reschedule') {
        await api.patch(`/appointments/${a.id}`, { date, time, provider_id: providerId, resource_id: resourceId, reason, notify });
        safe(async () => {}, `Moved to ${shortDate(date)} ${hhmmTo12(time)}`);
      } else {
        await api.post(`/appointments/${a.id}/cancel`, { reason, notify });
        safe(async () => {}, 'Appointment cancelled');
      }
      nav(`/reception/calendar?date=${tab === 'reschedule' ? date : a.start_at.slice(0, 10)}`);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function act(fn, msg) {
    if (await safe(fn, msg)) state.reload();
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto' }}>
      <Link to={`/reception/calendar${a ? `?date=${a.start_at.slice(0, 10)}` : ''}`} className="back-link"><ArrowLeft size={16} /> Back to calendar</Link>
      <div className="page-head"><h1>Edit Appointment</h1></div>
      <Load state={state}>
        {(a) => (
          <div className="stack">
            <div className="card tight row between wrap">
              <div className="row">
                <Avatar name={a.client_name} />
                <div>
                  <b style={{ fontSize: 18 }}>{a.client_name} — {a.service_name}</b>
                  <div className="muted small">{a.provider_short} · {a.resource_name} · {shortDate(a.start_at)} · {time12(a.start_at).replace(':00 ', ' ')}</div>
                </div>
              </div>
              <div className="row wrap"><StatusBadge appt={a} /><Link className="btn ghost sm" to={`/reception/clients/${a.client_id}`}>Profile</Link></div>
            </div>

            <div className="row wrap">
              {a.status === 'booked' && <Button size="sm" variant="secondary" icon={UserCheck} onClick={() => act(() => api.post(`/appointments/${a.id}/status`, { status: 'checked_in' }), 'Checked in')}>Check in</Button>}
              {['checked_in', 'in_room', 'with_provider'].includes(a.status) && <Link className="btn sm secondary" to={`/staff/consultation/${a.id}`}><FileText size={15} /> Open consultation</Link>}
              {['done', 'with_provider', 'in_room', 'checked_in'].includes(a.status) && <Link className="btn sm secondary" to={`/reception/billing/visit/${a.id}`}><Receipt size={15} /> Check out</Link>}
              {['booked', 'checked_in'].includes(a.status) && <Button size="sm" variant="danger secondary" onClick={() => act(() => api.post(`/appointments/${a.id}/no-show`), 'Marked no-show — follow-up call assigned')}>Mark no-show</Button>}
            </div>

            {editable ? (
              <>
                <div className="segmented full" role="tablist">
                  <button role="tab" aria-selected={tab === 'reschedule'} className={tab === 'reschedule' ? 'on' : ''} onClick={() => { setTab('reschedule'); setReason(''); setError(''); }}>Reschedule</button>
                  <button role="tab" aria-selected={tab === 'cancel'} className={tab === 'cancel' ? 'on' : ''} onClick={() => { setTab('cancel'); setReason(''); setError(''); }}>Cancel</button>
                </div>
                <section className="card stack">
                  {tab === 'reschedule' && (
                    <>
                      <Field label="New date"><input type="date" className="input" min={today()} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} /></Field>
                      <Field label="New time">
                        <div className="chips">
                          {slots.map((s) => (
                            <button key={s.time} type="button" disabled={!s.available} className={`chip square ${time === s.time ? 'on' : ''}`} onClick={() => setTime(s.time)}>
                              {hhmmTo12(s.time)}{!s.available && ' · Full'}
                            </button>
                          ))}
                        </div>
                      </Field>
                      <button type="button" className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore((m) => !m)}>{more ? 'Hide' : 'Change'} provider / room</button>
                      {more && (
                        <div className="row wrap">
                          <div className="grow"><Field label="Provider"><select className="select" value={providerId} onChange={(e) => setProviderId(+e.target.value)}>
                            {(meta.data?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></div>
                          <div className="grow"><Field label="Therapist column"><select className="select" value={resourceId} onChange={(e) => setResourceId(+e.target.value)}>
                            {(meta.data?.resources ?? []).filter((r) => r.kind === a.service_kind).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field></div>
                        </div>
                      )}
                    </>
                  )}
                  <Field label="Reason">
                    <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                      <option value="">Choose a reason…</option>
                      {reasons.map((r) => <option key={r}>{r}</option>)}
                    </select>
                  </Field>
                  <label className="checkbox"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Text the client automatically</label>
                  {tab === 'cancel' && <div className="banner warn">The freed slot goes to the waitlist{' '}— auto-fill will offer it to the first matching guest.</div>}
                </section>

                <section className="card soft">
                  <b>Change log</b>
                  {a.changes.length === 0
                    ? <p className="muted small" style={{ marginTop: 6 }}>No prior changes — this will be logged the moment you save, with who, when and why.</p>
                    : <ul style={{ margin: '8px 0 0', paddingLeft: 18 }} className="small">
                      {a.changes.map((c) => (
                        <li key={c.id} style={{ margin: '4px 0' }}>
                          <b>{c.type === 'reschedule' ? `Moved ${c.from_start.slice(11, 16)} → ${c.to_start.slice(11, 16)}` : c.type === 'cancel' ? 'Cancelled' : 'No-show'}</b>
                          {' '}· {c.reason} · {c.by_client ? 'client' : c.by_name ?? 'system'} · {fullShortDate(c.created_at)} {time12(c.created_at)}
                        </li>
                      ))}
                    </ul>}
                </section>
                {error && <div className="form-error" role="alert">{error}</div>}
                <Button className="lg" variant={tab === 'cancel' ? 'danger' : ''} busy={busy}
                  disabled={!reason || (tab === 'reschedule' && !time)} onClick={save}>
                  {tab === 'cancel' ? 'Cancel appointment' : 'Save changes'}
                </Button>
              </>
            ) : (
              <section className="card stack">
                <Badge tone="gray">{a.status === 'done' ? 'This visit is finished' : `This appointment is ${a.status.replace('_', ' ')}`}</Badge>
                <p className="muted small">Only upcoming appointments can be rescheduled or cancelled.</p>
                {a.changes.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{a.changes.map((c) => <li key={c.id}>{c.type} · {c.reason} · {c.by_name ?? 'system'}</li>)}</ul>}
              </section>
            )}
          </div>
        )}
      </Load>
    </div>
  );
}
