import { Router } from 'express';
import { z } from 'zod';
import { ComparisonJob } from '../models/ComparisonJob.js';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { ReviewRecord } from '../models/ReviewRecord.js';
import { wrap } from '../utils/async.js';
import { AppError, notFound, conflict } from '../utils/errors.js';
import { parseId } from '../utils/objectId.js';
import { requireAuth, scope } from '../middleware/auth.js';
import { loadProject } from './projects.routes.js';

const createSchema = z.object({
  projectId: z.string(), originalFileId: z.string(), revisedFileId: z.string(),
  options: z.object({ sensitivity: z.enum(['standard', 'high']).optional() }).optional(),
});
const reviewSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'changes_requested', 'comment']),
  comments: z.string().trim().max(4000).default(''),
  acknowledgeWarnings: z.boolean().optional(),
});
const DONE = ['completed', 'completed_with_warnings'];
const safeName = (s) => String(s).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'report';

export function comparisonRoutes({ cfg, audit, storages, queue }) {
  const r = Router(); r.use(requireAuth(cfg));

  async function load(req, { withResult = false } = {}) {
    let q = ComparisonJob.findOne(scope(req, { _id: parseId(req.params.id, 'Comparison') }))
      .populate('project', 'name clientName productName reference')
      .populate('originalFile', 'originalFilename size pageCount hasTextLayer role')
      .populate('revisedFile', 'originalFilename size pageCount hasTextLayer role');
    if (withResult) q = q.select('+result +reportKey');
    else q = q.select('+reportKey');
    const job = await q;
    if (!job) throw notFound('Comparison');
    return job;
  }

  r.post('/', wrap(async (req, res) => {
    const body = createSchema.parse(req.body);
    const project = await loadProject(req, body.projectId);
    const [orig, rev] = await Promise.all([
      ArtworkFile.findOne(scope(req, { _id: parseId(body.originalFileId, 'File'), project: project._id, role: 'original' })),
      ArtworkFile.findOne(scope(req, { _id: parseId(body.revisedFileId, 'File'), project: project._id, role: 'revised' })),
    ]);
    if (!orig || !rev) throw new AppError(400, 'INVALID_FILES', 'Choose an uploaded original and revised file belonging to this project.');
    const job = await ComparisonJob.create({ project: project._id, owner: project.owner, originalFile: orig._id, revisedFile: rev._id, options: { sensitivity: body.options?.sensitivity || cfg.VISUAL_SENSITIVITY }, engine: { id: cfg.COMPARISON_ENGINE } });
    await audit(req, 'comparison.create', { type: 'ComparisonJob', id: job._id });
    queue.enqueue(String(job._id));
    res.status(202).json({ data: job });
  }));

  r.get('/', wrap(async (req, res) => {
    const q = z.object({
      status: z.string().optional(), projectId: z.string().optional(), reviewStatus: z.enum(['pending', 'approved', 'rejected', 'changes_requested']).optional(),
      verdict: z.enum(['differences_found', 'no_differences_detected']).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20), page: z.coerce.number().int().min(1).default(1),
    }).parse(req.query);
    const filter = scope(req);
    if (q.status) filter.status = { $in: q.status.split(',').filter((s) => ['queued', 'comparing', 'generating_report', 'completed', 'completed_with_warnings', 'failed'].includes(s)) };
    if (q.projectId) filter.project = parseId(q.projectId, 'Project');
    if (q.reviewStatus) filter.reviewStatus = q.reviewStatus;
    if (q.verdict) filter.verdict = q.verdict;
    const [items, total] = await Promise.all([
      ComparisonJob.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('project', 'name clientName').populate('originalFile', 'originalFilename').populate('revisedFile', 'originalFilename'),
      ComparisonJob.countDocuments(filter),
    ]);
    res.json({ data: items, meta: { total, page: q.page, limit: q.limit } });
  }));

  // Lightweight polling endpoint: no result payload.
  r.get('/:id/status', wrap(async (req, res) => {
    const j = await ComparisonJob.findOne(scope(req, { _id: parseId(req.params.id, 'Comparison') })).select('status attempts error warnings verdict reviewStatus startedAt completedAt queuedAt');
    if (!j) throw notFound('Comparison');
    res.json({ data: j });
  }));

  r.get('/:id', wrap(async (req, res) => res.json({ data: await load(req, { withResult: true }) })));

  r.post('/:id/retry', wrap(async (req, res) => {
    const job = await load(req);
    if (job.status !== 'failed') throw conflict('NOT_FAILED', 'Only failed comparisons can be retried.');
    if (job.error?.code === 'INPUT_MISSING') throw conflict('NOT_RETRYABLE', 'An input file is missing, so this comparison cannot be retried. Upload the files again and start a new comparison.');
    job.set({ status: 'queued', attempts: 0, queuedAt: new Date(), startedAt: undefined, completedAt: undefined, error: undefined }); await job.save();
    await audit(req, 'comparison.retry', { type: 'ComparisonJob', id: job._id });
    queue.enqueue(String(job._id));
    res.status(202).json({ data: job });
  }));

  r.delete('/:id', wrap(async (req, res) => {
    const job = await load(req);
    if (['comparing', 'generating_report'].includes(job.status)) throw conflict('JOB_RUNNING', 'This comparison is running. Try again when it has finished.');
    if (job.reportKey) await storages.reports.delete(job.reportKey);
    await storages.pages.deletePrefix(String(job._id));
    await ReviewRecord.deleteMany({ job: job._id }); await job.deleteOne();
    await audit(req, 'comparison.delete', { type: 'ComparisonJob', id: job._id });
    res.json({ data: { ok: true } });
  }));

  r.get('/:id/report', wrap(async (req, res) => {
    const job = await load(req);
    if (!DONE.includes(job.status) || !job.reportKey || !(await storages.reports.exists(job.reportKey))) throw notFound('Report');
    const inline = req.query.inline === '1';
    res.set({ 'Content-Type': 'application/pdf', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="ArtworkGuard-${safeName(job.project?.name)}-${String(job._id).slice(-6)}.pdf"` });
    await audit(req, 'report.download', { type: 'ComparisonJob', id: job._id });
    storages.reports.stream(job.reportKey).on('error', () => res.destroy()).pipe(res);
  }));

  r.get('/:id/pages/:pair/:side', wrap(async (req, res) => {
    const side = z.enum(['original', 'revised']).parse(req.params.side);
    const pair = z.coerce.number().int().min(0).max(100000).parse(req.params.pair);
    const job = await load(req, { withResult: true });
    const key = job.result?.pairs?.[pair]?.visual?.images?.[side];
    if (!key || !(await storages.pages.exists(key))) throw notFound('Page image');
    res.set({ 'Content-Type': 'image/png', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=300' });
    storages.pages.stream(key).on('error', () => res.destroy()).pipe(res);
  }));

  r.get('/:id/reviews', wrap(async (req, res) => {
    const job = await load(req);
    res.json({ data: await ReviewRecord.find({ job: job._id }).sort({ createdAt: -1 }) });
  }));

  r.post('/:id/reviews', wrap(async (req, res) => {
    const job = await load(req);
    const b = reviewSchema.parse(req.body);
    if (!DONE.includes(job.status)) throw conflict('NOT_COMPLETE', 'The comparison must be complete before it can be reviewed.');
    if (['rejected', 'changes_requested'].includes(b.decision) && !b.comments) throw new AppError(400, 'COMMENT_REQUIRED', 'Please add a comment explaining the decision.');
    if (b.decision === 'approved' && job.warnings?.length && !b.acknowledgeWarnings) throw new AppError(400, 'WARNINGS_NOT_ACKNOWLEDGED', 'This comparison has warnings. Confirm that you have reviewed them before accepting.');
    const rec = await ReviewRecord.create({ job: job._id, reviewer: req.user._id, reviewerName: req.user.name, decision: b.decision, comments: b.comments });
    if (b.decision !== 'comment') { job.reviewStatus = b.decision; await job.save(); }
    await audit(req, 'review.create', { type: 'ComparisonJob', id: job._id }, { decision: b.decision });
    res.status(201).json({ data: rec });
  }));
  return r;
}
