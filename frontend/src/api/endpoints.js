import { api } from './client.js';
const d = (p) => p.then((r) => r.data);

export const authApi = {
  register: (b) => d(api.post('/auth/register', b)), login: (b) => d(api.post('/auth/login', b)),
  logout: () => d(api.post('/auth/logout')), me: () => d(api.get('/auth/me')),
};
export const userApi = { update: (b) => d(api.patch('/users/me', b)), changePassword: (b) => d(api.post('/users/me/password', b)) };
export const systemApi = { info: () => d(api.get('/system/info')) };
export const dashboardApi = { get: () => d(api.get('/dashboard')) };
export const projectApi = {
  list: (params) => d(api.get('/projects', { params })), get: (id) => d(api.get(`/projects/${id}`)),
  create: (b) => d(api.post('/projects', b)), update: (id, b) => d(api.patch(`/projects/${id}`, b)), remove: (id) => d(api.delete(`/projects/${id}`)),
};
export const fileApi = {
  list: (projectId) => d(api.get(`/projects/${projectId}/files`)),
  upload: (projectId, role, file, onProgress) => {
    const fd = new FormData(); fd.append('role', role); fd.append('file', file);
    return d(api.post(`/projects/${projectId}/files`, fd, { onUploadProgress: (e) => onProgress?.(e.total ? Math.round((e.loaded / e.total) * 100) : 0), timeout: 600000 }));
  },
  remove: (id) => d(api.delete(`/files/${id}`)),
  url: (id, inline = false) => `${api.defaults.baseURL}/files/${id}/download${inline ? '?inline=1' : ''}`,
};
export const comparisonApi = {
  list: (params) => d(api.get('/comparisons', { params })), get: (id) => d(api.get(`/comparisons/${id}`)), status: (id) => d(api.get(`/comparisons/${id}/status`)),
  create: (b) => d(api.post('/comparisons', b)), retry: (id) => d(api.post(`/comparisons/${id}/retry`)), remove: (id) => d(api.delete(`/comparisons/${id}`)),
  reviews: (id) => d(api.get(`/comparisons/${id}/reviews`)), addReview: (id, b) => d(api.post(`/comparisons/${id}/reviews`, b)),
  reportUrl: (id, inline = false) => `${api.defaults.baseURL}/comparisons/${id}/report${inline ? '?inline=1' : ''}`,
  pageImageUrl: (id, pair, side) => `${api.defaults.baseURL}/comparisons/${id}/pages/${pair}/${side}`,
};
export const adminApi = { users: () => d(api.get('/admin/users')), audit: (limit = 50) => d(api.get('/admin/audit', { params: { limit } })) };
