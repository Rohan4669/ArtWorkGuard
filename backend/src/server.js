import mongoose from 'mongoose';
import pino from 'pino';
import { loadConfig } from './config/env.js';
import { createStorages } from './storage/index.js';
import { createNativeEngine } from './engines/native/index.js';
import { assertEngine } from './engines/engine.interface.js';
import { JobQueue } from './queue/jobQueue.js';
import { createComparisonService } from './services/comparisonService.js';
import { createRetention } from './services/retention.js';
import { createApp } from './app.js';

/** Engine registry: add new engines here; select with COMPARISON_ENGINE. */
export function resolveEngine(cfg) {
  const engines = {
    'native-pdfjs-opencv': () => createNativeEngine({ pythonBin: cfg.PYTHON_BIN, timeoutMs: cfg.COMPARISON_TIMEOUT_MS, dpi: cfg.VISUAL_DPI, targetLongSidePx: cfg.VISUAL_TARGET_PX, maxPixels: cfg.VISUAL_MAX_PIXELS, sensitivity: cfg.VISUAL_SENSITIVITY, maxPages: cfg.MAX_PAGES }),
  };
  const make = engines[cfg.COMPARISON_ENGINE];
  if (!make) throw new Error(`Unknown COMPARISON_ENGINE "${cfg.COMPARISON_ENGINE}". Available: ${Object.keys(engines).join(', ')}`);
  return assertEngine(make());
}

export async function bootstrap(overrides = {}) {
  const cfg = overrides.cfg || loadConfig();
  const log = overrides.log || pino({ level: cfg.LOG_LEVEL, redact: ['*.password', '*.passwordHash', '*.token'] });
  if (cfg.__ephemeralSecret) log.warn('JWT_SECRET not set: using an ephemeral secret (sessions reset on restart). Set JWT_SECRET for any real deployment.');
  await mongoose.connect(cfg.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  const storages = await createStorages(cfg);
  const engine = overrides.engine || resolveEngine(cfg);
  const queue = new JobQueue({ concurrency: cfg.JOB_CONCURRENCY, maxAttempts: cfg.JOB_MAX_ATTEMPTS, log, handler: (job) => svc.process(job) });
  const svc = createComparisonService({ cfg, storages, engine, log });
  const ctx = { cfg, log, storages, engine, queue };
  const app = createApp(ctx);
  await queue.start();
  const retention = createRetention({ cfg, storages, log });
  let timer;
  if (cfg.RETENTION_DAYS > 0) { retention.purgeExpired().catch((e) => log.error({ err: e.message }, 'retention failed')); timer = setInterval(() => retention.purgeExpired().catch((e) => log.error({ err: e.message }, 'retention failed')), 24 * 3600 * 1000); timer.unref(); }
  return { app, ctx, async close() { clearInterval(timer); await queue.stop(); await mongoose.disconnect(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app, ctx, close } = await bootstrap();
  const server = app.listen(ctx.cfg.PORT, () => ctx.log.info({ port: ctx.cfg.PORT, engine: ctx.engine.id }, `${ctx.cfg.APP_NAME} API listening`));
  const stop = async () => { server.close(); await close(); process.exit(0); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}