import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, Check, Mic, MicOff, Play } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mdy, money, time12 } from '../format.js';
import { useLoad } from '../hooks.js';
import { Avatar, Badge, Button, Empty, ErrorBox, Load, Modal, Spinner, StatusBadge, useSafe, useToast } from '../ui.jsx';

function History({ clientId, onClose }) {
  const state = useLoad(() => api.get(`/clients/${clientId}`), [clientId]);
  return (
    <Modal title="Client history" onClose={onClose} footer={<button className="btn secondary" onClick={onClose}>Close</button>}>
      <Load state={state}>
        {({ client, visits }) => (
          <div className="stack sm">
            <div><b>{client.name}</b><div className="small muted">{client.phone} · {client.language} · {client.visits} visits</div></div>
            {visits.slice(0, 8).map((v) => (
              <div key={v.id} style={{ borderTop: '1px solid var(--line)', paddingTop: 8 }}>
                <b>{mdy(v.date)} · {v.service_name}{v.session_no ? ` · session ${v.session_no}/${v.sessions_total}` : ''}</b>
                <div className="small muted">{v.provider_short}{v.notes ? ` — ${v.notes}` : ''}</div>
              </div>
            ))}
          </div>
        )}
      </Load>
    </Modal>
  );
}

function useDictation(onText) {
  const rec = useRef(null);
  const [on, setOn] = useState(false);
  const toast = useToast();
  const Supported = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  useEffect(() => () => rec.current?.stop?.(), []);
  function toggle() {
    if (!Supported) { toast('Voice dictation isn’t supported in this browser — try Chrome or Safari.', 'error'); return; }
    if (on) { rec.current?.stop(); return; }
    const r = new Supported();
    r.lang = 'en-US'; r.continuous = true; r.interimResults = false;
    r.onresult = (e) => { for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) onText(e.results[i][0].transcript.trim()); };
    r.onend = () => setOn(false);
    r.onerror = (e) => { setOn(false); if (e.error === 'not-allowed') toast('Microphone access was blocked.', 'error'); };
    rec.current = r; r.start(); setOn(true);
  }
  return [on, toggle];
}

