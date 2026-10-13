import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { harness } from '../helpers.js';

test('auth endpoints are rate limited', async () => {
  const hh = await harness({ env: { AUTH_RATE_LIMIT_MAX: '3' } });
  try {
    let last; for (let i = 0; i < 5; i++) last = await request(hh.app).post('/api/auth/login').set(hh.H).send({ email: 'a@b.co', password: 'x' });
    assert.equal(last.status, 429); assert.equal(last.body.error.code, 'AUTH_RATE_LIMITED');
  } finally { await hh.close(); }
});

test('registration can be closed by configuration', async () => {
  const hh = await harness({ env: { ALLOW_REGISTRATION: 'false' } });
  try { const r = await request(hh.app).post('/api/auth/register').set(hh.H).send({ name: 'A', email: 'a@b.co', password: 'Sup3rSecret!pw' }); assert.equal(r.body.error.code, 'REGISTRATION_DISABLED'); }
  finally { await hh.close(); }
});
