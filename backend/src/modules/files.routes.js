import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import { ArtworkFile } from '../models/ArtworkFile.js';
import { ComparisonJob } from '../models/ComparisonJob.js';
import { wrap } from '../utils/async.js';
import { AppError, notFound, conflict } from '../utils/errors.js';
import { parseId } from '../utils/objectId.js';
import { looksLikePdf } from '../utils/pdfSignature.js';
import { EngineError } from '../engines/engine.interface.js';
import { requireAuth, scope } from '../middleware/auth.js';
import { loadProject } from './projects.routes.js';

const ENGINE_REJECTIONS = {
  PDF_ENCRYPTED: [422, 'The PDF is password-protected. Remove the password (or export an unprotected copy) and upload again.'],
  PDF_CORRUPT: [422, 'The PDF is corrupted or unreadable. Re-export it from the source application.'],
  PDF_EMPTY: [422, 'The PDF has no pages.'],
  PDF_TOO_MANY_PAGES: [422, 'The PDF has too many pages for this installation.'],
  PDF_UNREADABLE: [422, 'The PDF could not be read.'],
};

export function fileRoutes({ cfg, audit, storages, engine }) {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: cfg.maxUploadBytes, files: 1, fields: 5 } });
  const r = Router(); r.use(requireAuth(cfg));

  r.get('/projects/:projectId/files', wrap(async (req, res) => {
    const p = await loadProject(req, req.params.projectId);
    res.json({ data: await ArtworkFile.find({ project: p._id }).sort({ createdAt: -1 }) });
  }));

  r.post('/projects/:projectId/files', upload.single('file'), wrap(async (req, res) => {
    const project = await loadProject(req, req.params.projectId);
    const { role } = z.object({ role: z.enum(['original', 'revised']) }).parse(req.body);
    if (!req.file) throw new AppError(400, 'NO_FILE', 'No file was uploaded');
    const buf = req.file.buffer;
    // Validate by content, never by extension or the client-supplied MIME type.
    if (!looksLikePdf(buf)) throw new AppError(415, 'NOT_A_PDF', 'Only valid PDF files are accepted (file content is not a PDF).');

    const key = storages.uploads.newKey('pdf');
    await storages.uploads.put(key, buf);
    let info;
    try {
      info = await engine.inspect(storages.uploads.resolve(key));
      if (info.pageCount > cfg.MAX_PAGES) throw new EngineError('PDF_TOO_MANY_PAGES', `PDF has ${info.pageCount} pages; the limit is ${cfg.MAX_PAGES}.`);
    } catch (err) {
      await storages.uploads.delete(key); // rejected files are not retained
      if (err instanceof EngineError) {
        const [status, msg] = ENGINE_REJECTIONS[err.code] || [422, 'The PDF could not be validated.'];
        throw new AppError(status, err.code, err.code === 'PDF_TOO_MANY_PAGES' ? err.message : msg);
      }
      throw err;
    }
    // Client filenames are display-only; strip any path component and control characters.
    const display = path.basename(req.file.originalname.replace(/\\/g, '/')).split('').filter((ch) => ch.charCodeAt(0) >= 32).join('').slice(0, 200) || 'artwork.pdf';
    const doc = await ArtworkFile.create({
      project: project._id, owner: project.owner, role, originalFilename: display, storageKey: key, size: buf.length,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      pageCount: info.pageCount, pageSizes: info.pages.map(({ width, height }) => ({ width, height })), hasTextLayer: info.hasTextLayer, textPages: info.textPages, warnings: info.warnings,
    });
    await audit(req, 'file.upload', { type: 'ArtworkFile', id: doc._id }, { role, size: buf.length, pages: info.pageCount });
    res.status(201).json({ data: doc });
  }));

  async function loadFile(req) {
    const f = await ArtworkFile.findOne(scope(req, { _id: parseId(req.params.id, 'File') })).select('+storageKey');
    if (!f) throw notFound('File');
    return f;
  }

  r.get('/files/:id', wrap(async (req, res) => res.json({ data: await loadFile(req) })));

  r.get('/files/:id/download', wrap(async (req, res) => {
    const f = await loadFile(req);
    if (!(await storages.uploads.exists(f.storageKey))) throw notFound('File');
    const inline = req.query.inline === '1';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(f.size), 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.originalFilename)}` });
    await audit(req, 'file.download', { type: 'ArtworkFile', id: f._id });
    storages.uploads.stream(f.storageKey).on('error', () => res.destroy()).pipe(res);
  }));

  // Originals are immutable; deletion is only allowed when no comparison references the file.
  r.delete('/files/:id', wrap(async (req, res) => {
    const f = await loadFile(req);
    if (await ComparisonJob.exists({ $or: [{ originalFile: f._id }, { revisedFile: f._id }] })) throw conflict('FILE_IN_USE', 'This file is used by a comparison and cannot be deleted.');
    await storages.uploads.delete(f.storageKey); await f.deleteOne();
    await audit(req, 'file.delete', { type: 'ArtworkFile', id: f._id });
    res.json({ data: { ok: true } });
  }));
  return r;
}
