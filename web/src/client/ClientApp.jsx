import { Outlet, useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../auth.jsx';

export default function ClientApp() {
  return <div className="m-wrap"><div className="m-app"><Outlet /></div></div>;
}

/** Header + scrollable body + optional sticky footer, shared by every client screen. */
export function Frame({ title, back, brand, children, footer }) {
  const nav = useNavigate();
  const { config } = useAuth();
  return (
    <>
      <header className="m-head">
        {back && <button className="back" onClick={() => (typeof back === 'string' ? nav(back) : nav(-1))} aria-label="Back"><ChevronLeft size={26} /></button>}
        {brand ? <><span className="brand" style={{ gap: 10, fontSize: 20, minWidth: 0 }}><span className="dot" style={{ width: 12, height: 12 }} />{config.brand_name}</span></> : title}
      </header>
      <main className="m-body">{children}</main>
      {footer && <footer className="m-foot">{footer}</footer>}
    </>
  );
}
