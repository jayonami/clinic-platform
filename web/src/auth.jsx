import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, pub, tokens } from './api.js';
import { closeLive } from './hooks.js';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(!tokens.get('staff'));
  const [config, setConfig] = useState({ brand_name: 'Your Brand', clinic_name: 'Clinic', dev: false });

  useEffect(() => { pub.get('/public/config').then(setConfig).catch(() => {}); }, []);
  useEffect(() => {
    if (!tokens.get('staff')) return;
    api.get('/auth/me').then((r) => setUser(r.user)).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => {
    const out = (e) => { if (e.detail === 'staff') { setUser(null); closeLive(); } };
    window.addEventListener('clinic:signed-out', out);
    return () => window.removeEventListener('clinic:signed-out', out);
  }, []);
  useEffect(() => { document.title = config.brand_name; }, [config.brand_name]);

  const login = useCallback(async (email, pin) => {
    const r = await pub.post('/auth/login', { email, pin });
    tokens.set('staff', r.token);
    setUser(r.user);
    return r.user;
  }, []);
  const logout = useCallback(() => {
    tokens.set('staff', null);
    closeLive();
    setUser(null);
  }, []);
  const value = useMemo(() => ({ user, ready, login, logout, config }), [user, ready, login, logout, config]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RequireStaff({ roles, children, app }) {
  const { user, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="center-page"><div className="skeleton" style={{ width: 240, height: 24 }} /></div>;
  if (!user) return <Navigate to={`/login?app=${app}&next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.includes(user.role)) {
    return (
      <div className="center-page">
        <div className="card login-card stack">
          <h1>Not your area</h1>
          <p className="muted">You’re signed in as {user.name} ({user.role}). This section is for {roles.join(' / ')} accounts.</p>
          <a className="btn" href={user.role === 'provider' ? '/staff' : '/reception/calendar'}>Go to my app</a>
        </div>
      </div>
    );
  }
  return children;
}
