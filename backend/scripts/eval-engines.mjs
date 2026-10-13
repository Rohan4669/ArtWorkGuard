// Runs the native engine over the generated pairs and prints a results table with pass/fail vs. expectation.
import fs from 'node:fs/promises'; import os from 'node:os'; import path from 'node:path';
import { createNativeEngine } from '../src/engines/native/index.js';

const py = process.env.PYTHON_BIN || path.resolve('../engine/.venv/bin/python');
const pairsDir = process.argv[2] || await fs.mkdtemp(path.join(os.tmpdir(), 'ag-pairs-'));
if (!process.argv[2]) (await import('node:child_process')).execFileSync(py, [path.resolve('../engine/tests/generate_fixtures.py'), pairsDir], { stdio: 'ignore' });
const engine = createNativeEngine({ pythonBin: py });
const O = 'original.pdf';
// expect: verdict, and predicate on summary/warnings
const cases = [
  ['identical', O, 'no_differences_detected', (r) => r.summary.visualRegions === 0 && r.summary.textChanges === 0],
  ['changed_name', O, 'differences_found', (r) => r.summary.textChanges >= 1 && r.pairs[0].text.changes[0].original.includes('SHAMPOO')],
  ['changed_number', O, 'differences_found', (r) => r.pairs[0].text.changes.some((c) => c.original.includes('100') && c.revised.includes('1000'))],
  ['changed_date', O, 'differences_found', (r) => r.pairs[0].text.changes.some((c) => c.original.includes('2029') && c.revised.includes('2039'))],
  ['missing_warning', O, 'differences_found', (r) => r.summary.pagesAdded === 0 && r.summary.pagesRemoved === 0 && r.summary.wordsRemoved > 5],
  ['added_text', O, 'differences_found', (r) => r.summary.wordsAdded >= 1],
  ['graphic_colour_changed', O, 'differences_found', (r) => r.summary.textChanges === 0 && r.summary.visualRegions >= 1],
  ['graphic_moved', O, 'differences_found', (r) => r.summary.textChanges === 0 && r.summary.visualRegions >= 1],
  ['graphic_removed', O, 'differences_found', (r) => r.summary.textChanges === 0 && r.summary.visualRegions >= 1],
  ['tiny_colour_shift', O, 'no_differences_detected', () => true, 'standard: expected NOT detected (documented limit)'],
  ['extra_page', O, 'differences_found', (r) => r.summary.pagesAdded === 1 && r.pages.revised === 3],
  ['removed_page', O, 'differences_found', (r) => r.summary.pagesRemoved === 1],
  ['scan_changed_number', 'scan_original.pdf', 'differences_found', (r) => r.warnings.some((w) => w.code === 'NO_TEXT_LAYER') && r.summary.visualRegions >= 1],
];
const rows = [];
for (const [name, base, verdict, pred] of cases) {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-eval-'));
  const t0 = Date.now();
  const r = await engine.compare({ originalPath: path.join(pairsDir, base), revisedPath: path.join(pairsDir, name + '.pdf'), workDir: work });
  rows.push({ case: name, verdict: r.verdict, pg: `+${r.summary.pagesAdded}/-${r.summary.pagesRemoved}/~${r.summary.pagesChanged}`, txt: r.summary.textChanges, 'w+/w-': `${r.summary.wordsAdded}/${r.summary.wordsRemoved}`, visual: r.summary.visualRegions, warn: r.warnings.map((w) => w.code).join(',') || '-', ms: Date.now() - t0, PASS: r.verdict === verdict && pred(r) ? 'yes' : 'NO' });
  await fs.rm(work, { recursive: true, force: true });
}
// high-sensitivity check of the subtle shift
const w2 = await fs.mkdtemp(path.join(os.tmpdir(), 'ag-eval-'));
const hi = await engine.compare({ originalPath: path.join(pairsDir, O), revisedPath: path.join(pairsDir, 'tiny_colour_shift.pdf'), workDir: w2, options: { sensitivity: 'high' } });
rows.push({ case: 'tiny_colour_shift@high', verdict: hi.verdict, pg: '-', txt: hi.summary.textChanges, 'w+/w-': '-', visual: hi.summary.visualRegions, warn: '-', ms: '-', PASS: hi.verdict === 'differences_found' ? 'yes' : 'NO' });
await fs.rm(w2, { recursive: true, force: true });
console.table(rows);
process.exit(rows.some((r) => r.PASS === 'NO') ? 1 : 0);
