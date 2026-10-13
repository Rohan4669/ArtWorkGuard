import { Router } from 'express';
import { z } from 'zod';
import { ComparisonProject } from '../models/ComparisonProject.js';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { ComparisonJob } from '../models/ComparisonJob.js';
import { wrap } from '../utils/async.js';
import { notFound, conflict } from '../utils/errors.js';
import { parseId } from '../utils/objectId.js';
import { requireAuth, scope } from '../middleware/auth.js';

const text = (n) => z.string().trim().max(n).default('');
const createSchema = z.object({ name: z.string().trim().min(1).max(150), clientName: text(150), productName: text(150), reference: text(80), notes: text(4000) });
const patchSchema = createSchema.partial().extend({ status: z.enum(['active', 'archived']).optional() });
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function loadProject(req, id) {
  const p = await ComparisonProject.findOne(scope(req, { _id: parseId(id, 'Project') }));
  if (!p) throw notFound('Project');
  return p;
}

export function projectRoutes({ cfg, audit, storages }) {
  const r = Router(); r.use(requireAuth(cfg));

  r.get('/', wrap(async (req, res) => {
    const q = z.object({ status: z.enum(['active', 'archived']).optional(), search: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
    const filter = scope(req, q.status ? { status: q.status } : {});
    if (q.search) { const rx = new RegExp(esc(q.search), 'i'); filter.$or = [{ name: rx }, { clientName: rx }, { productName: rx }, { reference: rx }]; }
    const [items, total] = await Promise.all([ComparisonProject.find(filter).sort({ updatedAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit), ComparisonProject.countDocuments(filter)]);
    const ids = items.map((p) => p._id);
    const [fileCounts, jobCounts] = await Promise.all([
      ArtworkFile.aggregate([{ $match: { project: { $in: ids } } }, { $group: { _id: '$project', n: { $sum: 1 } } }]),
      ComparisonJob.aggregate([{ $match: { project: { $in: ids } } }, { $group: { _id: '$project', n: { $sum: 1 } } }]),
    ]);
    const fc = Object.fromEntries(fileCounts.map((x) => [String(x._id), x.n])), jc = Object.fromEntries(jobCounts.map((x) => [String(x._id), x.n]));
    res.json({ data: items.map((p) => ({ ...p.toJSON(), fileCount: fc[String(p._id)] || 0, comparisonCount: jc[String(p._id)] || 0 })), meta: { total, page: q.page, limit: q.limit } });
  }));

  r.post('/', wrap(async (req, res) => {
    const project = await ComparisonProject.create({ ...createSchema.parse(req.body), owner: req.user._id });
    await audit(req, 'project.create', { type: 'Project', id: project._id });
    res.status(201).json({ data: project });
  }));

  r.get('/:id', wrap(async (req, res) => res.json({ data: await loadProject(req, req.params.id) })));

  r.patch('/:id', wrap(async (req, res) => {
    const p = await loadProject(req, req.params.id);
    Object.assign(p, patchSchema.parse(req.body)); await p.save();
    await audit(req, 'project.update', { type: 'Project', id: p._id });
    res.json({ data: p });
  }));

  // Hard-delete only when the project has no comparisons; otherwise archive (preserves audit trail of reviewed work).
  r.delete('/:id', wrap(async (req, res) => {
    const p = await loadProject(req, req.params.id);
    if (await ComparisonJob.exists({ project: p._id })) throw conflict('PROJECT_HAS_COMPARISONS', 'This project has comparisons. Archive it instead of deleting.');
    const files = await ArtworkFile.find({ project: p._id }).select('+storageKey');
    for (const f of files) await storages.uploads.delete(f.storageKey);
    await ArtworkFile.deleteMany({ project: p._id }); await p.deleteOne();
    await audit(req, 'project.delete', { type: 'Project', id: p._id }, { files: files.length });
    res.json({ data: { ok: true } });
  }));
  return r;
}
