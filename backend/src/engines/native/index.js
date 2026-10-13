import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_IDS, buildChecks } from '../engine.interface.js';
import { extractDocument, inspectPdf } from './pdfText.js';
import { alignPages } from './align.js';
import { diffPageWords } from './textDiff.js';
import { runVisualWorker } from './visualRunner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_WORKER = path.resolve(here, '../../../../engine/visual_worker.py');

/**
 * "native" engine = PDF.js text extraction (Apache-2.0) + PDFium rendering and OpenCV pixel diff (Python worker).
 * Neither component is copyleft; see docs/LICENCES.md for the items that still need legal review.
 */
export function createNativeEngine({ pythonBin = 'python3', workerPath = DEFAULT_WORKER, timeoutMs = 120000, dpi = 150, targetLongSidePx = 4000, maxPixels = 20_000_000, sensitivity = 'standard', maxPages = 300 } = {}) {
  return {
    id: 'native-pdfjs-opencv',
    version: '1.1.0',
    licenceNotes: 'PDF.js (Apache-2.0), PDFium via pypdfium2 (BSD-3/Apache-2.0), OpenCV wheel (Apache-2.0; bundled FFmpeg is LGPL - legal review pending).',
    capabilities: {
      [CHECK_IDS.TEXT]: 'performed', [CHECK_IDS.PAGES]: 'performed', [CHECK_IDS.VISUAL]: 'performed',
    },

    inspect: (p) => inspectPdf(p),

    async compare({ originalPath, revisedPath, workDir, options = {}, signal }) {
      const [orig, rev] = [await extractDocument(originalPath, { maxPages }), await extractDocument(revisedPath, { maxPages })];
      const pairsIdx = alignPages(orig.map((p) => p.words.map((w) => w.text)), rev.map((p) => p.words.map((w) => w.text)));
      const warnings = [];
      const origText = orig.some((p) => p.words.length), revText = rev.some((p) => p.words.length);
      if (!origText || !revText) {
        warnings.push({ code: 'NO_TEXT_LAYER', message: `${!origText && !revText ? 'Neither document has' : !origText ? 'The original has' : 'The revised document has'} no extractable text (scanned or outlined artwork). Text comparison could not be performed for these pages; only the visual comparison applies, and it cannot read the text for you.` });
      }

      const visual = await runVisualWorker({
        pythonBin: options.pythonBin || pythonBin, workerPath, workDir, timeoutMs: options.timeoutMs || timeoutMs, signal,
        job: { original: originalPath, revised: revisedPath, pairs: pairsIdx, outDir: path.join(workDir, 'pages'), dpi: options.dpi || dpi, targetLongSidePx: options.targetLongSidePx || targetLongSidePx, maxPixels: options.maxPixels || maxPixels, sensitivity: options.sensitivity || sensitivity },
      });
      warnings.push(...visual.warnings);

      const pairs = pairsIdx.map(([oi, ri], idx) => {
        const v = visual.pages[idx];
        const ow = oi !== null ? orig[oi].words : [], rw = ri !== null ? rev[ri].words : [];
        const hasText = { original: ow.length > 0, revised: rw.length > 0 };
        const text = oi !== null && ri !== null ? diffPageWords(ow, rw) : { changes: [], wordsAdded: rw.length, wordsRemoved: ow.length };
        if (oi !== null && ri !== null && hasText.original !== hasText.revised) {
          warnings.push({ code: 'TEXT_LAYER_MISMATCH', pairIndex: idx, message: `Page pair ${idx + 1}: only one side has a text layer; text differences cannot be listed reliably.` });
        }
        const status = oi === null ? 'added' : ri === null ? 'removed' : (text.changes.length || v.changed) ? 'changed' : 'identical';
        return {
          pairIndex: idx, originalPage: oi === null ? null : oi + 1, revisedPage: ri === null ? null : ri + 1, status,
          textAvailable: hasText,
          text: { changes: text.changes, wordsAdded: text.wordsAdded, wordsRemoved: text.wordsRemoved },
          visual: { regions: v.regions, diffPixelRatio: v.diffPixelRatio, pageSizeMismatch: v.pageSizeMismatch, images: v.images, dpi: v.dpi, widthPx: v.widthPx, heightPx: v.heightPx, originalSizePx: v.originalSizePx, revisedSizePx: v.revisedSizePx },
        };
      });

      const sum = {
        pagesAdded: pairs.filter((p) => p.status === 'added').length,
        pagesRemoved: pairs.filter((p) => p.status === 'removed').length,
        pagesChanged: pairs.filter((p) => p.status === 'changed').length,
        textChanges: pairs.reduce((n, p) => n + p.text.changes.length, 0),
        wordsAdded: pairs.reduce((n, p) => n + p.text.wordsAdded, 0),
        wordsRemoved: pairs.reduce((n, p) => n + p.text.wordsRemoved, 0),
        visualRegions: pairs.reduce((n, p) => n + p.visual.regions.length, 0),
      };
      const differencesFound = pairs.some((p) => p.status !== 'identical');
      return {
        engine: { id: this.id, version: this.version, components: { worker: visual.worker, pdfjs: 'pdfjs-dist' }, dpi: visual.dpi, dpiMax: visual.dpiMax, sensitivity: visual.sensitivity },
        pages: { original: orig.length, revised: rev.length },
        verdict: differencesFound ? 'differences_found' : 'no_differences_detected', // never "error free"
        summary: sum, pairs, warnings,
        checks: buildChecks(this.capabilities, {
          [CHECK_IDS.VISUAL]: 'Pixel comparison of rendered pages. Detects visible changes; it does not identify what the change is.',
          [CHECK_IDS.TEXT]: origText && revText ? null : 'Not possible on pages without a text layer.',
        }),
      };
    },
  };
}