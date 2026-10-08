import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { pub } from '../api.js';
import { useAuth } from '../auth.jsx';
import { addDays, today } from '../format.js';
import { useLoad } from '../hooks.js';
import { Button } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';

const WINDOWS = [['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']];

export default function Book() {
  const { config } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const services = useLoad(() => pub.get('/public/services'), []);
  const [f, setF] = useState({ name: '', phone: '', service_id: '', date: addDays(today(), 7), time_of_day: 'afternoon', notes: '' });
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState('');
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setErrs({ ...errs, [k]: '' }); };

  useEffect(() => {
    const list = services.data;
    if (!list || f.service_id) return;
    const want = Number(sp.get('service'));
    setF((cur) => ({ ...cur, service_id: String((list.find((s) => s.id === want) ?? list.find((s) => s.sessions_total) ?? list[0])?.id ?? '') }));
  }, [services.data, sp, f.service_id]);

  async function submit(e) {
    e.preventDefault();
    const er = {};
    if (f.name.trim().length < 2) er.name = 'Please enter your full name';
    if (f.phone.replace(/\D/g, '').length < 10) er.phone = 'Enter a 10-digit phone number';
    if (!f.date || f.date < today()) er.date = 'Pick a date from today onwards';
    setErrs(er);
    if (Object.keys(er).length) return;
    setBusy(true); setFormErr('');
    try {
      const r = await pub.post('/public/booking-requests', { ...f, service_id: Number(f.service_id) });
      try { sessionStorage.setItem('clinic.phone', f.phone); } catch { /* private mode */ }
      nav('/book/sent', { state: r, replace: true });
    } catch (ex) { setFormErr(ex.message); } finally { setBusy(false); }
  }

  const Err = ({ k }) => (errs[k] ? <span className="form-error" role="alert">{errs[k]}</span> : null);
  return (
    <form onSubmit={submit} noValidate style={{ display: 'contents' }}>
      <Frame back="/" brand footer={<Button type="submit" className="lg" busy={busy}>Request appointment</Button>}>
        <h1>Book an appointment</h1>
        <p className="muted" style={{ margin: '6px 0 24px', fontSize: 16.5 }}>{config.clinic_name} · usually confirmed within the hour</p>
        <div className="m-field"><label htmlFor="n">Your name</label><input id="n" className={`input ${errs.name ? 'error' : ''}`} placeholder="Full name" autoComplete="name" value={f.name} onChange={set('name')} /><Err k="name" /></div>
        <div className="m-field"><label htmlFor="p">Phone number</label><input id="p" className={`input ${errs.phone ? 'error' : ''}`} placeholder="(555) 123-4567" inputMode="tel" autoComplete="tel" value={f.phone} onChange={set('phone')} /><Err k="phone" /></div>
        <div className="m-field"><label htmlFor="s">Service needed</label>
          <select id="s" className="select" value={f.service_id} onChange={set('service_id')}>
            {(services.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div className="m-field"><label htmlFor="d">Preferred date</label><input id="d" type="date" className={`input ${errs.date ? 'error' : ''}`} min={today()} value={f.date} onChange={set('date')} /><Err k="date" /></div>
        <div className="m-field"><label id="t">Preferred time</label>
          <div className="chips" role="radiogroup" aria-labelledby="t" style={{ flexWrap: 'nowrap' }}>
            {WINDOWS.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.time_of_day === k} className={`chip ${f.time_of_day === k ? 'on' : ''}`} onClick={() => setF({ ...f, time_of_day: k })}>{l}</button>)}
          </div></div>
        <div className="m-field"><label htmlFor="o">Anything we should know? (optional)</label><textarea id="o" className="textarea" maxLength={500} value={f.notes} onChange={set('notes')} placeholder="e.g. a preference for a provider, accessibility needs" /></div>
        {formErr && <div className="banner bad" role="alert">{formErr}</div>}
      </Frame>
    </form>
  );
}
