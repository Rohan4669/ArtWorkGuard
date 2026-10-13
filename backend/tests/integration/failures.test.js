import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { harness, PY } from '../helpers.js';
import { createNativeEngine } from '../../src/engines/native/index.js';
import { EngineError, buildChecks } from '../../src/engines/engine.interface.js';
import { ComparisonJob } from '../../src/models/ComparisonJob.js';

const real = (o = {}) => createNativeEngine({ pythonBin: PY, ...o });

test('12. comparison timeout (COMPARISON_TIMEOUT_MS) -> failed with ENGINE_TIMEOUT (retryable), no stack trace exposed', async () => {
  const h = await harness({ env: { COMPARISON_TIMEOUT_MS: '1' } });
  try {
    const c = await h.client('T');
    const { job } = await h.compare(c, 'original.pdf', 'changed_name.pdf', {});
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'ENGINE_TIMEOUT'); assert.equal(job.error.retryable, true);
    assert.ok(!JSON.stringify(job).includes('at '), 'no stack'); assert.equal(job.result, undefined);
    assert.equal(job.hasReport, false, 'a failed job is never reported as having a report');
  } finally { await h.close(); }
});

test('13. Python dependency failures: missing interpreter and missing modules are reported as ENGINE_DEPENDENCY_MISSING', async () => {
  // Deterministic stub interpreter (the host python may or may not have the libraries installed).
  const stub = path.join(os.tmpdir(), `ag-stub-python-${process.pid}.sh`);
  await fs.writeFile(stub, '#!/bin/sh\necho "ModuleNotFoundError: No module named cv2" >&2\nexit 1\n', { mode: 0o755 });
  for (const bin of ['/nonexistent/python', stub]) {
    const h = await harness({ env: { PYTHON_BIN: bin } });
    try {
      const c = await h.client('D');
      const { job } = await h.compare(c, 'original.pdf', 'changed_name.pdf');
      assert.equal(job.status, 'failed', bin); assert.equal(job.error.code, 'ENGINE_DEPENDENCY_MISSING', bin);
      assert.match(job.error.message, /setup:engine/);
    } finally { await h.close(); }
  }
  await fs.rm(stub, { force: true });
});

test('17. failed comparison can be retried and then succeeds; non-failed jobs cannot be retried', async () => {
  const inner = real(); let calls = 0;
  const flaky = { ...inner, compare: async (a) => { if (++calls === 1) throw new EngineError('ENGINE_CRASHED', 'Visual worker exited with code 139.', { retryable: true }); return inner.compare(a); } };
  const h = await harness({ engine: flaky });
  try {
    const c = await h.client('R');
    const { job } = await h.compare(c, 'original.pdf', 'changed_number.pdf');
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'ENGINE_CRASHED');
    assert.equal((await c.post(`/api/comparisons/${job.id}/retry`)).status, 202);
    const st = await h.waitDone(c, job.id);
    assert.equal(st.status, 'completed'); assert.equal(st.error, undefined);
    assert.equal((await c.post(`/api/comparisons/${job.id}/retry`)).body.error.code, 'NOT_FAILED');
    const done = (await c.get(`/api/comparisons/${job.id}`)).body.data;
    assert.equal(done.attempts, 1, 'retry resets the attempt counter'); assert.equal(done.verdict, 'differences_found');
  } finally { await h.close(); }
});

test('engine adapter is replaceable: a different engine plugs in with no application changes', async () => {
  const fake = {
    id: 'fake-engine', version: '0.0.1', capabilities: { text: 'performed' },
    inspect: async () => ({ pageCount: 1, pages: [{ width: 100, height: 100 }], textPages: 1, hasTextLayer: true, warnings: [] }),
    compare: async () => ({ engine: { id: 'fake-engine', version: '0.0.1', dpi: 0, sensitivity: 'n/a' }, pages: { original: 1, revised: 1 }, verdict: 'no_differences_detected',
      summary: { pagesAdded: 0, pagesRemoved: 0, pagesChanged: 0, textChanges: 0, wordsAdded: 0, wordsRemoved: 0, visualRegions: 0 },
      pairs: [{ pairIndex: 0, originalPage: 1, revisedPage: 1, status: 'identical', textAvailable: { original: true, revised: true }, text: { changes: [], wordsAdded: 0, wordsRemoved: 0 }, visual: { regions: [], images: {} } }],
      warnings: [], checks: buildChecks({ text: 'performed' }) }),
  };
  const h = await harness({ engine: fake });
  try {
    const c = await h.client('F');
    const { job } = await h.compare(c, 'original.pdf', 'identical.pdf');
    assert.equal(job.status, 'completed'); assert.equal(job.engine.id, 'fake-engine'); assert.ok(job.hasReport);
    assert.equal(job.result.checks.find((x) => x.id === 'visual').status, 'not_performed', 'the fake engine does not claim visual checks');
  } finally { await h.close(); }
});

test('an engine returning a malformed result is a failure, never a success', async () => {
  const bad = { ...real(), compare: async () => ({ verdict: 'yes' }) };
  const h = await harness({ engine: bad });
  try {
    const c = await h.client('B');
    const { job } = await h.compare(c, 'original.pdf', 'identical.pdf');
    assert.equal(job.status, 'failed'); assert.equal(job.error.code, 'ENGINE_INVALID_RESULT');
  } finally { await h.close(); }
});

test('crash recovery: jobs left mid-flight are re-queued and completed on startup; exhausted jobs fail as retryable', async () => {
  const h = await harness();
  try {
    const c = await h.client('Rec');
    const made = await h.compare(c, 'original.pdf', 'changed_name.pdf');
    await ComparisonJob.updateOne({ _id: made.job.id }, { status: 'comparing', attempts: 1, $unset: { completedAt: 1 } }); // simulate crash mid-run
    const exhausted = await h.compare(c, 'original.pdf', 'identical.pdf');
    await ComparisonJob.updateOne({ _id: exhausted.job.id }, { status: 'comparing', attempts: 99 });
    await h.queue.start();
    assert.equal((await h.waitDone(c, made.job.id)).status, 'completed');
    const ex = await ComparisonJob.findById(exhausted.job.id);
    assert.equal(ex.status, 'failed'); assert.equal(ex.error.code, 'INTERRUPTED'); assert.equal(ex.error.retryable, true);
  } finally { await h.close(); }
});

test('missing input file fails with INPUT_MISSING and is reported as not retryable', async () => {
  const h = await harness();
  try {
    const c = await h.client('M');
    const made = await h.compare(c, 'original.pdf', 'identical.pdf');
    const { ArtworkFile } = await import('../../src/models/ArtworkFile.js');
    const f = await ArtworkFile.findById(made.original.id).select('+storageKey');
    await h.storages.uploads.delete(f.storageKey);
    await ComparisonJob.updateOne({ _id: made.job.id }, { status: 'queued' }); h.queue.enqueue(made.job.id);
    const st = await h.waitDone(c, made.job.id);
    assert.equal(st.status, 'failed'); assert.equal(st.error.code, 'INPUT_MISSING');
    assert.equal((await c.post(`/api/comparisons/${made.job.id}/retry`)).body.error.code, 'NOT_RETRYABLE');
  } finally { await h.close(); }
});
