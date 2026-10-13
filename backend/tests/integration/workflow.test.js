import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { harness } from '../helpers.js';

let h, c;
before(async () => { h = await harness(); c = await h.client('Owner'); });
after(async () => h.close());

const run = (rev, orig = 'original.pdf') => h.compare(c, orig, rev);

test('1. identical PDFs -> no differences detected, and the UI-facing verdict never says "error free"', async () => {
  const { job } = await run('identical.pdf');
  assert.equal(job.status, 'completed');
  assert.equal(job.verdict, 'no_differences_detected');
  assert.equal(job.summary.visualRegions, 0);
  assert.equal(job.summary.textChanges, 0);
  assert.ok(job.result.checks.find((x) => x.id === 'barcode').status === 'not_performed', 'unsupported checks must be disclosed');
  assert.ok(job.hasReport, 'a report is still produced so the reviewer has a record');
});

test('2. changed product name is detected with the exact words', async () => {
  const { job } = await run('changed_name.pdf');
  assert.equal(job.verdict, 'differences_found');
  const ch = job.result.pairs[0].text.changes[0];
  assert.match(ch.original, /SHAMPOO/); assert.match(ch.revised, /SHAMPO0/);
});

test('3. changed numerical value (100 ml -> 1000 ml) and changed date', async () => {
  const a = (await run('changed_number.pdf')).job.result.pairs[0].text.changes[0];
  assert.equal(a.original, '100'); assert.equal(a.revised, '1000');
  assert.ok(a.originalBox && a.revisedBox, 'bounding boxes are provided for highlighting');
  const d = (await run('changed_date.pdf')).job.result.pairs[0].text.changes[0];
  assert.equal(d.original, '02/2029'); assert.equal(d.revised, '02/2039');
});

test('4. added text', async () => {
  const { job } = await run('added_text.pdf');
  assert.equal(job.verdict, 'differences_found');
  assert.ok(job.summary.wordsAdded >= 1);
  assert.equal(job.result.pairs[0].text.changes[0].type, 'add');
});

test('5. deleted text (missing warning) stays aligned as one changed page, not add+remove', async () => {
  const { job } = await run('missing_warning.pdf');
  assert.equal(job.summary.pagesAdded, 0); assert.equal(job.summary.pagesRemoved, 0);
  assert.equal(job.result.pairs[0].text.changes[0].type, 'delete');
  assert.match(job.result.pairs[0].text.changes[0].original, /Keep out of reach of children/);
});

test('6. added page', async () => {
  const { job } = await run('extra_page.pdf');
  assert.equal(job.summary.pagesAdded, 1); assert.equal(job.result.pages.revised, 3);
  assert.equal(job.result.pairs[2].status, 'added');
  assert.equal(job.result.pairs[2].originalPage, null);
});

test('7. removed page', async () => {
  const { job } = await run('removed_page.pdf');
  assert.equal(job.summary.pagesRemoved, 1);
  assert.equal(job.result.pairs[1].status, 'removed');
});

test('8. scanned PDFs without a text layer: warning shown, differences found only visually, never "text identical"', async () => {
  const { job, status } = await run('scan_changed_number.pdf', 'scan_original.pdf');
  assert.equal(status.status, 'completed_with_warnings');
  assert.ok(job.warnings.some((w) => w.code === 'NO_TEXT_LAYER'));
  assert.equal(job.summary.textChanges, 0);
  assert.ok(job.summary.visualRegions >= 1, 'pixel comparison still finds the changed number');
  // and scanning the identical scan twice must still warn (absence of differences is not trustworthy)
  const same = await run('scan_original.pdf', 'scan_original.pdf');
  assert.equal(same.status.status, 'completed_with_warnings');
});

test('graphic-only changes (colour, move, removal) are caught by the visual check', async () => {
  for (const f of ['graphic_colour_changed.pdf', 'graphic_moved.pdf', 'graphic_removed.pdf']) {
    const { job } = await run(f);
    assert.equal(job.verdict, 'differences_found', f);
    assert.equal(job.summary.textChanges, 0, f);
    assert.ok(job.summary.visualRegions >= 1, f);
  }
});

