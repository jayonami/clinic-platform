import { api } from '../api.js';
import { md, money, time12 } from '../format.js';
import { useLoad } from '../hooks.js';
import { Badge, Empty, Load } from '../ui.jsx';

const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);
const delta = (v, unit, good, ref) => {
  if (v == null) return { text: 'no comparison yet', cls: 'flat' };
  const r = Math.round(v);
  if (r === 0) return { text: `no change ${ref}`, cls: 'flat' };
  const up = r > 0;
  return { text: `${up ? '+' : '−'}${Math.abs(r)}${unit} ${ref}`, cls: (up ? good === 'up' : good === 'down') ? '' : 'bad' };
};

function Kpi({ label, value, sub, cls = '' }) {
  return <div className="kpi"><div className="k">{label}</div><div className="v">{value}</div><div className={`d ${cls}`}>{sub}</div></div>;
}

function Bars({ data }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  const colors = ['var(--brand)', 'var(--steel)', 'var(--gold)'];
  const names = { call_centre: 'Call centre', walk_in: 'Walk-in', online: 'Online' };
  const H = 200;
  return (
    <svg viewBox="0 0 420 270" role="img" aria-label={`Bookings by channel: ${data.map((d) => `${names[d.key]} ${d.count}`).join(', ')}`} style={{ width: '100%', maxWidth: 520 }}>
      {data.map((d, i) => {
        const h = (d.count / max) * H;
        const x = 40 + i * 120;
        return (
          <g key={d.key}>
            <rect x={x} y={20 + H - h} width="64" height={h} rx="5" fill={colors[i]} />
            <text x={x + 32} y={14 + H - h} textAnchor="middle" fontWeight="800" fontSize="15" fill="var(--ink)">{d.count}</text>
            <text x={x + 32} y={H + 48} textAnchor="middle" fontSize="14" fill="var(--ink-2)">{names[d.key]}</text>
          </g>
        );
      })}
      <line x1="20" x2="400" y1={20 + H} y2={20 + H} stroke="var(--line-strong)" />
    </svg>
  );
}

function Trend({ points }) {
  const vals = points.map((p) => p.rate ?? 0);
  const max = Math.max(10, Math.ceil(Math.max(...vals) / 5) * 5);
  const W = 560; const H = 170; const L = 34; const T = 12; const R = 26;
  const x = (i) => L + (i * (W - L - R)) / (points.length - 1);
  const y = (v) => T + H - (v / max) * H;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.rate ?? 0)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H + 50}`} role="img" aria-label={`No-show rate by week: ${points.map((p) => pct(p.rate)).join(', ')}`} style={{ width: '100%' }}>
      {[0, 0.5, 1].map((t) => (
        <g key={t}><line x1={L} x2={W - 8} y1={y(max * t)} y2={y(max * t)} stroke="var(--line)" /><text x={L - 8} y={y(max * t) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{Math.round(max * t)}%</text></g>
      ))}
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <g key={p.from}>
          <circle cx={x(i)} cy={y(p.rate ?? 0)} r={i === 0 || i === points.length - 1 ? 5 : 3.5} fill="var(--brand)"><title>{`${md(p.from)}–${md(p.to)}: ${pct(p.rate)} (${p.no_shows} of ${p.total})`}</title></circle>
          <text x={x(i)} y={H + T + 22} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{md(p.from).replace(' ', ' ')}</text>
        </g>
      ))}
    </svg>
  );
}

const TYPE = { no_show: ['No-show', 'red'], reschedule: ['Reschedule', 'gold'], cancel: ['Cancelled', 'gray'], waitlist_fill: ['Waitlist fill', ''] };

export default function Analytics() {
  const state = useLoad(() => api.get('/analytics'), [], { live: true });
  return (
    <>
      <Load state={state}>
        {(d) => {
          const first = d.trend[0]?.rate; const last = d.trend[d.trend.length - 1]?.rate;
          const conv = delta(d.conversion.delta, 'pt', 'up', 'vs prior 4 wks');
          const wait = delta(d.wait.delta, ' min', 'down', 'vs last week');
          const fill = delta(d.waitlist_fill.delta, 'pt', 'up', 'vs last month');
          return (
            <>
              <div className="page-head"><div><h1>Analytics</h1><p>Today, {md(d.date)} — {d.clinic_name}</p></div></div>
              <div className="kpis">
                <Kpi label="Bookings today" value={d.bookings.total} sub={`${d.bookings.no_shows} no-show${d.bookings.no_shows === 1 ? '' : 's'} · ${pct(d.bookings.no_show_pct)}`} cls={d.bookings.no_shows ? 'bad' : 'flat'} />
                <Kpi label="Consult → treatment" value={pct(d.conversion.rate)} sub={conv.text} cls={conv.cls} />
                <Kpi label="Avg wait at check-in" value={d.wait.minutes == null ? '—' : `${Math.round(d.wait.minutes)} min`} sub={wait.text} cls={wait.cls} />
                <Kpi label="Outstanding collections" value={money(d.outstanding.cents)} sub={`across ${d.outstanding.invoices} invoices`} cls="flat" />
                <Kpi label="Waitlist fill rate" value={pct(d.waitlist_fill.rate)} sub={fill.text} cls={fill.cls} />
                <Kpi label="Reschedules logged" value={d.reschedules.total} sub={`${d.reschedules.untracked} untracked`} cls={d.reschedules.untracked ? 'bad' : 'flat'} />
              </div>
              <div className="two-col" style={{ marginBottom: 20 }}>
                <section className="card"><h2>Bookings by channel</h2><Bars data={d.channels} /></section>
                <section className="card"><h2>No-show rate — last 8 weeks</h2><div className="muted small" style={{ marginBottom: 6 }}>{pct(first)} → {pct(last)}</div><Trend points={d.trend} /></section>
              </div>
              <section className="card table-scroll">
                <h2>Today’s exceptions</h2>
                {d.exceptions.length === 0 ? <Empty title="No exceptions today">Everything is running to plan.</Empty> : (
                  <table className="table">
                    <thead><tr><th>Time</th><th>Guest</th><th>Type</th><th>Detail</th></tr></thead>
                    <tbody>
                      {d.exceptions.map((e) => (
                        <tr key={e.id}><td>{time12(e.created_at).replace(/ (AM|PM)/, ' $1')}</td><td>{e.client_name ?? '—'}</td>
                          <td><Badge tone={TYPE[e.type]?.[1]}>{TYPE[e.type]?.[0] ?? e.type}</Badge></td><td className="muted">{e.detail}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          );
        }}
      </Load>
    </>
  );
}
