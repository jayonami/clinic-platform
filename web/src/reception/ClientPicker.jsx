import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { useDebounced } from '../hooks.js';
import { Avatar, Button, Field } from '../ui.jsx';

/** Find an existing client or create one inline. `value` is the chosen client object. */
export default function ClientPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const dq = useDebounced(q, 200);

  useEffect(() => {
    if (dq.trim().length < 2) { setHits([]); return; }
    let live = true;
    api.get(`/clients?q=${encodeURIComponent(dq.trim())}`).then((r) => live && setHits(r.slice(0, 5))).catch(() => {});
    return () => { live = false; };
  }, [dq]);

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const c = await api.post('/clients', form);
      onChange({ ...c, visits: 0 });
      setAdding(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (value) {
    return (
      <div className="row between" style={{ background: 'var(--brand-soft)', border: '1px solid var(--brand-line)', borderRadius: 12, padding: '14px 16px' }}>
        <div className="row"><Avatar name={value.name} tone="brand" /><div><b style={{ fontSize: 17 }}>{value.name}</b><div className="small muted">{value.phone}{value.visits != null && ` · ${value.visits} visit${value.visits === 1 ? '' : 's'}`}</div></div></div>
        <button className="btn ghost sm" type="button" onClick={() => onChange(null)}>Not them? Change →</button>
      </div>
    );
  }
  if (adding) {
    return (
      <div className="stack sm">
        <div className="row wrap" style={{ alignItems: 'flex-start' }}>
          <div className="grow"><Field label="Full name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field></div>
          <div className="grow"><Field label="Phone"><input className="input" inputMode="tel" placeholder="(555) 123-4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field></div>
        </div>
        {err && <div className="form-error">{err}</div>}
        <div className="row"><Button type="button" onClick={create} busy={busy} size="sm">Add client</Button><button type="button" className="btn secondary sm" onClick={() => setAdding(false)}>Back to search</button></div>
      </div>
    );
  }
  return (
    <div className="stack sm">
      <div className="input-icon"><Search size={18} /><input className="input" placeholder="Search by name or phone" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></div>
      {hits.map((c) => (
        <button key={c.id} type="button" className="queue-row" style={{ textAlign: 'left', padding: '10px 14px', border: '1px solid var(--line)', background: '#fff', borderRadius: 12 }} onClick={() => onChange(c)}>
          <b>{c.name}</b> <span className="small muted">{c.phone} · {c.visits} visit{c.visits === 1 ? '' : 's'}</span>
        </button>
      ))}
      {dq.trim().length >= 2 && hits.length === 0 && <div className="small muted">No match for “{dq}”.</div>}
      <div><button type="button" className="btn ghost sm" onClick={() => { setAdding(true); setForm({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q : '' }); }}>+ Add a new client</button></div>
    </div>
  );
}
