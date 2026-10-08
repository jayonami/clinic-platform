import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { addDays, fullShortDate, hhmmTo12, money, shortDate, today } from '../format.js';
import { useLoad } from '../hooks.js';
import { Badge, Button, Field, Load, useSafe } from '../ui.jsx';
import ClientPicker from './ClientPicker.jsx';

const inWindow = (t, w) => (w === 'morning' ? t < '12:00' : w === 'afternoon' ? t >= '13:00' && t < '16:00' : t >= '16:00');

export default function NewAppointment() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const safe = useSafe();
  const meta = useLoad(() => api.get('/meta'), []);
  const services = useLoad(() => api.get('/services'), []);
  const requests = useLoad(() => (sp.get('request') ? api.get('/booking-requests') : Promise.resolve([])), []);

  const [client, setClient] = useState(null);
  const [serviceId, setServiceId] = useState(null);
  const [providerId, setProviderId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [date, setDate] = useState(sp.get('date') || addDays(today(), 1));
  const [time, setTime] = useState(sp.get('time') || '');
  const [notes, setNotes] = useState('');
  const [slots, setSlots] = useState([]);
  const [slotsErr, setSlotsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useMemo(() => (requests.data ?? []).find((r) => String(r.id) === sp.get('request')) ?? null, [requests.data, sp]);

  const svcList = services.data ?? [];
  const svc = svcList.find((s) => s.id === serviceId);
  const providers = (meta.data?.providers ?? []).filter((p) => !svc || svc.provider_ids.includes(p.id));
  const rooms = (meta.data?.resources ?? []).filter((r) => !svc || r.kind === svc.kind);

  // prefill: ?client=, ?service=, request
  useEffect(() => {
    if (sp.get('client') && !client) api.get(`/clients/${sp.get('client')}`).then((r) => setClient({ ...r.client, visits: r.client.visits })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!request) return;
    setClient({ id: request.client_id, name: request.client_name, phone: request.client_phone });
    setServiceId(request.service_id);
    setDate(request.preferred_date);
    setNotes(request.notes ?? '');
  }, [request]);
  useEffect(() => {
    if (serviceId || !svcList.length) return;
    const wantedRes = (meta.data?.resources ?? []).find((r) => String(r.id) === sp.get('resource'));
    const wantSvc = Number(sp.get('service'));
    const pick = svcList.find((s) => s.id === wantSvc) ?? (wantedRes ? svcList.find((s) => s.kind === wantedRes.kind) : svcList[0]);
    if (pick && meta.data) setServiceId(pick.id);
  }, [svcList, meta.data, serviceId, sp]);
  // keep provider + room valid for the chosen service
  useEffect(() => {
    if (!svc || !meta.data) return;
    if (!svc.provider_ids.includes(Number(providerId))) setProviderId(svc.provider_ids[0] ?? '');
    const want = Number(sp.get('resource'));
    setResourceId((cur) => {
      const ok = rooms.find((r) => r.id === Number(cur));
      return ok ? cur : (rooms.find((r) => r.id === want) ?? rooms[0])?.id ?? '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svc?.id, meta.data]);

  useEffect(() => {
    if (!svc || !providerId || !resourceId || !date) return;
    let live = true;
    setSlotsErr('');
    api.get(`/availability?date=${date}&service_id=${svc.id}&provider_id=${providerId}&resource_id=${resourceId}`)
      .then((r) => { if (live) { setSlots(r); setTime((t) => (r.find((s) => s.time === t && s.available) ? t : '')); } })
      .catch((e) => live && setSlotsErr(e.message));
    return () => { live = false; };
  }, [svc, providerId, resourceId, date]);

  const provider = providers.find((p) => p.id === Number(providerId));
  const room = rooms.find((r) => r.id === Number(resourceId));
  const ready = client && svc && provider && room && date && time;
  const shown = slots.filter((s) => s.reason !== 'lunch' && s.reason !== 'past');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await api.post('/appointments', {
        client_id: client.id, service_id: svc.id, provider_id: provider.id, resource_id: room.id, date, time, notes, request_id: request?.id,
      });
      nav(`/reception/calendar?date=${date}`);
      safe(async () => {}, `Booked ${client.name} · ${shortDate(date)} ${hhmmTo12(time)}`);
    } catch (e) {
      setError(e.message);
    } finally { setBusy(false); }
  }
  async function toWaitlist() {
    if (!client || !svc) { setError('Pick a client and service first.'); return; }
    const ok = await safe(() => api.post('/waitlist', { client_id: client.id, service_id: svc.id, note: notes }), `${client.name} added to the waitlist`);
    if (ok) nav('/reception/calendar');
  }

  return (
    <>
      <Link to="/reception/calendar" className="back-link"><ArrowLeft size={16} /> Back to calendar</Link>
      <div className="page-head"><h1>New Appointment</h1></div>
      {request && (
        <div className="banner" style={{ marginBottom: 16 }}>
          Online request from {request.client_name}: {request.service_name}, prefers {request.time_of_day} on {fullShortDate(request.preferred_date)}. Pick a slot to confirm — they’ll get a text.
        </div>
      )}
      <Load state={{ ...meta, loading: meta.loading || services.loading }} >
        {() => (
          <div className="cal-layout" style={{ gridTemplateColumns: 'minmax(0,1fr) 380px' }}>
            <div className="stack">
              <section className="card"><div className="eyebrow" style={{ marginBottom: 12 }}>1. Client</div><ClientPicker value={client} onChange={setClient} /></section>

              <section className="card">
                <div className="eyebrow" style={{ marginBottom: 12 }}>2. Service</div>
                <div className="stack sm" role="radiogroup" aria-label="Service">
                  {svcList.map((s) => (
                    <label key={s.id} className={`opt ${s.id === serviceId ? 'on' : ''}`}>
                      <input type="radio" name="svc" checked={s.id === serviceId} onChange={() => setServiceId(s.id)} />
                      <span className="grow"><b>{s.name}</b><br /><span className="small muted">{s.duration_min} min{s.sessions_total ? ` · ${s.sessions_total}-session package` : ''}</span></span>
                      <b>{money(s.price_cents)}</b>
                    </label>
                  ))}
                </div>
              </section>

              <section className="card">
                <div className="eyebrow" style={{ marginBottom: 12 }}>3. Provider &amp; room</div>
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="grow"><Field label="Provider">
                    <select className="select" value={providerId} onChange={(e) => setProviderId(Number(e.target.value))}>
                      {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select></Field></div>
                  <div className="grow"><Field label="Room">
                    <select className="select" value={resourceId} onChange={(e) => setResourceId(Number(e.target.value))}>
                      {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select></Field></div>
                </div>
              </section>

              <section className="card">
                <div className="eyebrow" style={{ marginBottom: 12 }}>4. Date &amp; time</div>
                <div className="stack">
                  <input type="date" className="input" min={today()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
                  {slotsErr && <div className="form-error">{slotsErr}</div>}
                  <div className="chips" role="radiogroup" aria-label="Time">
                    {shown.map((s) => {
                      const hint = request && s.available && inWindow(s.time, request.time_of_day);
                      return (
                        <button key={s.time} type="button" role="radio" aria-checked={time === s.time} disabled={!s.available}
                          className={`chip square ${time === s.time ? 'on' : ''}`} onClick={() => setTime(s.time)}
                          style={hint && time !== s.time ? { borderColor: 'var(--brand)' } : undefined}>
                          {hhmmTo12(s.time)}{!s.available && ' · Full'}
                        </button>
                      );
                    })}
                    {shown.length === 0 && !slotsErr && <span className="muted small">No times left on this day.</span>}
                  </div>
                  <div className="small muted">Nothing open that works? <button type="button" className="btn ghost sm" style={{ padding: '2px 6px' }} onClick={toWaitlist}>Add to the waitlist instead →</button></div>
                </div>
              </section>

              <section className="card">
                <div className="eyebrow" style={{ marginBottom: 12 }}>Notes (optional)</div>
                <textarea className="textarea" placeholder="Anything the front desk should know?" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} aria-label="Notes" />
              </section>
            </div>

            <aside style={{ position: 'sticky', top: 90 }} className="card stack">
              <h2 style={{ margin: 0 }}>Summary</h2>
              <div className="stack sm small">
                {[['Client', client?.name], ['Service', svc?.name], ['Provider', provider && room ? `${provider.short_name} · ${room.name}` : null],
                  ['When', time ? `${shortDate(date)} · ${hhmmTo12(time)}` : null]].map(([k, v]) => (
                  <div key={k} className="row between" style={{ fontSize: 15 }}><span className="muted">{k}</span><b>{v ?? <span className="faint">—</span>}</b></div>
                ))}
              </div>
              <div className="row between" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}><b style={{ fontSize: 18 }}>Price</b><b style={{ fontSize: 20 }}>{svc ? money(svc.price_cents) : '—'}</b></div>
              {svc?.sessions_total && <Badge tone="steel">Part of a {svc.sessions_total}-session package</Badge>}
              {error && <div className="form-error" role="alert">{error}</div>}
              <Button className="lg" busy={busy} disabled={!ready} onClick={confirm}>Confirm booking</Button>
              {!ready && <div className="xs faint">Choose a client, service and time to continue. The client gets a confirmation text.</div>}
            </aside>
          </div>
        )}
      </Load>
    </>
  );
}
