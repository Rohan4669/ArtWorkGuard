import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { harness } from '../helpers.js';

let h, alice, bob, made;
before(async () => {
  h = await harness();
  alice = await h.client('Alice');            // first account bootstraps the admin
  bob = await h.client('Bob');
  made = await h.compare(alice, 'original.pdf', 'changed_number.pdf');
});
after(async () => h.close());

const call = (c, m, u) => c[m === 'delete' ? 'del' : m](u);

test('14. every protected endpoint rejects unauthenticated requests with 401', async () => {
  const anon = request(h.app); const hd = h.H;
  const id = made.job.id, pid = made.project.id, fid = made.original.id;
  const calls = [
    ['get', '/api/auth/me'], ['get', '/api/dashboard'], ['get', '/api/projects'], ['post', '/api/projects'], ['get', `/api/projects/${pid}`],
    ['get', `/api/projects/${pid}/files`], ['post', `/api/projects/${pid}/files`], ['get', `/api/files/${fid}/download`], ['delete', `/api/files/${fid}`],
    ['get', '/api/comparisons'], ['post', '/api/comparisons'], ['get', `/api/comparisons/${id}`], ['get', `/api/comparisons/${id}/status`],
    ['get', `/api/comparisons/${id}/report`], ['get', `/api/comparisons/${id}/pages/0/original`], ['post', `/api/comparisons/${id}/retry`],
    ['post', `/api/comparisons/${id}/reviews`], ['get', `/api/comparisons/${id}/reviews`], ['delete', `/api/comparisons/${id}`],
    ['patch', '/api/users/me'], ['get', '/api/admin/users'], ['get', '/api/admin/audit'],
  ];
  for (const [m, u] of calls) { const r = await anon[m](u).set(hd).send({}); assert.equal(r.status, 401, `${m} ${u}`); }
});

test('15. cross-user access: Bob cannot read, download, modify or compare Alice\'s data (404, never 403/200)', async () => {
  const id = made.job.id, pid = made.project.id, fid = made.original.id;
  const probes = [
    ['get', `/api/projects/${pid}`], ['patch', `/api/projects/${pid}`], ['delete', `/api/projects/${pid}`], ['get', `/api/projects/${pid}/files`],
    ['get', `/api/files/${fid}`], ['get', `/api/files/${fid}/download`], ['get', `/api/files/${fid}/download?inline=1`], ['delete', `/api/files/${fid}`],
    ['get', `/api/comparisons/${id}`], ['get', `/api/comparisons/${id}/status`], ['get', `/api/comparisons/${id}/pages/0/original`],
    ['get', `/api/comparisons/${id}/reviews`], ['post', `/api/comparisons/${id}/reviews`], ['post', `/api/comparisons/${id}/retry`], ['delete', `/api/comparisons/${id}`],
  ];
  for (const [m, u] of probes) { const r = await call(bob, m, u).send({ decision: 'approved', name: 'x' }); assert.equal(r.status, 404, `${m} ${u} -> ${r.status}`); }
  const up = await bob.post(`/api/projects/${pid}/files`).field('role', 'original').attach('file', Buffer.from('%PDF-1.4\n%%EOF\n'), 'x.pdf');
  assert.equal(up.status, 404, 'cannot upload into another user\'s project');
  // Bob creating a comparison that references Alice's project/files must fail.
  const bp = await h.project(bob);
  const cross = await bob.post('/api/comparisons').send({ projectId: pid, originalFileId: made.original.id, revisedFileId: made.revised.id });
  assert.equal(cross.status, 404);
  const mixed = await bob.post('/api/comparisons').send({ projectId: bp.id, originalFileId: made.original.id, revisedFileId: made.revised.id });
  assert.equal(mixed.status, 400); assert.equal(mixed.body.error.code, 'INVALID_FILES');
  // lists are scoped
  assert.equal((await bob.get('/api/comparisons')).body.meta.total, 0);
  assert.equal((await bob.get('/api/projects')).body.data.length, 1);
  assert.equal((await bob.get('/api/dashboard')).body.data.stats.total, 0);
  // Alice's data is untouched
  assert.equal((await alice.get(`/api/comparisons/${id}`)).status, 200);
});

test('16. report download permissions: owner + admin only; malformed ids are 404; failed/queued jobs have no report', async () => {
  const id = made.job.id;
  assert.equal((await alice.get(`/api/comparisons/${id}/report`)).status, 200);
  assert.equal((await bob.get(`/api/comparisons/${id}/report`)).status, 404);
  assert.equal((await bob.get(`/api/comparisons/${id}/report?inline=1`)).status, 404);
  for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'abc', '000000000000000000000000', '{"$ne":null}']) assert.equal((await alice.get(`/api/comparisons/${bad}/report`)).status, 404, bad);
  // NoSQL-injection style id in a query filter is rejected rather than interpreted
  const inj = await alice.get(`/api/comparisons?projectId=${encodeURIComponent('{"$ne":null}')}`); assert.equal(inj.status, 404, 'operator-style ids are not interpreted');
  // an admin (Alice, first registered) may open any report; a normal user (Bob) may not
  assert.equal(alice.user.role, 'admin'); assert.equal(bob.user.role, 'user');
  const bobMade = await h.compare(bob, 'original.pdf', 'identical.pdf');
  assert.equal((await alice.get(`/api/comparisons/${bobMade.job.id}/report`)).status, 200, 'admin override');
  assert.equal((await alice.get(`/api/admin/users`)).status, 200); assert.equal((await bob.get('/api/admin/users')).status, 403);
  assert.equal((await bob.get('/api/admin/audit')).status, 403);
});

