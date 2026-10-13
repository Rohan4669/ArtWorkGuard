import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { harness, fixtures } from '../helpers.js';

let h, c, p;
before(async () => { h = await harness({ env: { MAX_UPLOAD_MB: '0.02', MAX_PAGES: '1' } }); c = await h.client('Val'); p = await h.project(c); });
after(async () => h.close());

test('9. corrupted PDF is rejected with a clear error and nothing is stored', async () => {
  const r = await h.upload(c, p.id, 'original', 'corrupted.pdf');
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'PDF_CORRUPT');
  assert.equal((await fs.readdir(h.cfg.UPLOAD_DIR)).length, 0);
});

test('10. unsupported types are rejected by CONTENT, not extension (text renamed .pdf, PNG, valid PDF named .txt)', async () => {
  for (const f of ['not_a_pdf.pdf', 'image_not_pdf.png']) {
    const r = await h.upload(c, p.id, 'original', f);
    assert.equal(r.status, 415, f); assert.equal(r.body.error.code, 'NOT_A_PDF');
  }
  const buf = await fs.readFile(path.join(await fixtures(), 'removed_page.pdf'));
  const ok = await h.upload(c, p.id, 'original', { buf, name: 'artwork.txt' });
  assert.equal(ok.status, 201, 'a genuine PDF is accepted regardless of its filename');
});

test('password-protected PDFs are detected and rejected explicitly', async () => {
  const r = await h.upload(c, p.id, 'original', 'encrypted.pdf');
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'PDF_ENCRYPTED');
  assert.match(r.body.error.message, /password/i);
});

test('11. oversized files are rejected (413) and the limit is configurable', async () => {
  const r = await h.upload(c, p.id, 'original', 'scan_original.pdf'); // > 20 KB limit set for this suite
  assert.equal(r.status, 413); assert.equal(r.body.error.code, 'FILE_TOO_LARGE');
});

test('page-count limit is enforced and rejected files are removed from storage', async () => {
  const before = (await fs.readdir(h.cfg.UPLOAD_DIR)).length;
  const r = await h.upload(c, p.id, 'original', 'original.pdf'); // 2 pages, MAX_PAGES=1
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'PDF_TOO_MANY_PAGES');
  assert.equal((await fs.readdir(h.cfg.UPLOAD_DIR)).length, before);
});

test('hostile filenames cannot influence storage paths; storage keys are never returned', async () => {
  const buf = await fs.readFile(path.join(await fixtures(), 'removed_page.pdf'));
  const r = await h.upload(c, p.id, 'revised', { buf, name: '../../../etc/passwd.pdf' });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.originalFilename, 'passwd.pdf');
  assert.equal(r.body.data.storageKey, undefined);
  assert.ok(JSON.stringify(r.body).indexOf(h.cfg.UPLOAD_DIR) === -1);
  const stored = await fs.readdir(h.cfg.UPLOAD_DIR);
  assert.ok(stored.every((n) => /^[0-9a-f-]{36}\.pdf$/.test(n)), 'internal names are generated UUIDs');
  assert.equal(r.body.data.pageCount, 1); assert.equal(r.body.data.hasTextLayer, true);
  assert.equal(r.body.data.sha256.length, 64);
});

test('uploaded originals are immutable on disk (read-only) and cannot be overwritten', async () => {
  const [name] = await fs.readdir(h.cfg.UPLOAD_DIR);
  const st = await fs.stat(path.join(h.cfg.UPLOAD_DIR, name));
  assert.equal(st.mode & 0o222, 0, 'no write bits set');
});

test('role must be original|revised and a file is required', async () => {
  const bad = await c.post(`/api/projects/${p.id}/files`).field('role', 'other').attach('file', Buffer.from('%PDF-1.4 x'), 'a.pdf');
  assert.equal(bad.status, 400);
  const none = await c.post(`/api/projects/${p.id}/files`).field('role', 'original');
  assert.equal(none.status, 400); assert.equal(none.body.error.code, 'NO_FILE');
});
