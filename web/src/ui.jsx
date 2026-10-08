import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { initials } from './format.js';

export const Avatar = ({ name, tone, size, children }) => (
  <span className={`avatar ${tone ?? ''} ${size ?? ''}`} aria-hidden="true">{children ?? initials(name)}</span>
);
export const Badge = ({ tone = '', dot, children, ...rest }) => (
  <span className={`badge ${tone}`} {...rest}>{dot && <i className="dot" />}{children}</span>
);

export function Button({ variant = '', size = '', busy, children, icon: Icon, className = '', ...rest }) {
  return (
    <button {...rest} className={`btn ${variant} ${size} ${className}`.replace(/\s+/g, ' ').trim()} disabled={busy || rest.disabled}>
      {busy ? <Loader2 size={16} className="spin" /> : Icon ? <Icon size={size === 'sm' ? 15 : 18} /> : null}
      {children}
    </button>
  );
}

export const Field = ({ label, hint, error, children, htmlFor }) => (
  <div className="field">
    {label && <label htmlFor={htmlFor}>{label}</label>}
    {children}
    {hint && !error && <span className="xs faint">{hint}</span>}
    {error && <span className="form-error" role="alert">{error}</span>}
  </div>
);

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="empty" role="status"><Loader2 className="spin" size={22} /><div>{label}</div></div>
);
export const ErrorBox = ({ error, retry }) => (
  <div className="empty" role="alert">
    <AlertCircle size={24} />
    <div className="bold">{error?.message ?? 'Something went wrong'}</div>
    {retry && <button className="btn secondary sm" style={{ marginTop: 12 }} onClick={retry}>Try again</button>}
  </div>
);
export const Empty = ({ icon: Icon, title, children }) => (
  <div className="empty">{Icon && <Icon size={26} />}<div className="bold" style={{ color: 'var(--ink)' }}>{title}</div>{children && <div className="small">{children}</div>}</div>
);
export function Load({ state, children, skeleton }) {
  if (state.loading && !state.data) return skeleton ?? <Spinner />;
  if (state.error && !state.data) return <ErrorBox error={state.error} retry={state.reload} />;
  return children(state.data);
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, sheet }) {
  const ref = useRef(null);
  useEffect(() => {
    const prev = document.activeElement;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input, select, textarea, button')?.focus();
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className={`overlay ${sheet ? 'sheet-wrap' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${sheet ? 'sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = 'ok') => {
    const id = Math.random();
    setItems((x) => [...x, { id, message, tone }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), tone === 'error' ? 6000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'error' ? 'error' : ''}`}>
            {t.tone === 'error' ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}{t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Run an async action, toast errors. Returns undefined on failure. */
export function useSafe() {
  const toast = useToast();
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast(okMsg);
      return r ?? true;
    } catch (e) {
      toast(e.message, 'error');
      return undefined;
    }
  }, [toast]);
}

export function Confirm({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose, busy, sheet }) {
  return (
    <Modal title={title} onClose={onClose} sheet={sheet}
      footer={<><Button variant="secondary" onClick={onClose}>Keep</Button><Button variant={danger ? 'danger' : ''} busy={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      <p className="muted">{message}</p>
    </Modal>
  );
}

export function StatusBadge({ appt, minutes }) {
  const m = minutes != null ? ` · ${minutes}m` : '';
  switch (appt.status) {
    case 'checked_in': return <Badge tone="gold">Waiting{m}</Badge>;
    case 'in_room': return <Badge tone="steel">In {appt.resource_name}{m}</Badge>;
    case 'with_provider': return <Badge tone="steel">With {appt.provider_short}{m}</Badge>;
    case 'done': return <Badge>Done</Badge>;
    case 'no_show': return <Badge tone="red">No-show</Badge>;
    case 'cancelled': return <Badge tone="red">Cancelled</Badge>;
    default: return <Badge tone="gray">Upcoming</Badge>;
  }
}
