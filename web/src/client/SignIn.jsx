import { useState } from 'react';
import { pub, tokens } from '../api.js';
import { Button } from '../ui.jsx';

/** Phone number → one-time code. In dev the code is echoed back so the flow can be tried without SMS. */
export default function SignIn({ onDone }) {
  const [phone, setPhone] = useState(() => { try { return sessionStorage.getItem('clinic.phone') ?? ''; } catch { return ''; } });
  const [step, setStep] = useState('phone');
  const [code, setCode] = useState('');
  const [dev, setDev] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function send(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await pub.post('/public/otp', { phone });
      setDev(r.dev_code ?? null);
      setStep('code');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  async function verify(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    try {
      const r = await pub.post('/public/login', { phone, code });
      tokens.set('client', r.token);
      onDone(r.client);
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }
  return step === 'phone' ? (
    <form onSubmit={send} noValidate>
      <h1>My appointments</h1>
      <p className="muted" style={{ margin: '6px 0 22px' }}>Enter the phone number you booked with and we’ll text you a code.</p>
      <div className="m-field"><label htmlFor="ph">Phone number</label><input id="ph" className="input" inputMode="tel" autoComplete="tel" placeholder="(555) 123-4567" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus /></div>
      {err && <div className="form-error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      <Button type="submit" className="lg" busy={busy}>Text me a code</Button>
    </form>
  ) : (
    <form onSubmit={verify} noValidate>
      <h1>Enter your code</h1>
      <p className="muted" style={{ margin: '6px 0 22px' }}>If {phone} matches a client, a 6-digit code is on its way.</p>
      <div className="m-field"><label htmlFor="cd">6-digit code</label><input id="cd" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus /></div>
      {dev && <div className="banner warn" style={{ marginBottom: 12 }}>Demo mode — your code is <b>{dev}</b></div>}
      {err && <div className="form-error" role="alert" style={{ marginBottom: 12 }}>{err}</div>}
      <Button type="submit" className="lg" busy={busy} disabled={code.length !== 6}>Continue</Button>
      <button type="button" className="btn ghost block" style={{ marginTop: 8 }} onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>Use a different number</button>
    </form>
  );
}
