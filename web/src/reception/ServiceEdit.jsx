import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { centsToInput, dollarsToCents, money } from '../format.js';
import { useLoad } from '../hooks.js';
import { Button, Field, Load, Modal, useSafe } from '../ui.jsx';

const BLANK = { name: '', category: 'General', description: '', duration_min: 60, price: '', kind: 'procedure', sessions_total: '', provider_pct: 15, assistant_pct: 0, online_bookable: true, active: true, provider_ids: [], items: [] };

function NewItem({ onClose, onCreated }) {
  const [f, setF] = useState({ name: '', cost: '', sell: '' });
  const [err, setErr] = useState('');
  async function save() {
    try {
      const it = await api.post('/items', { name: f.name, unit_cost_cents: dollarsToCents(f.cost), sell_price_cents: f.sell ? dollarsToCents(f.sell) : null });
      onCreated(it); onClose();
    } catch (e) { setErr(e.message); }
  }
  return (
    <Modal title="New item" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Add item</Button></>}>
      <div className="stack">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Unit cost ($)"><input className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        <Field label="Retail price ($)" hint="Leave blank if it isn’t sold to clients — retail items are suggested during consultations."><input className="input" inputMode="decimal" value={f.sell} onChange={(e) => setF({ ...f, sell: e.target.value })} /></Field>
        {err && <div className="form-error">{err}</div>}
      </div>
    </Modal>
  );
}

