import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { api } from '../api.js';
import { mdy, money } from '../format.js';
import { useDebounced, useLoad } from '../hooks.js';
import { Avatar, Button, Empty, Field, Load, Modal } from '../ui.jsx';

export function ClientForm({ initial, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', language: 'English', ...initial });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function save() {
    setBusy(true); setErr('');
    try {
      const c = initial?.id ? await api.patch(`/clients/${initial.id}`, f) : await api.post('/clients', f);
      onSaved(c); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={initial?.id ? 'Edit details' : 'New client'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button busy={busy} onClick={save}>Save</Button></>}>
      <div className="stack">
        <Field label="Full name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Phone"><input className="input" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Email (optional)"><input className="input" type="email" value={f.email ?? ''} onChange={set('email')} /></Field>
        <Field label="Language"><select className="select" value={f.language} onChange={set('language')}>{['English', 'Español', 'Other'].map((l) => <option key={l}>{l}</option>)}</select></Field>
        {err && <div className="form-error" role="alert">{err}</div>}
      </div>
    </Modal>
  );
}

export default function Clients() {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const state = useLoad(() => api.get(`/clients?q=${encodeURIComponent(dq.trim())}`), [dq], { live: true });
  const [adding, setAdding] = useState(false);
  const nav = useNavigate();
  return (
    <>
      <div className="page-head">
        <div><h1>Clients</h1><p>Look up anyone by name or phone number.</p></div>
        <div className="row"><div className="input-icon" style={{ width: 280 }}><Search size={18} /><input className="input" placeholder="Search clients" aria-label="Search clients" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Button icon={Plus} onClick={() => setAdding(true)}>New client</Button></div>
      </div>
      <Load state={state}>
        {(rows) => (
          <section className="card table-scroll" style={{ padding: 8 }}>
            {rows.length === 0 ? <Empty title="No clients found">Try a different name or phone number.</Empty> : (
              <table className="table">
                <thead><tr><th>Client</th><th>Phone</th><th className="num">Visits</th><th>Last visit</th><th className="num">Outstanding</th></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="click" tabIndex={0} onClick={() => nav(`/reception/clients/${c.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/reception/clients/${c.id}`)}>
                      <td><div className="row"><Avatar name={c.name} size="sm" /><b>{c.name}</b></div></td>
                      <td>{c.phone}</td><td className="num">{c.visits}</td>
                      <td>{c.last_visit ? mdy(c.last_visit) : <span className="faint">—</span>}</td>
                      <td className="num" style={{ color: c.outstanding_cents ? 'var(--red)' : undefined, fontWeight: c.outstanding_cents ? 700 : 400 }}>{c.outstanding_cents ? money(c.outstanding_cents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </Load>
      {adding && <ClientForm onClose={() => setAdding(false)} onSaved={(c) => nav(`/reception/clients/${c.id}`)} />}
    </>
  );
}
