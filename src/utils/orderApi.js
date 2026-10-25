import { store } from './storage';

const apiBase = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
export const apiUrl = url => /^https?:\/\//i.test(url) ? url : `${apiBase}${url.startsWith('/') ? url : `/${url}`}`;

async function getAuthToken(user) {
  let token = user?.token || '';
  if (!token) {
    try {
      const { supabase } = await import('./supabaseClient');
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      token = data.session?.access_token || '';
    } catch (error) {
      if (user?.authProvider === 'supabase') throw error;
    }
  }
  if (!token && user) token = (await store.get('session'))?.token || '';
  if (user && !token) throw new Error('Your session expired. Please login again.');
  return token;
}

export async function orderRequest(url, options = {}, user) {
  const token = await getAuthToken(user);
  const response = await fetch(apiUrl(url), { ...options, headers: {
    'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers
  } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const details = data.fields ? Object.values(data.fields).join(' ') : '';
    const unavailable = [502, 503, 504].includes(response.status) ? 'The service is unavailable. Please try again after the backend and database are restored.' : '';
    throw new Error([data.error || unavailable || `API request failed (${response.status}).`, details].filter(Boolean).join(' '));
  }
  return response;
}

export async function orderApi(url, options = {}, user) {
  const response = await orderRequest(url, options, user);
  return response.json();
}

export async function orderFileApi(url, user) {
  const token = await getAuthToken(user);
  const response = await fetch(apiUrl(url), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `File request failed (${response.status}).`);
  }
  return response.blob();
}

export function rememberGuestOrder(id, token) {
  if (token) localStorage.setItem(`bm-order-token:${id}`, token);
}
export function guestOrderToken(id) {
  return localStorage.getItem(`bm-order-token:${id}`) || '';
}
