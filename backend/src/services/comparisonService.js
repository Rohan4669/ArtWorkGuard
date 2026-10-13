import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ComparisonJob } from '../models/ComparisonJob.js';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { ComparisonProject } from '../models/ComparisonProject.js';
import { EngineError } from '../engines/engine.interface.js';
import { buildReportPdf } from './reportBuilder.js';

/**
 * Executes one claimed job end-to-end. Status is only set to completed* after the engine returned a structurally
 * valid result AND the report was written; a subprocess merely exiting is never treated as success.
 */
export function createComparisonService({ cfg, storages, engine, log }) {
  async function fail(job, err) {
    const known = err instanceof EngineError;
    const code = known ? err.code : 'COMPARISON_FAILED';
    const message = known ? err.message : 'The comparison failed unexpectedly.';
    log.error({ jobId: String(job._id), code, details: known ? err.details : err?.message }, 'comparison failed');
    await ComparisonJob.updateOne({ _id: job._id }, { status: 'failed', completedAt: new Date(), error: { code, message, retryable: known ? err.retryable : true } });
  }

  function validateResult(r) {
    const ok = r && Array.isArray(r.pairs) && r.summary && r.pages && ['differences_found', 'no_differences_detected'].includes(r.verdict) && Array.isArray(r.checks);
    if (!ok) throw new EngineError('ENGINE_INVALID_RESULT', 'The comparison engine returned an invalid result.', { retryable: false });
  }

  async function process(job) {
    const workDir = path.join(cfg.TEMP_DIR, `job-${job._id}-${crypto.randomBytes(4).toString('hex')}`);
    try {
      const [orig, rev, project] = await Promise.all([
        ArtworkFile.findById(job.originalFile).select('+storageKey'), ArtworkFile.findById(job.revisedFile).select('+storageKey'),
        ComparisonProject.findById(job.project),
      ]);
      if (!orig || !rev || !project) throw new EngineError('INPUT_MISSING', 'One of the input files no longer exists.');
      const originalPath = storages.uploads.resolve(orig.storageKey), revisedPath = storages.uploads.resolve(rev.storageKey);
      await Promise.all([fs.access(originalPath, fs.constants.R_OK), fs.access(revisedPath, fs.constants.R_OK)]).catch(() => { throw new EngineError('INPUT_MISSING', 'An input file is missing or unreadable in storage.'); });
      await fs.mkdir(workDir, { recursive: true, mode: 0o700 });

      const result = await engine.compare({
        originalPath, revisedPath, workDir,
        options: { sensitivity: job.options?.sensitivity, timeoutMs: cfg.COMPARISON_TIMEOUT_MS, dpi: cfg.VISUAL_DPI, targetLongSidePx: cfg.VISUAL_TARGET_PX, maxPixels: cfg.VISUAL_MAX_PIXELS },
      });
      validateResult(result);

      await ComparisonJob.updateOne({ _id: job._id }, { status: 'generating_report' });

      // Persist page images under pages/<jobId>/… and rewrite result image names into storage keys.
      const imgDir = String(job._id);
      const reportNames = {};
      for (const p of result.pairs) {
        for (const side of ['original', 'revised']) {
          const name = p.visual.images?.[side];
          if (!name) continue;
          reportNames[`${p.pairIndex}:${side}`] = p.visual.images[`${side}Report`] || name;
          delete p.visual.images[`${side}Report`];
          const key = `${imgDir}/${name}`;
          await storages.pages.put(key, await fs.readFile(path.join(workDir, 'pages', name))).catch(async (e) => { if (e.code !== 'EEXIST') throw e; });
          p.visual.images[side] = key;
        }
      }
      const readImage = async (side, p) => {
        const small = reportNames[`${p.pairIndex}:${side}`]; // downscaled copy keeps the PDF report small
        return fs.readFile(small ? path.join(workDir, 'pages', small) : storages.pages.resolve(p.visual.images[side]));
      };
      const pdf = await buildReportPdf({ appName: cfg.APP_NAME, job, project, originalFile: orig, revisedFile: rev, result, readImage });
      const reportKey = storages.reports.newKey('pdf');
      await storages.reports.put(reportKey, pdf);

      const warnings = result.warnings.map((w) => ({ code: w.code, message: w.message, pairIndex: w.pairIndex }));
      for (const f of [orig, rev]) for (const w of f.warnings || []) {
        if (!warnings.some((x) => x.code === w.code && x.message === w.message)) warnings.push({ code: w.code, message: `${f.role === 'original' ? 'Original' : 'Revised'}: ${w.message}` });
      }
      await ComparisonJob.updateOne({ _id: job._id }, {
        status: warnings.length ? 'completed_with_warnings' : 'completed', completedAt: new Date(),
        engine: { id: result.engine.id, version: result.engine.version }, verdict: result.verdict, summary: { ...result.summary, pages: result.pages },
        result, warnings, reportKey, $unset: { error: 1 },
      });
    } catch (err) { await fail(job, err); }
    finally { await fs.rm(workDir, { recursive: true, force: true }).catch(() => {}); }
  }

  return { process };
}