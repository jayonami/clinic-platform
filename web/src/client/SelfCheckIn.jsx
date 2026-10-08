import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check } from 'lucide-react';
import { pub } from '../api.js';
import { Button } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';

export default function SelfCheckIn() {
  const [phone, setPhone] = useState('');
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try { setRes(await pub.post('/public/checkin', { phone })); } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  if (res) {
    return (
      <Frame brand>
        <div className="big-check"><Check size={58} strokeWidth={2.5} /></div>
        <h1 style={{ textAlign: 'center' }}>You’re checked in, {res.first_name}</h1>
        <p className="muted" style={{ textAlign: 'center', margin: '10px 0 0', fontSize: 17 }}>{res.service} · {res.time}. Please take a seat — we’ll call you shortly.</p>
      </Frame>
    );
  }
  return (
    <form onSubmit={go} noValidate style={{ display: 'contents' }}>
      <Frame brand footer={<Button type="submit" className="lg" busy={busy}>Check in</Button>}>
        <h1>Check in</h1>
        <p className="muted" style={{ margin: '6px 0 24px', fontSize: 16.5 }}>Enter the phone number you booked with.</p>
        <div className="m-field"><label htmlFor="ci">Phone number</label><input id="ci" className="input" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></div>
        {err && <div className="banner bad" role="alert">{err}</div>}
        <p className="small muted" style={{ marginTop: 18 }}>Not booked yet? <Link to="/book">Request an appointment</Link> or see the front desk.</p>
      </Frame>
    </form>
  );
}
