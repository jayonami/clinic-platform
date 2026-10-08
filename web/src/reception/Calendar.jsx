import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, ChevronLeft, ChevronRight, Clock, Plus, Zap } from 'lucide-react';
import { api } from '../api.js';
import { addDays, longDate, minutesSince, shortDate, time12, today as todayStr } from '../format.js';
import { useLoad, useTick } from '../hooks.js';
import { Badge, Button, Field, Load, Modal, useSafe } from '../ui.jsx';
import ClientPicker from './ClientPicker.jsx';

const HOUR = 88;
const toMin = (s) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
const minOf = (dt) => toMin(dt.slice(11, 16));

function AppointmentBlock({ a, top, height, onOpen }) {
  const tall = height > 76;
  const addon = a.addon_names ? ` + ${a.addon_names.toLowerCase()} add-on` : '';
  return (
    <button className={`appt ${a.resource_kind} ${a.status}`} style={{ top, height }} onClick={() => onOpen(a)}
      aria-label={`${a.client_name}, ${a.service_name}, ${time12(a.start_at)}`}>
      <b>{a.client_name}</b>
      <span>{a.service_name}{addon}</span>
      {tall && (
        <span className="tags">
          {a.session_no && <i className="tag" style={{ fontStyle: 'normal' }}>Package · session {a.session_no}/{a.sessions_total}</i>}
          {a.status === 'checked_in' && <i className="tag live" style={{ fontStyle: 'normal' }}>Waiting</i>}
          {(a.status === 'in_room' || a.status === 'with_provider') && <i className="tag prog" style={{ fontStyle: 'normal' }}>In progress</i>}
          {a.status === 'done' && <i className="tag" style={{ fontStyle: 'normal' }}>Done</i>}
          {a.status === 'no_show' && <i className="tag" style={{ fontStyle: 'normal', color: 'var(--red)' }}>No-show</i>}
        </span>
      )}
    </button>
  );
}