test('documented limit: a ~3% tint shift is NOT found at standard sensitivity but IS at high', async () => {
  const std = (await run('tiny_colour_shift.pdf')).job;
  assert.equal(std.verdict, 'no_differences_detected');
  const hi = (await h.compare(c, 'original.pdf', 'tiny_colour_shift.pdf', { options: { sensitivity: 'high' } })).job;
  assert.equal(hi.verdict, 'differences_found');
  assert.equal(hi.result.pairs[0].visual.regions[0].kind, 'subtle');
});

test('report PDF is a real PDF, downloadable by the owner, with page images served by the API', async () => {
  const { job } = await run('changed_number.pdf');
  const rep = await c.get(`/api/comparisons/${job.id}/report`).buffer(true).parse((res, cb) => { const ch = []; res.on('data', (d) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
  assert.equal(rep.status, 200); assert.equal(rep.headers['content-type'], 'application/pdf');
  assert.equal(rep.body.subarray(0, 5).toString(), '%PDF-'); assert.ok(rep.body.length > 5000);
  assert.match(rep.headers['content-disposition'], /^attachment/);
  const { inspectPdf } = await import('../../src/engines/native/pdfText.js');
  const fs = await import('node:fs/promises'); const tmp = `${h.cfg.TEMP_DIR}/rep-${Date.now()}.pdf`; await fs.writeFile(tmp, rep.body);
  const info = await inspectPdf(tmp);
  assert.equal(info.pageCount, 3, 'summary + 1 changed page pair + limitations, no blank footer pages');
  assert.equal(info.textPages, 3, 'every report page has text (no blank pages)');
  const img = await c.get(`/api/comparisons/${job.id}/pages/0/revised`).buffer(true).parse((res, cb) => { const ch = []; res.on('data', (d) => ch.push(d)); res.on('end', () => cb(null, Buffer.concat(ch))); });
  assert.equal(img.status, 200); assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.body.subarray(1, 4).toString(), 'PNG');
  assert.equal((await c.get(`/api/comparisons/${job.id}/pages/0/bogus`)).status, 400);
  assert.equal((await c.get(`/api/comparisons/${job.id}/pages/99/original`)).status, 404);
});

test('review workflow: warnings must be acknowledged; reject needs a comment; status and history update', async () => {
  const { job } = await run('scan_changed_number.pdf', 'scan_original.pdf');
  const url = `/api/comparisons/${job.id}/reviews`;
  assert.equal((await c.post(url).send({ decision: 'approved' })).body.error.code, 'WARNINGS_NOT_ACKNOWLEDGED');
  assert.equal((await c.post(url).send({ decision: 'rejected' })).body.error.code, 'COMMENT_REQUIRED');
  assert.equal((await c.post(url).send({ decision: 'rejected', comments: 'Net quantity changed' })).status, 201);
  assert.equal((await c.get(`/api/comparisons/${job.id}`)).body.data.reviewStatus, 'rejected');
  assert.equal((await c.post(url).send({ decision: 'approved', acknowledgeWarnings: true, comments: 'Fixed in v3' })).status, 201);
  const hist = (await c.get(url)).body.data;
  assert.equal(hist.length, 2); assert.equal(hist[0].decision, 'approved'); assert.equal((await c.get(`/api/comparisons/${job.id}`)).body.data.reviewStatus, 'approved');
});

test('dashboard shows real counts derived from the records', async () => {
  const d = (await c.get('/api/dashboard')).body.data;
  const total = (await c.get('/api/comparisons?limit=100')).body.meta.total;
  assert.equal(d.stats.total, total); assert.ok(total >= 10);
  assert.equal(d.stats.completed + d.stats.failed + d.stats.inProgress, total);
  assert.ok(d.recentProjects.length > 0 && d.recentFiles.length > 0 && d.latestComparisons.length > 0);
});
