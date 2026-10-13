import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EngineError } from '../engine.interface.js';

/**
 * Runs engine/visual_worker.py as a subprocess WITHOUT a shell: argv is an array and the only dynamic input is a
 * job-file path we generate. Enforces a timeout and an output-size cap; stderr is truncated and never logged raw.
 */
export async function runVisualWorker({ pythonBin, workerPath, job, workDir, timeoutMs, signal }) {
  const jobPath = path.join(workDir, 'visual-job.json');
  await fs.writeFile(jobPath, JSON.stringify(job), { mode: 0o600 });
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(pythonBin, [workerPath, '--job', jobPath], { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, PYTHONUNBUFFERED: '1', OMP_NUM_THREADS: '2' } });
    } catch { return reject(new EngineError('ENGINE_SPAWN_FAILED', 'Could not start the Python worker.', { retryable: false })); }
    let out = '', err = '', done = false;
    const MAX = 20 * 1024 * 1024;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(timer); signal?.removeEventListener('abort', onAbort); fn(v); };
    const kill = () => { try { child.kill('SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(() => { kill(); finish(reject, new EngineError('ENGINE_TIMEOUT', `Visual comparison exceeded ${Math.round(timeoutMs / 1000)}s.`, { retryable: true })); }, timeoutMs);
    const onAbort = () => { kill(); finish(reject, new EngineError('ENGINE_CANCELLED', 'Comparison cancelled.')); };
    signal?.addEventListener('abort', onAbort);
    child.stdout.on('data', (d) => { out += d; if (out.length > MAX) { kill(); finish(reject, new EngineError('ENGINE_OUTPUT_TOO_LARGE', 'Worker output too large.')); } });
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    child.on('error', (e) => {
      const code = e.code === 'ENOENT' ? 'ENGINE_DEPENDENCY_MISSING' : 'ENGINE_SPAWN_FAILED';
      finish(reject, new EngineError(code, e.code === 'ENOENT' ? 'Python interpreter not found. Run "npm run setup:engine" and check PYTHON_BIN.' : 'Could not start the Python worker.'));
    });
    child.on('close', (codeExit) => {
      let parsed;
      try { parsed = JSON.parse(out); } catch { /* handled below */ }
      if (parsed?.error) return finish(reject, new EngineError('ENGINE_WORKER_ERROR', `Visual worker failed: ${parsed.error.type}`, { details: parsed.error.message, retryable: false }));
      if (codeExit !== 0 || !parsed) {
        const missing = /ModuleNotFoundError|ImportError/.test(err);
        return finish(reject, new EngineError(missing ? 'ENGINE_DEPENDENCY_MISSING' : 'ENGINE_CRASHED',
          missing ? 'A Python dependency is missing. Run "npm run setup:engine".' : `Visual worker exited with code ${codeExit}.`, { retryable: !missing, details: err.slice(0, 500) }));
      }
      finish(resolve, parsed);
    });
  });
}