function DayGrid({ data }) {
  const nav = useNavigate();
  const { open, close, lunch_start, lunch_end } = data.hours;
  const startMin = toMin(open);
  const endMin = toMin(close);
  const height = ((endMin - startMin) / 60) * HOUR;
  const px = (min) => ((min - startMin) / 60) * HOUR;
  const cols = `64px repeat(${data.resources.length}, minmax(150px, 1fr))`;
  const hourMarks = [];
  for (let m = startMin; m < endMin; m += 60) hourMarks.push(m);
  const isToday = data.date === todayStr();
  const nowMin = isToday ? minOf(data.now) : null;
  const openAppt = (a) => nav(`/reception/appointments/${a.id}`);

  function clickCol(e, r) {
    if (e.target !== e.currentTarget && !e.target.classList.contains('cal-line')) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const snapped = Math.floor((startMin + (y / HOUR) * 60) / 30) * 30;
    const hh = String(Math.floor(snapped / 60)).padStart(2, '0');
    const mm = String(snapped % 60).padStart(2, '0');
    nav(`/reception/appointments/new?date=${data.date}&time=${hh}:${mm}&resource=${r.id}`);
  }

  return (
    <div className="cal" style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: 64 + data.resources.length * 150 }}>
        <div className="cal-head" style={{ gridTemplateColumns: cols }}>
          <div />
          {data.resources.map((r) => <div key={r.id}>{r.label}</div>)}
        </div>
        <div className="cal-body" style={{ gridTemplateColumns: cols, height }}>
          <div className="cal-times">
            {hourMarks.map((m) => <span key={m} style={{ top: px(m) + 14 }}>{String(Math.floor(m / 60)).padStart(2, '0')}:00</span>)}
          </div>
          {data.resources.map((r) => (
            <div key={r.id} className="cal-col" onClick={(e) => clickCol(e, r)} title="Click an empty time to book">
              {hourMarks.map((m) => <div key={m} className="cal-line" style={{ top: px(m) }} />)}
              <div className="blocked" style={{ top: px(toMin(lunch_start)) + 3, height: px(toMin(lunch_end)) - px(toMin(lunch_start)) - 6 }}>Lunch</div>
              {data.open_slots.filter((s) => s.resource_id === r.id).map((s) => {
                const top = px(minOf(s.start_at));
                const h = px(minOf(s.end_at)) - top - 4;
                const label = s.status === 'offered' ? 'Offered to waitlist' : 'Open';
                return (
                  <button key={s.id} className="open-slot" style={{ top, height: h }}
                    onClick={() => nav(`/reception/appointments/new?date=${data.date}&time=${s.start_at.slice(11, 16)}&resource=${r.id}`)}>
                    <span>{label}</span>
                    <Badge>{s.status === 'offered' ? 'Waiting for reply' : `Reopened ${time12(s.created_at).replace(':00 ', '').toLowerCase().replace(' ', '')}`}</Badge>
                  </button>
                );
              })}
              {data.appointments.filter((a) => a.resource_id === r.id).map((a) => {
                const top = px(minOf(a.start_at));
                const h = Math.max(36, px(minOf(a.end_at)) - top - 4);
                return <AppointmentBlock key={a.id} a={a} top={top} height={h} onOpen={openAppt} />;
              })}
              {nowMin != null && nowMin >= startMin && nowMin <= endMin && <div className="now-line" style={{ top: px(nowMin) }} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeekGrid({ data, onPickDay }) {
  const nav = useNavigate();
  const t = todayStr();
  return (
    <div className="cal">
      <div className="week">
        {data.days.map((d) => (
          <div key={d.date}>
            <button className={`day-head ${d.date === t ? 'today' : ''}`} onClick={() => onPickDay(d.date)}>
              {shortDate(d.date)}<div className="small muted" style={{ fontWeight: 500 }}>{d.appointments.length} appt{d.appointments.length === 1 ? '' : 's'}</div>
            </button>
            {d.appointments.map((a) => (
              <button key={a.id} className={`wk-appt ${a.resource_kind} ${a.status}`} onClick={() => nav(`/reception/appointments/${a.id}`)}>
                <b>{time12(a.start_at).replace(':00', '')}</b> {a.client_name}<br /><span className="muted">{a.service_name}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function SlotPicker({ w, slots, onPick, onClose }) {
  return (
    <Modal title={`Offer a slot to ${w.client_name}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <p className="muted small" style={{ marginBottom: 12 }}>{w.service_name} needs {w.duration_min} min. They’ll get a text with a link to claim it.</p>
      <div className="stack sm">
        {slots.map((s) => (
          <button key={s.id} className="opt" onClick={() => onPick(s.id)}>
            <Clock size={18} /><span className="grow"><b>{time12(s.start_at)}–{time12(s.end_at)}</b><br /><span className="small muted">{s.resource_name}</span></span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function AddWaitlist({ onClose, onDone }) {
  const [client, setClient] = useState(null);
  const [serviceId, setServiceId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const safe = useSafe();
  const services = useLoad(() => api.get('/services'), []);
  async function save() {
    setBusy(true);
    const ok = await safe(() => api.post('/waitlist', { client_id: client.id, service_id: +serviceId, note }), 'Added to waitlist');
    setBusy(false);
    if (ok) { onDone(); onClose(); }
  }
  return (
    <Modal title="Add to waitlist" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} disabled={!client || !serviceId} onClick={save}>Add</Button></>}>
      <div className="stack">
        <Field label="Guest"><ClientPicker value={client} onChange={setClient} /></Field>
        <Field label="Service">
          <select className="select" value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">Choose…</option>
            {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. mornings only" /></Field>
      </div>
    </Modal>
  );
}

export default function Calendar() {
  const [sp, setSp] = useSearchParams();
  const safe = useSafe();
  const date = sp.get('date') || todayStr();
  const view = sp.get('view') === 'week' ? 'week' : 'day';
  const provider = sp.get('provider') || '';
  const set = (patch) => setSp((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const state = useLoad(() => api.get(`/calendar?date=${date}&view=${view}${provider ? `&provider_id=${provider}` : ''}`), [date, view, provider], { live: true });
  const meta = useLoad(() => api.get('/meta'), []);
  const [picker, setPicker] = useState(null);
  const [adding, setAdding] = useState(false);
  const now = useTick(30000);

  const data = state.data;
  const slotsById = useMemo(() => Object.fromEntries((data?.open_slots ?? []).map((s) => [s.id, s])), [data]);

  async function offer(w, slotId) {
    setPicker(null);
    await safe(() => api.post(`/waitlist/${w.id}/offer`, { slot_id: slotId }), `Offer sent to ${w.client_name}`);
    state.reload();
  }
  async function reply(w, accept) {
    const r = await safe(() => api.post(`/offers/${w.offer_id}/respond`, { accept }), accept ? `${w.client_name} booked` : 'Marked declined');
    if (r) state.reload();
  }
  async function toggleAutofill() {
    await safe(() => api.put('/settings', { autofill: data.autofill ? 0 : 1 }));
    state.reload();
  }

  const step = (n) => set({ date: addDays(date, view === 'week' ? n * 7 : n) });
  void now;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{longDate(date)}</h1>
          <p>{data ? `${data.counts?.providers ?? data.resources.length} providers · ${data.counts?.appointments ?? data.days?.reduce((n, d) => n + d.appointments.length, 0)} appointments · ${data.counts?.waitlist ?? 0} on waitlist` : ' '}</p>
        </div>
        <div className="row wrap">
          <div className="row" style={{ gap: 4 }}>
            <button className="icon-btn" aria-label="Previous" onClick={() => step(-1)}><ChevronLeft /></button>
            <button className="btn secondary sm" onClick={() => set({ date: '' })}>Today</button>
            <button className="icon-btn" aria-label="Next" onClick={() => step(1)}><ChevronRight /></button>
          </div>
          <input type="date" className="input" style={{ width: 'auto', minHeight: 40 }} value={date} onChange={(e) => e.target.value && set({ date: e.target.value })} aria-label="Pick a date" />
          <div className="segmented" role="tablist">
            <button className={view === 'day' ? 'on' : ''} onClick={() => set({ view: '' })}>Day</button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => set({ view: 'week' })}>Week</button>
          </div>
          <select className="select" style={{ width: 'auto', minHeight: 40 }} value={provider} onChange={(e) => set({ provider: e.target.value })} aria-label="Filter by provider">
            <option value="">All providers</option>
            {(meta.data?.providers ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <Load state={state} skeleton={<div className="skeleton" style={{ height: 520 }} />}>
        {(d) => (
          <div className="cal-layout">
            {d.view === 'week' ? <WeekGrid data={d} onPickDay={(day) => set({ date: day, view: '' })} /> : <DayGrid data={d} />}
            <aside className="stack">
              <section className="card tight" aria-label="Waitlist">
                <div className="row between" style={{ marginBottom: 12 }}>
                  <h2 style={{ margin: 0 }}>Waitlist · {d.waitlist?.length ?? 0} waiting</h2>
                  {d.autofill !== undefined && (
                    <button className="badge" onClick={toggleAutofill} title="When a slot opens, the first matching guest is offered it automatically" style={{ border: 0, cursor: 'pointer', opacity: d.autofill ? 1 : 0.6 }}>
                      <i className="dot" />Auto-fill {d.autofill ? 'on' : 'off'}
                    </button>
                  )}
                </div>
                <div className="stack sm">
                  {(d.waitlist ?? []).map((w) => {
                    const mins = minutesSince(w.created_at);
                    const slots = (w.slot_ids ?? []).map((id) => slotsById[id]).filter(Boolean);
                    return (
                      <div className="wl-item" key={w.id}>
                        <div className="row between"><b>{w.client_name}</b><span className="small faint row" style={{ gap: 4 }}><Clock size={13} />{mins}m</span></div>
                        <div className="muted small" style={{ marginTop: -6 }}>{w.service_name}{w.note ? ` · ${w.note}` : ''}</div>
                        {w.offer_id ? (
                          <div className="row wrap" style={{ gap: 6 }}>
                            <Badge tone="gold">Offer sent</Badge>
                            <button className="btn sm secondary" onClick={() => reply(w, true)}>They accepted</button>
                            <button className="btn sm secondary" onClick={() => reply(w, false)}>Declined</button>
                          </div>
                        ) : (
                          <Button variant="outline" size="sm" disabled={slots.length === 0}
                            title={slots.length === 0 ? 'No open slot fits this service yet' : ''}
                            onClick={() => (slots.length === 1 ? offer(w, slots[0].id) : setPicker({ w, slots }))}>
                            {slots.length === 0 ? 'No open slot fits' : 'Offer open slot'}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                  {(d.waitlist ?? []).length === 0 && <div className="small muted">Nobody waiting. Cancelled slots will show up here for offers.</div>}
                  <button className="dash-btn" onClick={() => setAdding(true)}><Plus size={16} /> Add to waitlist</button>
                </div>
              </section>

              {(d.requests ?? []).length > 0 && (
                <section className="card tight" aria-label="Online requests">
                  <h2>Online requests · {d.requests.length}</h2>
                  <div className="stack sm">
                    {d.requests.map((r) => (
                      <div className="wl-item" key={r.id}>
                        <div className="row between"><b>{r.client_name}</b><Badge tone="steel">{r.time_of_day}</Badge></div>
                        <div className="small muted" style={{ marginTop: -6 }}>{r.service_name} · wants {shortDate(r.preferred_date)}</div>
                        {r.notes && <div className="small">“{r.notes}”</div>}
                        <div className="row"><Link className="btn sm" to={`/reception/appointments/new?request=${r.id}`}><CalendarClock size={15} /> Schedule</Link>
                          <button className="btn sm secondary" onClick={async () => { if (await safe(() => api.post(`/booking-requests/${r.id}/decline`), 'Request declined')) state.reload(); }}>Decline</button></div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="card tight" aria-label="Legend">
                <h2>Legend</h2>
                <div className="legend">
                  <div><i style={{ background: 'var(--brand)' }} />Consultation</div>
                  <div><i style={{ background: 'var(--steel)' }} />Procedure room</div>
                  <div><i style={{ background: 'var(--gold)' }} />Styling room</div>
                  <div><i style={{ background: '#d9d5c9' }} />Blocked / open</div>
                  <div className="small faint"><Zap size={14} /> Click an empty time to book it</div>
                </div>
              </section>
            </aside>
          </div>
        )}
      </Load>
      {picker && <SlotPicker w={picker.w} slots={picker.slots} onPick={(id) => offer(picker.w, id)} onClose={() => setPicker(null)} />}
      {adding && <AddWaitlist onClose={() => setAdding(false)} onDone={state.reload} />}
    </>
  );
}
