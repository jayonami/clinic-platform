const KEYS = { staff: 'clinic.staff_token', client: 'clinic.client_token' };

export const tokens = {
  get: (kind) => { try { return localStorage.getItem(KEYS[kind]); } catch { return null; } },
  set: (kind, v) => { try { v ? localStorage.setItem(KEYS[kind], v) : localStorage.removeItem(KEYS[kind]); } catch { /* storage blocked */ } },
};

export class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body, kind = 'staff') {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const tok = kind ? tokens.get(kind) : null;
  if (tok) headers.Authorization = `Bearer ${tok}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'Can’t reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && kind && tok) {
      tokens.set(kind, null);
      window.dispatchEvent(new CustomEvent('clinic:signed-out', { detail: kind }));
    }
    throw new ApiError(res.status, data.error || 'Something went wrong', data.code);
  }
  return data;
}

const make = (kind) => ({
  get: (p) => request('GET', p, undefined, kind),
  post: (p, b = {}) => request('POST', p, b, kind),
  put: (p, b = {}) => request('PUT', p, b, kind),
  patch: (p, b = {}) => request('PATCH', p, b, kind),
  del: (p) => request('DELETE', p, undefined, kind),
});

export const api = make('staff'); // reception + provider app
export const client = make('client'); // signed-in client
export const pub = make(null); // anonymous
