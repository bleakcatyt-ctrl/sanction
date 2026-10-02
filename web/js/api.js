let csrf = null;
export const setCsrf = (t) => { csrf = t; };

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;
  let res;
  try {
    res = await fetch('/api' + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch {
    const e = new Error('Нет соединения с сервером'); e.status = 0; throw e;
  }
  let data = {};
  try { data = await res.json(); } catch { /* не JSON */ }
  if (!res.ok) {
    const e = new Error(data.error || `Ошибка ${res.status}`);
    e.status = res.status; e.code = data.code;
    throw e;
  }
  return data;
}

export const state = { session: null, stats: null };

export async function loadSession() {
  const s = await api('/session');
  state.session = s;
  setCsrf(s.csrf);
  return s;
}
export const user = () => state.session && state.session.user;
export const isPro = () => !!(user() && user().pro);
