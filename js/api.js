/**
 * BioLoop AI – Frontend API client.
 * Assumes backend runs on port 3000 on the same host by default.
 */
const JWT_STORAGE_KEY = 'bioloop_jwt';

function getApiBase() {
  const url = new URL(window.location.href);
  const qp = url.searchParams.get('apiBase');
  if (qp) return qp.replace(/\/+$/, '');

  const stored = localStorage.getItem('bioloop_api_base');
  if (stored) return stored.replace(/\/+$/, '');

  return `${window.location.protocol}//${window.location.hostname}:3000`;
}

export const API_BASE = getApiBase();

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem(JWT_STORAGE_KEY);
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