export default function ServiceEdit() {
  const { id } = useParams();
  const isNew = id === 'new';
  const nav = useNavigate();
  const safe = useSafe();
  const meta = useLoad(() => api.get('/meta'), []);
  const items = useLoad(() => api.get('/items'), []);
  const loaded = useLoad(() => (isNew ? Promise.resolve(null) : api.get(`/services/${id}`)), [id]);
  const [f, setF] = useState(BLANK);
  const [cats, setCats] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [newItem, setNewItem] = useState(false);

  useEffect(() => {
    const s = loaded.data;
    if (!s) return;
    setCats(s.categories);
    setF({
      name: s.name, category: s.category, description: s.description, duration_min: s.duration_min, price: centsToInput(s.price_cents), kind: s.kind,
      sessions_total: s.sessions_total ?? '', provider_pct: s.provider_pct, assistant_pct: s.assistant_pct, online_bookable: !!s.online_bookable, active: !!s.active,
      provider_ids: s.provider_ids, items: s.items.map((i) => ({ item_id: i.item_id, qty: i.qty, unit_cost: centsToInput(i.unit_cost_cents) })),
    });
  }, [loaded.data]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setItem = (i, patch) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const price = dollarsToCents(f.price);
  const cost = useMemo(() => f.items.reduce((s, i) => s + Math.round((Number(i.qty) || 0) * dollarsToCents(i.unit_cost)), 0), [f.items]);
  const margin = price - cost;

  async function save() {
    setBusy(true); setErr('');
    const body = {
      ...f, price_cents: price, duration_min: Number(f.duration_min), sessions_total: f.sessions_total ? Number(f.sessions_total) : null,
      items: f.items.filter((i) => i.item_id).map((i) => ({ item_id: Number(i.item_id), qty: Number(i.qty), unit_cost_cents: dollarsToCents(i.unit_cost) })),
    };
    try {
      if (isNew) await api.post('/services', body); else await api.put(`/services/${id}`, body);
      safe(async () => {}, 'Service saved');
      nav('/reception/services');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const itemList = items.data ?? [];

  return (
    <>
      <Link to="/reception/services" className="back-link"><ArrowLeft size={16} /> All services</Link>
      <Load state={{ ...loaded, loading: loaded.loading || meta.loading, data: meta.data }}>
        {() => (
          <>
            <div className="page-head"><h1>{isNew ? 'New service' : f.name || 'Service'}</h1><Button busy={busy} onClick={save}>Save service</Button></div>
            {err && <div className="banner bad" role="alert" style={{ marginBottom: 14 }}>{err}</div>}
            <div className="two-col" style={{ alignItems: 'start' }}>
              <section className="card stack">
                <h2 style={{ margin: 0 }}>Service details</h2>
                <Field label="Service name" htmlFor="sname"><input id="sname" className="input" value={f.name} onChange={set('name')} /></Field>
                <Field label="Category"><input className="input" list="cats" value={f.category} onChange={set('category')} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
                <Field label="Description"><textarea className="textarea" value={f.description} onChange={set('description')} /></Field>
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="grow"><Field label="Duration (min)"><input className="input" inputMode="numeric" value={f.duration_min} onChange={set('duration_min')} /></Field></div>
                  <div className="grow"><Field label="Sale price / session ($)"><input className="input" inputMode="decimal" value={f.price} onChange={set('price')} /></Field></div>
                </div>
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="grow"><Field label="Column type"><select className="select" value={f.kind} onChange={set('kind')}>
                    <option value="consult">Consultation</option><option value="procedure">Procedure</option><option value="styling">Styling</option></select></Field></div>
                  <div className="grow"><Field label="Sessions in package" hint="Blank for a one-off service"><input className="input" inputMode="numeric" value={f.sessions_total} onChange={set('sessions_total')} /></Field></div>
                </div>
                <div className="row wrap" style={{ alignItems: 'flex-start' }}>
                  <div className="grow"><Field label="Provider commission %"><input className="input" inputMode="decimal" value={f.provider_pct} onChange={set('provider_pct')} /></Field></div>
                  <div className="grow"><Field label="Recommending doctor %"><input className="input" inputMode="decimal" value={f.assistant_pct} onChange={set('assistant_pct')} /></Field></div>
                </div>
                <Field label="Who can perform it">
                  <div className="chips">{(meta.data?.providers ?? []).map((p) => (
                    <button key={p.id} type="button" className={`chip ${f.provider_ids.includes(p.id) ? 'on' : ''}`}
                      onClick={() => setF({ ...f, provider_ids: f.provider_ids.includes(p.id) ? f.provider_ids.filter((x) => x !== p.id) : [...f.provider_ids, p.id] })}>{p.short_name}</button>))}</div>
                </Field>
                <label className="checkbox"><input type="checkbox" checked={f.online_bookable} onChange={set('online_bookable')} /> Clients can request this online</label>
                {!isNew && <label className="checkbox"><input type="checkbox" checked={f.active} onChange={set('active')} /> Active (untick to retire it from booking)</label>}
              </section>

              <section className="card stack">
                <h2 style={{ margin: 0 }}>Items used to deliver this service</h2>
                <div className="table-scroll">
                  <table className="table">
                    <thead><tr><th>Item</th><th style={{ width: 70 }}>Qty</th><th style={{ width: 100 }}>Unit cost</th><th className="num">Line total</th><th /></tr></thead>
                    <tbody>
                      {f.items.map((it, i) => (
                        <tr key={i}>
                          <td><select className="select" style={{ minWidth: 190 }} aria-label="Item" value={it.item_id} onChange={(e) => { const x = itemList.find((y) => y.id === Number(e.target.value)); setItem(i, { item_id: e.target.value, unit_cost: x ? centsToInput(x.unit_cost_cents) : it.unit_cost }); }}>
                            <option value="">Choose…</option>{itemList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                          <td><input className="input" aria-label="Quantity" inputMode="decimal" value={it.qty} onChange={(e) => setItem(i, { qty: e.target.value })} /></td>
                          <td><input className="input" aria-label="Unit cost" inputMode="decimal" value={it.unit_cost} onChange={(e) => setItem(i, { unit_cost: e.target.value })} /></td>
                          <td className="num"><b>{money(Math.round((Number(it.qty) || 0) * dollarsToCents(it.unit_cost)))}</b></td>
                          <td><button className="icon-btn" aria-label="Remove item" onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })}><Trash2 size={16} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row"><button className="dash-btn" onClick={() => setF({ ...f, items: [...f.items, { item_id: '', qty: 1, unit_cost: '0' }] })}><Plus size={16} /> Add item</button>
                  <button className="btn ghost sm" onClick={() => setNewItem(true)}>New item…</button></div>
                <div className="totals" style={{ borderTop: '1px solid var(--line-strong)', paddingTop: 8 }}>
                  <div><b style={{ color: 'var(--ink)' }}>Total item cost</b><b style={{ color: 'var(--ink)' }}>{money(cost)}</b></div>
                  <div><span>Sale price</span><span>{money(price)}</span></div>
                  <div style={{ color: 'var(--brand)', fontWeight: 800, fontSize: 19 }}><span>Margin</span><span>{money(margin)} · {price ? ((margin / price) * 100).toFixed(1) : '0.0'}%</span></div>
                </div>
              </section>
            </div>
            {newItem && <NewItem onClose={() => setNewItem(false)} onCreated={(it) => { items.reload(); setF((cur) => ({ ...cur, items: [...cur.items, { item_id: it.id, qty: 1, unit_cost: centsToInput(it.unit_cost_cents) }] })); }} />}
          </>
        )}
      </Load>
    </>
  );
}
