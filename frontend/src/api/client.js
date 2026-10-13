import axios from 'axios';

/** Single Axios instance. Auth is an httpOnly cookie, so no token is ever readable from JS. */
export const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL || ''}/api`,
  withCredentials: true,
  headers: { 'X-Requested-With': 'ArtworkGuard' }, // required by the API's CSRF guard
  timeout: 120000,
});

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

api.interceptors.response.use((r) => r, (error) => {
  if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/')) onUnauthorized();
  return Promise.reject(error);
});

/** Normalises any failure into { code, message, details } suitable for display. */
export function toApiError(err) {
  const e = err?.response?.data?.error;
  if (e) return { code: e.code, message: e.message, details: e.details, status: err.response.status };
  if (err?.code === 'ECONNABORTED') return { code: 'TIMEOUT', message: 'The request timed out.' };
  if (err?.request) return { code: 'NETWORK', message: 'Cannot reach the server. Check your connection and that the API is running.' };
  return { code: 'UNKNOWN', message: err?.message || 'Something went wrong.' };
}