function Workspace({ d, reload }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const safe = useSafe();
  const a = d.appointment;
  const canEdit = user.role === 'provider' && a.status !== 'done' && a.provider_id === user.id;
  const saved = d.consultation?.recommended;
  const [notes, setNotes] = useState(d.consultation?.notes ?? '');
  const [picked, setPicked] = useState(() => new Set(saved?.service_ids ?? d.suggested_ids));
  const [products, setProducts] = useState(() => new Set(saved?.item_ids ?? []));
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [profile, setProfile] = useState(false);
  const [done, setDone] = useState(null);
  const timer = useRef(null);
  const first = useRef(true);

  const [recording, toggleRec] = useDictation((t) => setNotes((n) => (n ? `${n.replace(/\s+$/, '')} ${t}` : t)));

  // autosave notes
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!canEdit) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => api.put(`/staff/consultations/${a.id}`, { notes }).catch(() => {}), 900);
    return () => clearTimeout(timer.current);
  }, [notes, canEdit, a.id]);

  const optionsById = useMemo(() => Object.fromEntries(d.options.map((o) => [o.id, o])), [d.options]);
  const rows = [...new Set([...d.suggested_ids, ...(saved?.service_ids ?? []), ...picked])].filter((id) => optionsById[id]);
  const relevant = d.items.filter((i) => i.service_ids.some((s) => picked.has(s) || s === a.service_id));
  const toggle = (set, setter, id) => { const n = new Set(set); n.has(id) ? n.delete(id) : n.add(id); setter(n); };
  const estimate = a.service_price_cents + [...picked].reduce((s, id) => s + (optionsById[id]?.price_cents ?? 0), 0) + relevant.filter((i) => products.has(i.id)).reduce((s, i) => s + i.sell_price_cents, 0);

  async function start() {
    setBusy(true);
    const ok = await safe(() => api.post(`/staff/consultations/${a.id}/start`));
    setBusy(false);
    if (ok) reload();
  }
  async function finish() {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/staff/consultations/${a.id}/finish`, { notes, service_ids: [...picked], item_ids: relevant.filter((i) => products.has(i.id)).map((i) => i.id) });
      setDone(r);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (done || a.status === 'done') {
    const invId = done?.invoice_id ?? d.invoice?.id;
    return (
      <div className="card stack" style={{ maxWidth: 560, margin: '30px auto', textAlign: 'center' }}>
        <div className="big-check" style={{ width: 90, height: 90, margin: '0 auto' }}><Check size={42} /></div>
        <h1 style={{ fontSize: 26 }}>{done ? 'Quotation sent to the front desk' : 'Visit finished'}</h1>
        <p className="muted">{a.client_name}’s checkout already has the right services, prices and your name attached.{done && ` Estimated total ${money(done.total_cents)} after discounts and tax.`}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Button onClick={() => nav('/staff')}>Back to my day</Button>
          {invId && user.role === 'reception' && <Link className="btn secondary" to={`/reception/billing/${invId}`}>Open invoice <ArrowRight size={16} /></Link>}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card tight row between wrap" style={{ marginBottom: 16 }}>
        <div className="row"><Avatar name={a.client_name} size="lg" />
          <div><h2 style={{ fontSize: 22, margin: 0 }}>{a.client_name}</h2>
            <div className="muted">{a.service_name} · {a.checked_in_at ? `checked in ${time12(a.checked_in_at)}` : `booked ${time12(a.start_at)}`}</div></div></div>
        <div className="row wrap"><StatusBadge appt={a} /><button className="btn ghost" onClick={() => setProfile(true)}>View full profile <ArrowRight size={16} /></button></div>
      </div>
      {user.role === 'reception' && <div className="banner warn" style={{ marginBottom: 14 }}>You’re viewing this as front desk — only {a.provider_short} can edit the consultation.</div>}
      {canEdit && a.status !== 'with_provider' && (
        <div className="banner" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
          <span>{a.status === 'booked' ? 'This guest hasn’t checked in yet.' : 'Ready when you are.'}</span>
          <Button size="sm" icon={Play} busy={busy} onClick={start}>Start consultation</Button>
        </div>
      )}

      <div className="consult-grid">
        <div className="stack">
          {d.last_visit && (
            <section className="card soft">
              <div className="small bold muted">Last visit — {mdy(d.last_visit.start_at)}</div>
              <p style={{ marginTop: 6 }}>{d.last_visit.notes || `${d.last_visit.service_name}${d.last_visit.sessions_total ? `, session ${d.last_visit.session_no}/${d.last_visit.sessions_total}` : ''}. No notes recorded.`}</p>
            </section>
          )}
          <section className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>Today’s notes</h2>
              {canEdit && <button className={`btn secondary sm ${recording ? 'danger' : ''}`} style={recording ? { color: 'var(--red)', borderColor: 'var(--red)' } : undefined} onClick={toggleRec} aria-pressed={recording}>
                {recording ? <><MicOff size={15} /> Stop</> : <><Mic size={15} /> Record</>}</button>}
            </div>
            <textarea className="textarea" style={{ minHeight: 160 }} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit} aria-label="Consultation notes"
              placeholder="What did you see, do and recommend?" maxLength={5000} />
            {canEdit && <div className="xs faint" style={{ marginTop: 6 }}>Saved automatically</div>}
          </section>
          <section className="card stack">
            <h2 style={{ margin: 0 }}>Recommended service(s)</h2>
            <div className="small muted">Today’s visit — {a.service_name}: {money(a.service_price_cents)}</div>
            {rows.map((id) => {
              const o = optionsById[id];
              return (
                <label key={id} className={`opt ${picked.has(id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={picked.has(id)} disabled={!canEdit} onChange={() => toggle(picked, setPicked, id)} />
                  <span className="grow"><b>{o.name}{o.session_label ? ` — ${o.session_label}` : ''}</b></span><b>{money(o.price_cents)}</b>
                </label>
              );
            })}
            {canEdit && (
              <select className="select" aria-label="Add another service" value={extra} onChange={(e) => { const v = Number(e.target.value); if (v) setPicked(new Set([...picked, v])); setExtra(''); }}>
                <option value="">+ Add another service…</option>
                {d.options.filter((o) => !rows.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name} — {money(o.price_cents)}</option>)}
              </select>
            )}
            {relevant.map((i) => (
              <label key={i.id} className={`opt suggest ${products.has(i.id) ? 'on' : ''}`}>
                <input type="checkbox" checked={products.has(i.id)} disabled={!canEdit} onChange={() => toggle(products, setProducts, i.id)} />
                <span className="grow"><b>+ Suggest: {i.name}</b></span><b>{money(i.sell_price_cents)}</b>
              </label>
            ))}
          </section>
        </div>
        <aside className="stack" style={{ position: 'sticky', top: 90 }}>
          <section className="card">
            <h2>What happens next</h2>
            <p className="muted">Saving builds the quotation automatically — Checkout will already have the right service, the right price, and your name attached. Nothing to re-type at the front desk.</p>
            <div className="sumbox" style={{ marginTop: 14 }}><div><span>Estimated before discount &amp; tax</span><b>{money(estimate)}</b></div></div>
          </section>
          {err && <div className="form-error" role="alert">{err}</div>}
          <Button className="lg" busy={busy} disabled={!canEdit || notes.trim().length < 3} onClick={finish}>Save &amp; generate quotation</Button>
          {canEdit && notes.trim().length < 3 && <div className="xs faint">Add a few notes first.</div>}
        </aside>
      </div>
      {profile && <History clientId={a.client_id} onClose={() => setProfile(false)} />}
    </>
  );
}

export default function Consultation() {
  const { apptId } = useParams();
  const nav = useNavigate();
  const [none, setNone] = useState(false);
  useEffect(() => {
    if (apptId) return;
    api.get('/staff/consultations/next').then((r) => (r.appointment_id ? nav(`/staff/consultation/${r.appointment_id}`, { replace: true }) : setNone(true))).catch(() => setNone(true));
  }, [apptId, nav]);
  const state = useLoad(() => (apptId ? api.get(`/staff/consultations/${apptId}`) : Promise.resolve(null)), [apptId], { live: true });
  if (!apptId) {
    return none ? <Empty title="Nobody is waiting right now">When a guest checks in, they’ll appear here.<div style={{ marginTop: 12 }}><Link className="btn secondary" to="/staff">Back to my day</Link></div></Empty> : <Spinner />;
  }
  if (state.error && !state.data) return <ErrorBox error={state.error} retry={state.reload} />;
  if (!state.data) return <Spinner />;
  return <Workspace key={`${apptId}:${state.data.appointment.status === 'done'}`} d={state.data} reload={state.reload} />;
}