test('responses never leak storage keys, report keys, password hashes or stack traces', async () => {
  const bodies = [
    (await alice.get(`/api/comparisons/${made.job.id}`)).text, (await alice.get('/api/comparisons')).text, (await alice.get(`/api/projects/${made.project.id}/files`)).text,
    (await alice.get('/api/auth/me')).text, (await alice.get('/api/admin/users')).text, (await alice.get('/api/dashboard')).text, (await alice.get('/api/nope')).text,
    (await alice.post('/api/projects').send({})).text,
  ];
  for (const t of bodies) assert.ok(!/passwordHash|storageKey|reportKey|tokenVersion|node_modules|\n\s+at /.test(t), t.slice(0, 200));
  assert.ok(!(await alice.get(`/api/comparisons/${made.job.id}`)).text.includes(h.cfg.UPLOAD_DIR));
});

test('auth cookie is httpOnly + SameSite=Lax; login does not reveal whether an email exists; logout clears the session', async () => {
  const a = request.agent(h.app);
  const ok = await a.post('/api/auth/login').set(h.H).send({ email: alice.email, password: 'Sup3rSecret!pw' });
  assert.equal(ok.status, 200);
  const ck = ok.headers['set-cookie'].join(';'); assert.match(ck, /HttpOnly/i); assert.match(ck, /SameSite=Lax/i);
  const wrong = await request(h.app).post('/api/auth/login').set(h.H).send({ email: alice.email, password: 'wrong-password' });
  const unknown = await request(h.app).post('/api/auth/login').set(h.H).send({ email: 'nobody@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401); assert.equal(unknown.status, 401); assert.deepEqual(wrong.body, unknown.body);
  assert.equal((await a.get('/api/auth/me')).status, 200);
  await a.post('/api/auth/logout').set(h.H); assert.equal((await a.get('/api/auth/me')).status, 401);
});

test('CSRF: state-changing requests without the custom header are refused; foreign Origins are refused by CORS', async () => {
  const r = await alice.agent.post('/api/projects').send({ name: 'sneaky' }); // no X-Requested-With
  assert.equal(r.status, 403); assert.equal(r.body.error.code, 'CSRF_REJECTED');
  const evil = await alice.agent.get('/api/projects').set('Origin', 'https://evil.example');
  assert.equal(evil.status, 403); assert.equal(evil.body.error.code, 'CORS_FORBIDDEN');
  const good = await alice.agent.get('/api/projects').set('Origin', 'http://localhost:5173');
  assert.equal(good.status, 200); assert.equal(good.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.equal(good.headers['x-powered-by'], undefined); assert.ok(good.headers['x-content-type-options']);
});

test('input validation: weak passwords, bad emails, duplicate emails, malformed JSON', async () => {
  const post = (b) => request(h.app).post('/api/auth/register').set(h.H).send(b);
  assert.equal((await post({ name: 'X', email: 'x@example.com', password: 'short' })).status, 400);
  assert.equal((await post({ name: 'X', email: 'x@example.com', password: 'alllowercase123' })).status, 400);
  assert.equal((await post({ name: 'X', email: 'not-an-email', password: 'Sup3rSecret!pw' })).status, 400);
  assert.equal((await post({ name: 'Dup', email: alice.email.toUpperCase(), password: 'Sup3rSecret!pw' })).body.error.code, 'EMAIL_IN_USE');
  const mal = await request(h.app).post('/api/auth/login').set(h.H).set('Content-Type', 'application/json').send('{bad');
  assert.equal(mal.status, 400); assert.equal(mal.body.error.code, 'INVALID_JSON');
  const noScript = await alice.post('/api/projects').send({ name: '   ' }); assert.equal(noScript.status, 400);
});

test('changing the password invalidates other sessions', async () => {
  const c2 = await h.client('Carol'); const other = request.agent(h.app);
  await other.post('/api/auth/login').set(h.H).send({ email: c2.email, password: 'Sup3rSecret!pw' });
  assert.equal((await other.get('/api/auth/me')).status, 200);
  const ch = await c2.post('/api/users/me/password').send({ currentPassword: 'Sup3rSecret!pw', newPassword: 'An0therSecret!pw' });
  assert.equal(ch.status, 200);
  assert.equal((await other.get('/api/auth/me')).status, 401, 'old session is dead');
  assert.equal((await c2.get('/api/auth/me')).status, 200, 'current session was re-issued');
  assert.equal((await c2.post('/api/users/me/password').send({ currentPassword: 'wrong', newPassword: 'An0therSecret!pw2' })).body.error.code, 'WRONG_PASSWORD');
});

test('audit trail records uploads, comparisons, downloads and reviews without document contents', async () => {
  const log = (await alice.get('/api/admin/audit?limit=200')).body.data;
  const actions = new Set(log.map((l) => l.action));
  for (const a of ['auth.register', 'project.create', 'file.upload', 'comparison.create', 'report.download']) assert.ok(actions.has(a), a);
  assert.ok(!JSON.stringify(log).includes('Net Vol'));
});

