import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { EngineError } from '../engine.interface.js';

// pdf.js (Apache-2.0). The "legacy" build runs on Node without DOM shims for text extraction.
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = pathToFileURL(path.join(pdfjsRoot, 'standard_fonts') + path.sep).href;

export async function openPdf(filePath) {
  const data = new Uint8Array(await fs.readFile(filePath));
  const task = pdfjs.getDocument({
    data,
    isEvalSupported: false, // never eval font programs from untrusted PDFs
    useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    doc.__task = task; // pdf.js v6: teardown happens via the loading task
    return doc;
  } catch (err) {
    const name = err?.name || '';
    if (name === 'PasswordException') throw new EngineError('PDF_ENCRYPTED', 'The PDF is password-protected.');
    if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'MissingPDFException') {
      throw new EngineError('PDF_CORRUPT', 'The PDF is corrupted or unreadable.');
    }
    throw new EngineError('PDF_UNREADABLE', 'The PDF could not be opened.', { details: name });
  }
}

const NORM = (s) => s.normalize('NFKC');

/**
 * Extract words with normalised bounding boxes (0..1, origin top-left) for one page.
 * Words are returned in a deterministic reading order (top→bottom, left→right) so that
 * changes in content-stream order (e.g. layer reshuffling) do not create false differences.
 */
export async function closePdf(doc) { await (doc.__task ? doc.__task.destroy() : doc.cleanup?.()); }

export async function extractPageWords(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const vp = page.getViewport({ scale: 1 });
  const content = await page.getTextContent({ includeMarkedContent: false });
  const words = [];
  const segs = []; // one segment per PDF text run: used to group words into blocks (columns / paragraphs)
  for (const item of content.items) {
    if (!item.str || !item.str.trim()) continue;
    const [a, b, , , e, f] = item.transform;
    const fontH = Math.hypot(a, b) || item.height || 10;
    const total = item.str.length || 1;
    const widthPt = item.width || fontH * 0.5 * total;
    const seg = { x0: e, x1: e + widthPt, base: f, fontH, words: [] };
    const re = /\S+/g;
    let m;
    while ((m = re.exec(item.str))) {
      const x0 = e + (widthPt * m.index) / total;
      const x1 = e + (widthPt * (m.index + m[0].length)) / total;
      const yTop = vp.height - (f + fontH); // flip PDF y-up to top-left origin
      const w = {
        text: NORM(m[0]),
        x: Math.max(0, x0 / vp.width), y: Math.max(0, yTop / vp.height),
        w: Math.min(1, (x1 - x0) / vp.width), h: Math.min(1, (fontH * 1.15) / vp.height),
        _line: f,
      };
      words.push(w); seg.words.push(w);
    }
    segs.push(seg);
  }
  const ordered = orderByBlocks(segs, words) ?? orderByBaseline(words, vp.height);
  words.length = 0; words.push(...ordered);
  words.forEach((w) => { delete w._line; });
  page.cleanup();
  return { words, width: vp.width, height: vp.height };
}


/** Fallback ordering: cluster by baseline (tolerance 40% of median font height), then x. */
function orderByBaseline(words, pageH) {
  const out = [...words].sort((p, q) => q._line - p._line || p.x - q.x);
  const tol = 0.4 * (median(out.map((w) => w.h)) * pageH || 6);
  let line = 0, last = null;
  for (const w of out) {
    if (last !== null && Math.abs(last - w._line) > tol) line++;
    last = w._line; w._ln = line;
  }
  out.sort((p, q) => p._ln - q._ln || p.x - q.x);
  out.forEach((w) => { delete w._ln; });
  return out;
}

const MAX_BLOCK_SEGMENTS = 6000; // O(n^2) grouping; beyond this fall back to plain baseline order

/**
 * Block-aware reading order. Packaging artwork is laid out in columns and boxes (nutrition table, claims panel,
 * paragraph...). Sorting by baseline alone interleaves those columns line-by-line, so one edited paragraph produces
 * "changes" that stitch together words from unrelated panels. Here text runs are first merged into blocks, then each
 * block is read top-to-bottom, left-to-right on its own. Blocks are visited in coarse top-to-bottom bands, left to right,
 * which is deterministic for two versions of the same layout.
 */
