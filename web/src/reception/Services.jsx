import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api } from '../api.js';
import { money } from '../format.js';
import { useLoad } from '../hooks.js';
import { Badge, Button, Load } from '../ui.jsx';

export default function Services() {
  const state = useLoad(() => api.get('/services?all=1'), [], { live: true });
  const nav = useNavigate();
  return (
    <>
      <div className="page-head"><div><h1>Services</h1><p>Prices, durations and what each service costs to deliver.</p></div>
        <Button icon={Plus} onClick={() => nav('/reception/services/new')}>New service</Button></div>
      <Load state={state}>
        {(rows) => (
          <section className="card table-scroll" style={{ padding: 8 }}>
            <table className="table">
              <thead><tr><th>Service</th><th>Category</th><th className="num">Duration</th><th className="num">Price</th><th className="num">Margin</th><th>Where</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="click" tabIndex={0} style={{ opacity: s.active ? 1 : 0.5 }} onClick={() => nav(`/reception/services/${s.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/reception/services/${s.id}`)}>
                    <td><b>{s.name}</b>{s.sessions_total && <span className="small muted"> · {s.sessions_total}-session package</span>}{!s.active && <> <Badge tone="gray">Inactive</Badge></>}</td>
                    <td className="muted">{s.category}</td><td className="num">{s.duration_min} min</td><td className="num">{money(s.price_cents)}</td>
                    <td className="num">{s.price_cents ? `${s.margin_pct.toFixed(1)}%` : '—'}</td>
                    <td><Badge tone={s.kind === 'consult' ? '' : s.kind === 'procedure' ? 'steel' : 'gold'}>{s.kind === 'consult' ? 'Consult' : s.kind === 'procedure' ? 'Procedure' : 'Styling'}</Badge>{s.online_bookable ? <> <Badge tone="gray">Online</Badge></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </Load>
    </>
  );
}
