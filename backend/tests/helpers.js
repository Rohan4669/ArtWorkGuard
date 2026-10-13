import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import pino from 'pino';
import request from 'supertest';
import { loadConfig } from '../src/config/env.js';
import { createStorages } from '../src/storage/index.js';
import { createNativeEngine } from '../src/engines/native/index.js';
import { JobQueue } from '../src/queue/jobQueue.js';
import { createComparisonService } from '../src/services/comparisonService.js';
import { createApp } from '../src/app.js';

export const PY = process.env.PYTHON_BIN || path.resolve(import.meta.dirname, '../../engine/.venv/bin/python');
export const MONGO = process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
const H = { 'X-Requested-With': 'ArtworkGuard' };

let fixtureDir;
/** Generates the controlled PDF fixtures once per process (ReportLab inside the engine venv). */
export async function fixtures() {
  if (fixtureDir) return fixtureDir;
  fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-fixtures-'));
  execFileSync(PY, [path.resolve(import.meta.dirname, '../../engine/tests/generate_fixtures.py'), fixtureDir], { stdio: 'ignore' });
  return fixtureDir;
}

export async function harness({ engine, env = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-test-'));
  const dbName = `ag_test_${crypto.randomBytes(5).toString('hex')}`;
  const cfg = loadConfig({
    NODE_ENV: 'test', MONGODB_URI: `${MONGO}/${dbName}`, JWT_SECRET: 'x'.repeat(48), FRONTEND_ORIGIN: 'http://localhost:5173',
    UPLOAD_DIR: `${root}/uploads`, REPORT_DIR: `${root}/reports`, PAGE_IMAGE_DIR: `${root}/pages`, TEMP_DIR: `${root}/tmp`,
    PYTHON_BIN: PY, COMPARISON_TIMEOUT_MS: '60000', JOB_CONCURRENCY: '2', AUTH_RATE_LIMIT_MAX: '1000', RATE_LIMIT_MAX: '100000', ...env,
  });
  await mongoose.connect(cfg.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  const log = pino({ level: 'silent' });
  const storages = await createStorages(cfg);
  const eng = engine || createNativeEngine({ pythonBin: cfg.PYTHON_BIN, timeoutMs: cfg.COMPARISON_TIMEOUT_MS, dpi: cfg.VISUAL_DPI, sensitivity: cfg.VISUAL_SENSITIVITY, maxPages: cfg.MAX_PAGES });
  const svc = createComparisonService({ cfg, storages, engine: eng, log });
  const queue = new JobQueue({ concurrency: cfg.JOB_CONCURRENCY, maxAttempts: cfg.JOB_MAX_ATTEMPTS, log, handler: (j) => svc.process(j) });
  const app = createApp({ cfg, log, storages, engine: eng, queue });

  /** A logged-in client with its own cookie jar. */
  async function client(name = 'Tester', email) {
    const agent = request.agent(app);
    const em = email || `${name.toLowerCase()}-${crypto.randomBytes(3).toString('hex')}@example.com`;
    const res = await agent.post('/api/auth/register').set(H).send({ name, email: em, password: 'Sup3rSecret!pw' });
    if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
    const wrap = (m) => (url) => agent[m](url).set(H);
    return { agent, user: res.body.data.user, email: em, get: wrap('get'), post: wrap('post'), patch: wrap('patch'), del: wrap('delete') };
  }

  async function project(c, name = 'Test project') { return (await c.post('/api/projects').send({ name })).body.data; }
  async function upload(c, projectId, role, file) {
    const dir = await fixtures();
    return c.post(`/api/projects/${projectId}/files`).field('role', role).attach('file', typeof file === 'string' ? path.join(dir, file) : file.buf, file.name || file);
  }
  async function waitDone(c, id, ms = 60000) {
    const t0 = Date.now();
    for (;;) {
      const r = await c.get(`/api/comparisons/${id}/status`);
      if (['completed', 'completed_with_warnings', 'failed'].includes(r.body.data.status)) return r.body.data;
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for job');
      await new Promise((r2) => setTimeout(r2, 100));
    }
  }
  /** upload both, start comparison, wait, return detail. */
  async function compare(c, origFile, revFile, opts = {}) {
    const p = await project(c);
    const o = await upload(c, p.id, 'original', origFile), r = await upload(c, p.id, 'revised', revFile);
    if (o.status !== 201 || r.status !== 201) throw new Error(`upload failed ${o.status}/${r.status}: ${JSON.stringify(o.body)} ${JSON.stringify(r.body)}`);
    const created = await c.post('/api/comparisons').send({ projectId: p.id, originalFileId: o.body.data.id, revisedFileId: r.body.data.id, ...opts });
    if (created.status !== 202) throw new Error(`create failed ${created.status} ${JSON.stringify(created.body)}`);
    const status = await waitDone(c, created.body.data.id);
    const detail = (await c.get(`/api/comparisons/${created.body.data.id}`)).body.data;
    return { project: p, original: o.body.data, revised: r.body.data, job: detail, status };
  }
  async function close() {
    await queue.stop(); await mongoose.connection.dropDatabase(); await mongoose.disconnect(); await fs.rm(root, { recursive: true, force: true });
  }
  return { cfg, app, client, project, upload, compare, waitDone, close, queue, storages, H };
}
