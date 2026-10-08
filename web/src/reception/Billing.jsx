import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { api } from '../api.js';
import { md, money } from '../format.js';
import { useDebounced, useLoad } from '../hooks.js';
import { Badge, Empty, Load } from '../ui.jsx';

const TABS = [['outstanding', 'Outstanding'], ['quotation', 'Quotations'], ['paid', 'Paid']];
const tone = { open: 'red', partial: 'red', quotation: 'gold', paid: '' };

export default function Billing() {
  const [tab, setTab] = useState('outstanding');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const nav = useNavigate();
  const state = useLoad(() => api.get(`/invoices?status=${tab}&q=${encodeURIComponent(dq)}`), [tab, dq], { live: true });
  return (
    <>
      <div className="page-head">
        <div><h1>Billing</h1><p>{state.data ? `${state.data.outstanding.count} outstanding · ${money(state.data.outstanding.cents)} to collect` : ' '}</p></div>
        <div className="input-icon" style={{ width: 280 }}><Search size={18} /><input className="input" placeholder="Search by client" aria-label="Search invoices" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      <div className="segmented" style={{ marginBottom: 16 }}>
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <Load state={state}>
        {(d) => (
          <section className="card table-scroll" style={{ padding: 8 }}>
            {d.invoices.length === 0 ? <Empty title="Nothing here">{tab === 'outstanding' ? 'Everything is collected.' : 'No invoices in this view.'}</Empty> : (
              <table className="table">
                <thead><tr><th>Date</th><th>Client</th><th>Services</th><th className="num">Total</th><th className="num">Balance</th><th>Status</th></tr></thead>
                <tbody>
                  {d.invoices.map((i) => (
                    <tr key={i.id} className="click" tabIndex={0} onClick={() => nav(`/reception/billing/${i.id}`)} onKeyDown={(e) => e.key === 'Enter' && nav(`/reception/billing/${i.id}`)}>
                      <td>{md(i.service_date)}</td><td><b>{i.client_name}</b></td><td className="muted">{i.summary}</td>
                      <td className="num">{money(i.total_cents)}</td><td className="num"><b>{money(Math.max(0, i.total_cents - i.paid_cents))}</b></td>
                      <td><Badge tone={tone[i.status]}>{i.status === 'quotation' ? 'Quotation' : i.status === 'paid' ? 'Paid' : i.status === 'partial' ? 'Part-paid' : 'Unpaid'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </Load>
    </>
  );
}
