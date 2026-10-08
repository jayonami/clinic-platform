import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, Smartphone } from 'lucide-react';
import { useAuth } from './auth.jsx';

export default function Launcher() {
  const { config, user } = useAuth();
  const tiles = [
    { to: user?.role === 'reception' ? '/reception/calendar' : '/login?app=reception', icon: CalendarDays, title: 'Reception', text: 'Book, check in, run the queue and waitlist, reschedule, check out, look up clients, configure services.' },
    { to: user ? '/staff' : '/login?app=staff', icon: ClipboardList, title: 'Staff', text: 'Start the day, run a consultation, finish a visit. Built for a phone or tablet.' },
    { to: '/book', icon: Smartphone, title: 'Client', text: 'Request an appointment, manage bookings, pay remotely, check in on arrival.' },
  ];
  return (
    <div className="center-page">
      <div className="launcher">
        <div className="brand"><span className="dot" />{config.brand_name}</div>
        <h1 style={{ marginTop: 28 }}>{config.clinic_name}</h1>
        <p className="muted" style={{ marginTop: 8, fontSize: 17 }}>Choose the app you want to open.</p>
        <div className="apps">
          {tiles.map(({ to, icon: Icon, title, text }) => (
            <Link key={title} to={to} className="app-tile">
              <span className="ico"><Icon size={22} /></span>
              <h2>{title}</h2>
              <p className="muted small">{text}</p>
            </Link>
          ))}
        </div>
        <p className="small muted">
          Front-desk QR check-in: <Link to="/checkin">/checkin</Link>
          {config.dev && <> · Demo sign-ins and the client test phone are shown on the sign-in pages.</>}
        </p>
      </div>
    </div>
  );
}
