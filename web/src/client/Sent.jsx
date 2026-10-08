import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Check } from 'lucide-react';
import { fullShortDate, windowLabel } from '../format.js';
import { Button } from '../ui.jsx';
import { Frame } from './ClientApp.jsx';

export default function Sent() {
  const { state: r } = useLocation();
  const nav = useNavigate();
  if (!r) return <Navigate to="/book" replace />;
  const Row = ({ k, v }) => <div className="row between" style={{ padding: '7px 0' }}><span className="muted">{k}</span><b style={{ textAlign: 'right' }}>{v}</b></div>;
  return (
    <Frame brand footer={<>
      <Button className="lg" onClick={() => nav('/my')}>View my appointments</Button>
      <button className="btn ghost" style={{ color: 'var(--ink-2)' }} onClick={() => nav('/book')}><ArrowLeft size={16} /> Book another</button>
    </>}>
      <div className="big-check"><Check size={58} strokeWidth={2.5} /></div>
      <h1 style={{ textAlign: 'center' }}>Request sent!</h1>
      <p className="muted" style={{ textAlign: 'center', margin: '10px 0 26px', fontSize: 17 }}>We’ll confirm your slot shortly — most requests are confirmed within the hour over SMS.</p>
      <div className="m-card">
        <Row k="Service" v={r.service} /><Row k="Date" v={fullShortDate(r.date)} />
        <Row k="Time" v={`${r.time_of_day[0].toUpperCase()}${r.time_of_day.slice(1)} · ${windowLabel(r.window)}`} /><Row k="Clinic" v={r.clinic} />
        {r.notes && <p className="muted" style={{ borderTop: '1px solid var(--line)', marginTop: 8, paddingTop: 12 }}>“{r.notes}”</p>}
      </div>
    </Frame>
  );
}
