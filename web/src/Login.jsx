import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { Button, Field } from './ui.jsx';

const DEMO = [
  { label: 'Reception — Rhea N.', email: 'rhea@clinic.test', app: 'reception' },
  { label: 'Dr. Carter (consults)', email: 'carter@clinic.test', app: 'staff' },
  { label: 'Jessica K. (procedures)', email: 'jessica@clinic.test', app: 'staff' },
  { label: 'Maya T. (styling)', email: 'maya@clinic.test', app: 'staff' },
];

export default function Login() {
  const { login, config } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const app = sp.get('app') === 'staff' ? 'staff' : 'reception';
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const u = await login(email.trim(), pin);
      const next = sp.get('next');
      nav(next && next.startsWith('/') ? next : u.role === 'reception' ? '/reception/calendar' : '/staff', { replace: true });
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-page">
      <form className="card login-card stack" onSubmit={submit}>
        <div className="brand"><span className="dot" />{config.brand_name}</div>
        <div>
          <h1>{app === 'staff' ? 'Staff sign-in' : 'Reception sign-in'}</h1>
          <p className="muted" style={{ marginTop: 6 }}>{config.clinic_name}</p>
        </div>
        <Field label="Work email" htmlFor="email"><input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="PIN" htmlFor="pin" error={err}><input id="pin" className={`input ${err ? 'error' : ''}`} type="password" inputMode="numeric" autoComplete="current-password" value={pin} onChange={(e) => setPin(e.target.value)} required /></Field>
        <Button busy={busy} type="submit">Sign in</Button>
        {config.dev && (
          <div className="stack sm">
            <span className="eyebrow">Demo accounts · PIN 1234</span>
            <div className="chips">
              {DEMO.filter((d) => d.app === app).map((d) => (
                <button key={d.email} type="button" className="chip square" onClick={() => { setEmail(d.email); setPin('1234'); }}>{d.label}</button>
              ))}
            </div>
          </div>
        )}
        <Link to="/" className="small">← All apps</Link>
      </form>
    </div>
  );
}
