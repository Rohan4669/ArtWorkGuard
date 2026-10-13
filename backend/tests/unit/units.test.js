import test from 'node:test';
import assert from 'node:assert/strict';
import { alignPages, similarity } from '../../src/engines/native/align.js';
import { diffPageWords } from '../../src/engines/native/textDiff.js';
import { looksLikePdf } from '../../src/utils/pdfSignature.js';
import { LocalStorage } from '../../src/storage/localStorage.js';
import { loadConfig } from '../../src/config/env.js';
import { assertEngine, buildChecks } from '../../src/engines/engine.interface.js';
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';

const W = (s) => s.split(' ').map((text, i) => ({ text, x: i / 20, y: 0, w: 0.04, h: 0.02 }));

test('similarity: identical, disjoint, unknown', () => {
  assert.equal(similarity(['a', 'b'], ['a', 'b']), 1);
  assert.equal(similarity(['a'], ['b']), 0);
  assert.equal(similarity([], []), null);
});

test('alignPages detects inserted page in the middle and keeps later pages aligned', () => {
  const a = [['red', 'apple', 'pie'], ['blue', 'sky', 'day'], ['green', 'grass', 'lawn']];
  const b = [['red', 'apple', 'pie'], ['totally', 'new', 'page', 'here'], ['blue', 'sky', 'day'], ['green', 'grass', 'lawn']];
  assert.deepEqual(alignPages(a, b), [[0, 0], [null, 1], [1, 2], [2, 3]]);
});

test('alignPages pairs a fully rewritten page as a change, not add+remove', () => {
  assert.deepEqual(alignPages([['aaa', 'bbb']], [['ccc', 'ddd']]), [[0, 0]]);
});

test('alignPages falls back to positional pairing when no page has text (scans)', () => {
  assert.deepEqual(alignPages([[], []], [[], [], []]), [[0, 0], [1, 1], [null, 2]]);
});

test('diffPageWords merges removed+added into a single replace', () => {
  const d = diffPageWords(W('Net Vol. 100 ml'), W('Net Vol. 1000 ml'));
  assert.equal(d.changes.length, 1);
  assert.equal(d.changes[0].type, 'replace');
  assert.equal(d.changes[0].original, '100'); assert.equal(d.changes[0].revised, '1000');
  assert.equal(d.wordsAdded, 1); assert.equal(d.wordsRemoved, 1);
});

test('diffPageWords is case- and punctuation-sensitive (packaging text must match exactly)', () => {
  assert.equal(diffPageWords(W('Keep away'), W('keep away')).changes.length, 1);
  assert.equal(diffPageWords(W('ml.'), W('ml')).changes.length, 1);
});

test('looksLikePdf checks header and EOF marker', () => {
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7\n' + 'x'.repeat(100) + '\n%%EOF')), true);
  assert.equal(looksLikePdf(Buffer.from('GIF89a' + 'x'.repeat(100))), false);
  assert.equal(looksLikePdf(Buffer.from('%PDF-1.7 truncated no eof marker here at all')), false);
});

test('LocalStorage rejects traversal keys and never overwrites', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-st-'));
  const s = new LocalStorage(root); await s.init();
  for (const bad of ['../x.pdf', '..', '/etc/passwd', 'a/b/c.pdf', 'a\\b.pdf', 'a b.pdf', '', '%2e%2e/x']) assert.throws(() => s.resolve(bad), /Invalid storage key/, bad);
  const k = s.newKey(); await s.put(k, Buffer.from('1'));
  await assert.rejects(() => s.put(k, Buffer.from('2')), { code: 'EEXIST' });
  assert.equal((await fs.readFile(s.resolve(k))).toString(), '1');
  await fs.rm(root, { recursive: true });
});

test('config: production requires JWT_SECRET; short secrets rejected', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /JWT_SECRET is required/);
  assert.throws(() => loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'short' }), /at least 32/);
  assert.equal(loadConfig({ NODE_ENV: 'test' }).__ephemeralSecret, true);
});

test('engine contract: assertEngine and unsupported checks are always disclosed', () => {
  assert.throws(() => assertEngine({ id: 'x', version: '1', capabilities: {} }), /inspect/);
  const checks = buildChecks({ text: 'performed' });
  assert.equal(checks.find((c) => c.id === 'barcode').status, 'not_performed');
  assert.equal(checks.find((c) => c.id === 'text').status, 'performed');
});

test('block-aware reading order keeps side-by-side columns apart instead of interleaving lines', async () => {
  const { orderByBlocks } = await import('../../src/engines/native/pdfText.js');
  // Left column (x 10-110) and right column (x 300-400) share the same baselines, as in a packaging layout.
  const mk = (text, x0, x1, base) => { const w = { text, x: x0 / 600, y: 0, w: 0.1, h: 0.02, _line: base }; return { x0, x1, base, fontH: 10, words: [w], w }; };
  const segs = [
    mk('Nutrients', 10, 110, 700), mk('Expertly', 300, 400, 700),
    mk('Energy', 10, 110, 686), mk('crafted', 300, 400, 686),
    mk('Protein', 10, 110, 672), mk('from', 300, 400, 672),
  ];
  const ordered = orderByBlocks(segs, segs.map((s) => s.w)).map((w) => w.text);
  assert.deepEqual(ordered, ['Nutrients', 'Energy', 'Protein', 'Expertly', 'crafted', 'from']);
});

test('block-aware reading order still joins words on one line and returns every word exactly once', async () => {
  const { orderByBlocks } = await import('../../src/engines/native/pdfText.js');
  const mk = (text, x0, x1, base) => { const w = { text, x: x0 / 600, y: 0, w: 0.05, h: 0.02, _line: base }; return { x0, x1, base, fontH: 10, words: [w], w }; };
  const segs = [mk('world', 60, 100, 500), mk('Hello', 10, 55, 500), mk('next', 10, 50, 488)];
  const out = orderByBlocks(segs, segs.map((s) => s.w)).map((w) => w.text);
  assert.deepEqual(out, ['Hello', 'world', 'next']);
});

test('diffPageWords merges a rewritten sentence into one change but keeps isolated values separate', () => {
  const a = W('Energy 526.39 Protein stays here always we make crisp snacks and we love tea dearly end');
  const b = W('Energy 516.56 Protein stays here always you bake soft cakes and you adore wine truly end');
  const { changes } = diffPageWords(a, b);
  assert.deepEqual(changes.map((c) => c.original), ['526.39', 'we make crisp snacks and we love tea dearly']);
  assert.equal(changes[1].revised, 'you bake soft cakes and you adore wine truly');
});