export function orderByBlocks(segs, words) {
  const n = segs.length;
  if (n === 0 || n > MAX_BLOCK_SEGMENTS) return null;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };

  for (let i = 0; i < n; i++) {
    const A = segs[i];
    for (let j = i + 1; j < n; j++) {
      const B = segs[j];
      const fh = Math.max(A.fontH, B.fontH), dy = Math.abs(A.base - B.base);
      const gapX = Math.max(A.x0, B.x0) - Math.min(A.x1, B.x1); // < 0 when the runs overlap horizontally
      if (dy <= 0.4 * fh) { // same line: join only when the gap is word-sized, not a column gutter
        if (gapX <= 1.2 * fh && Math.abs(A.fontH - B.fontH) <= 0.35 * fh) union(i, j);
      } else if (dy <= 2.2 * fh && gapX < 0 && Math.abs(A.fontH - B.fontH) <= 0.35 * fh) { // stacked lines of one paragraph
        const overlap = -gapX, narrow = Math.min(A.x1 - A.x0, B.x1 - B.x0) || 1;
        if (overlap / narrow >= 0.4) union(i, j);
      }
    }
  }

  const blocks = new Map();
  segs.forEach((sg, i) => {
    const r = find(i);
    if (!blocks.has(r)) blocks.set(r, { segs: [], top: -Infinity, left: Infinity, fh: 0 });
    const bl = blocks.get(r); bl.segs.push(sg); bl.top = Math.max(bl.top, sg.base + sg.fontH); bl.left = Math.min(bl.left, sg.x0); bl.fh = Math.max(bl.fh, sg.fontH);
  });
  const list = [...blocks.values()];
  const band = 4 * (median(list.map((b) => b.fh)) || 8);
  list.sort((p, q) => Math.round(q.top / band) - Math.round(p.top / band) || p.left - q.left || q.top - p.top);

  const out = [];
  for (const bl of list) {
    const ws = bl.segs.flatMap((sg) => sg.words);
    const tol = 0.4 * bl.fh;
    ws.sort((p, q) => q._line - p._line);
    let line = 0, last = null;
    for (const w of ws) { if (last !== null && Math.abs(last - w._line) > tol) line++; last = w._line; w._ln = line; }
    ws.sort((p, q) => p._ln - q._ln || p.x - q.x);
    ws.forEach((w) => { delete w._ln; });
    out.push(...ws);
  }
  return out.length === words.length ? out : null;
}

function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

/** Extract all pages. Page text is read sequentially to keep memory bounded. */
export async function extractDocument(filePath, { maxPages = 500 } = {}) {
  const doc = await openPdf(filePath);
  try {
    if (doc.numPages > maxPages) throw new EngineError('PDF_TOO_MANY_PAGES', `PDF has more than ${maxPages} pages.`);
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push(await extractPageWords(doc, i));
    return pages;
  } finally {
    await closePdf(doc);
  }
}

/** Lightweight inspection used at upload time (no word boxes retained). */
export async function inspectPdf(filePath) {
  const doc = await openPdf(filePath);
  try {
    const pages = []; let textPages = 0;
    const warnings = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      const tc = await p.getTextContent();
      const hasText = tc.items.some((it) => it.str && it.str.trim());
      if (hasText) textPages++;
      pages.push({ width: Math.round(vp.width * 100) / 100, height: Math.round(vp.height * 100) / 100, hasText });
      p.cleanup();
    }
    if (doc.numPages === 0) throw new EngineError('PDF_EMPTY', 'The PDF has no pages.');
    if (textPages === 0) {
      warnings.push({ code: 'NO_TEXT_LAYER', message: 'No extractable text was found (scanned or outlined artwork). Text comparison will not work; only visual comparison applies.' });
    } else if (textPages < doc.numPages) {
      warnings.push({ code: 'PARTIAL_TEXT_LAYER', message: `${doc.numPages - textPages} of ${doc.numPages} page(s) have no extractable text.` });
    }
    return { pageCount: doc.numPages, pages, textPages, hasTextLayer: textPages > 0, warnings };
  } finally {
    await closePdf(doc);
  }
}