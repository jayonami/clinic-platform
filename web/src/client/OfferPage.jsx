import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { pub } from '../api.js';
import { shortDate, time12 } from '../format.js';
import { useLoad } from '../hooks.js';
import { Button, ErrorBox, Spinner } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';

export default function OfferPage() {
  const { token } = useParams();
  const nav = useNavigate();
  const state = useLoad(() => pub.get(`/public/offers/${token}`), [token]);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (state.error) return <Frame brand><ErrorBox error={state.error} /></Frame>;
  if (!state.data) return <Frame brand><Spinner /></Frame>;
  const o = state.data;

  async function respond(accept) {
    setBusy(accept ? 'yes' : 'no'); setErr('');
    try { const r = await pub.post(`/public/offers/${token}/respond`, { accept }); setRes(r.status); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const settled = res ?? (o.status !== 'pending' ? o.status : null);
  if (settled) {
    return (
      <Frame brand footer={<Button className="lg" onClick={() => nav('/my')}>My appointments</Button>}>
        <div className="big-check"><Check size={58} strokeWidth={2.5} /></div>
        <h1 style={{ textAlign: 'center' }}>{settled === 'accepted' ? 'You’re booked!' : settled === 'declined' ? 'No problem' : 'This spot is gone'}</h1>
        <p className="muted" style={{ textAlign: 'center', marginTop: 10, fontSize: 17 }}>
          {settled === 'accepted' ? `We’ll see you on ${shortDate(o.start_at)} at ${time12(o.start_at)}.` : settled === 'declined' ? 'We’ve kept your place on the waitlist.' : 'Someone else took it or the offer timed out. You’re still on the waitlist.'}
        </p>
      </Frame>
    );
  }
  return (
    <Frame brand footer={<>
      <Button className="lg" busy={busy === 'yes'} disabled={!!busy} onClick={() => respond(true)}>Yes, book it</Button>
      <Button variant="secondary" className="lg" busy={busy === 'no'} disabled={!!busy} onClick={() => respond(false)}>No thanks</Button>
    </>}>
      <h1>A spot opened up, {o.first_name}</h1>
      <p className="muted" style={{ margin: '8px 0 22px', fontSize: 17 }}>You’re on the waitlist at {o.clinic}. Want this one?</p>
      <div className="m-card"><b style={{ fontSize: 19 }}>{o.service}</b><div className="muted" style={{ marginTop: 6 }}>{shortDate(o.start_at)} · {time12(o.start_at)}</div></div>
      {err && <div className="banner bad" role="alert" style={{ marginTop: 14 }}>{err} <Link to="/book">Request another time</Link></div>}
    </Frame>
  );
}
