import { useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { CalendarDays, FileText, LogOut, Users } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useClickOutside } from '../hooks.js';

export default function StaffShell() {
  const { user, logout, config } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useClickOutside(ref, () => setOpen(false));
  const items = [
    { to: '/staff', label: 'My day', icon: CalendarDays, end: true },
    { to: '/staff/consultation', label: 'Consultation', icon: FileText },
    ...(user.role === 'reception' ? [{ to: '/reception/calendar', label: 'Reception app', icon: Users }] : []),
  ];
  return (
    <div className="staff-shell">
      <header className="topbar">
        <Link to="/staff" className="brand"><span className="dot" />{config.brand_name}</Link>
        <div className="top-actions" ref={ref} style={{ position: 'relative' }}>
          <span className="muted hide-sm">{user.name}</span>
          <button className="avatar brand" style={{ border: 0, width: 42, height: 42 }} onClick={() => setOpen((o) => !o)} aria-label="Account menu" aria-expanded={open}>{user.initials}</button>
          {open && (
            <div className="menu" style={{ top: 'calc(100% + 8px)' }}>
              <div className="who"><b>{user.name}</b><div className="small muted">{user.title}</div></div>
              <Link to="/" onClick={() => setOpen(false)}>All apps</Link>
              <button onClick={() => { logout(); nav('/'); }}><LogOut size={17} /> Sign out</button>
            </div>
          )}
        </div>
      </header>
      <nav className="sidebar" aria-label="Staff">
        <div className="nav">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={21} /> {label}</NavLink>
          ))}
        </div>
        <div className="nav-sep" />
        <div className="nav-label">{config.clinic_name}</div>
      </nav>
      <main className="main"><Outlet /></main>
      <nav className="bottom-nav" aria-label="Staff">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={21} />{label}</NavLink>
        ))}
      </nav>
    </div>
  );
}
