import { Router } from 'express';
import { z } from 'zod';
import { ComparisonJob } from '../models/ComparisonJob.js';
import { ComparisonProject } from '../models/ComparisonProject.js';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { User } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { wrap } from '../utils/async.js';
import { requireAuth, requireRole, scope } from '../middleware/auth.js';

export const LIMITATIONS = [
  'Compares extractable text and the rendered appearance of aligned pages. It is an aid to proofing, not a replacement for it.',
  'Does not verify CMYK or spot-colour values, overprint, barcode correctness, dielines, bleed/trim or font substitution.',
  'Scanned or outlined artwork has no text layer: text is not read; only pixel differences are shown.',
  'Very small or low-contrast visual changes can fall below the detection sensitivity.',
  'A result of "no differences detected" is never confirmation that the artwork is error-free.',
];

export function systemRoutes({ cfg, engine }) {
  const r = Router();
  r.get('/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  r.get('/system/info', (_req, res) => res.json({ data: {
    appName: cfg.APP_NAME, registrationOpen: cfg.ALLOW_REGISTRATION, maxUploadMb: cfg.MAX_UPLOAD_MB, maxPages: cfg.MAX_PAGES,
    engine: { id: engine.id, version: engine.version, capabilities: engine.capabilities }, limitations: LIMITATIONS,
  } }));
  return r;
}

export function dashboardRoutes({ cfg }) {
  const r = Router(); r.use(requireAuth(cfg));
  r.get('/', wrap(async (req, res) => {
    const s = (x = {}) => scope(req, x);
    const [total, completed, needReview, failed, inProgress, projects, files, jobs] = await Promise.all([
      ComparisonJob.countDocuments(s()),
      ComparisonJob.countDocuments(s({ status: { $in: ['completed', 'completed_with_warnings'] } })),
      ComparisonJob.countDocuments(s({ status: { $in: ['completed', 'completed_with_warnings'] }, reviewStatus: 'pending' })),
      ComparisonJob.countDocuments(s({ status: 'failed' })),
      ComparisonJob.countDocuments(s({ status: { $in: ['queued', 'comparing', 'generating_report'] } })),
      ComparisonProject.find(s({ status: 'active' })).sort({ updatedAt: -1 }).limit(5),
      ArtworkFile.find(s()).sort({ createdAt: -1 }).limit(6).populate('project', 'name'),
      ComparisonJob.find(s()).sort({ createdAt: -1 }).limit(6).populate('project', 'name').populate('originalFile', 'originalFilename').populate('revisedFile', 'originalFilename'),
    ]);
    res.json({ data: { stats: { total, completed, needReview, failed, inProgress }, recentProjects: projects, recentFiles: files, latestComparisons: jobs } });
  }));
  return r;
}

export function adminRoutes({ cfg }) {
  const r = Router(); r.use(requireAuth(cfg), requireRole('admin'));
  r.get('/users', wrap(async (_req, res) => res.json({ data: await User.find().sort({ createdAt: -1 }).limit(200) })));
  r.get('/audit', wrap(async (req, res) => {
    const q = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    res.json({ data: await AuditLog.find().sort({ createdAt: -1 }).limit(q.limit).populate('actor', 'name email') });
  }));
  return r;
}
