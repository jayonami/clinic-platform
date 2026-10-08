import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BarChart3, CalendarDays, LogOut, Plus, Receipt, Search, SlidersHorizontal, Smartphone, UserCheck, Users } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useClickOutside, useDebounced, useLoad } from '../hooks.js';
import { Avatar } from '../ui.jsx';

const NAV = [
  { to: 'calendar', label: 'Calendar', icon: CalendarDays },
  { to: 'checkin', label: 'Check-in queue', short: 'Check-in', icon: UserCheck, badge: true },
  { to: 'billing', label: 'Billing', icon: Receipt },
  { to: 'clients', label: 'Clients', icon: Users },
  { to: 'services', label: 'Services', icon: SlidersHorizontal },
  { to: 'analytics', label: 'Analytics', icon: BarChart3 },
];

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState([]);
  const dq = useDebounced(q, 200);
  const nav = useNavigate();
  const box = useRef(null);
  useClickOutside(box, () => setOpen(false));
  useEffect(() => {
    if (dq.trim().length < 2) { setHits([]); return; }
    let live = true;
    api.get(`/clients?q=${encodeURIComponent(dq.trim())}`).then((r) => live && setHits(r.slice(0, 6))).catch(() => {});
    return () => { live = false; };
  }, [dq]);
  const go = (c) => { setOpen(false); setQ(''); nav(`/reception/clients/${c.id}`); };
  return (
    <div className="top-search" ref={box}>
      <div className="input-icon">
        <Search size={18} />
        <input className="input" placeholder="Search guest by name or phone" aria-label="Search guests" value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) go(hits[0]); if (e.key === 'Escape') setOpen(false); }} />
      </div>
      {open && dq.trim().length >= 2 && (
        <div className="results" role="listbox">
          {hits.length === 0 && <div className="small muted" style={{ padding: 12 }}>No guests match “{dq}”.</div>}
          {hits.map((c) => (
            <button key={c.id} role="option" onClick={() => go(c)}>
              <Avatar name={c.name} size="sm" />
              <span className="grow"><b>{c.name}</b><br /><span className="small muted">{c.phone} · {c.visits} visit{c.visits === 1 ? '' : 's'}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useClickOutside(ref, () => setOpen(false));
  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="avatar gold" style={{ border: 0, width: 42, height: 42 }} onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}>{user.initials}</button>
      {open && (
        <div className="menu">
          <div className="who"><b>{user.name}</b><div className="small muted">{user.title}</div></div>
          <Link to="/" onClick={() => setOpen(false)}><Smartphone size={17} /> All apps</Link>
          <button onClick={() => { logout(); nav('/'); }}><LogOut size={17} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function Shell() {
  const { config } = useAuth();
  const loc = useLocation();
  const queue = useLoad(() => api.get('/queue'), [], { live: true });
  const waiting = queue.data?.waiting ?? 0;
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="shell">
      <header className="topbar">
        <Link to="/reception/calendar" className="brand"><span className="dot" />{config.brand_name}</Link>
        <GlobalSearch />
        <div className="top-actions">
          <Link to="/reception/appointments/new" className="btn"><Plus size={18} /> <span className="hide-sm">New appointment</span></Link>
          <UserMenu />
        </div>
      </header>
      <nav className="sidebar" aria-label="Main">
        <div className="nav">
          {NAV.map(({ to, label, icon: Icon, badge }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
              <Icon size={21} /> {label}
              {badge && waiting > 0 && <span className="count" aria-label={`${waiting} waiting`}>{waiting}</span>}
            </NavLink>
          ))}
        </div>
        <div className="nav-sep" />
        <div className="nav-label">{config.clinic_name}</div>
      </nav>
      <main className="main"><Outlet /></main>
      <nav className="bottom-nav" aria-label="Main">
        {NAV.map(({ to, label, short, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={21} />{short ?? label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
