/**
 * Comparison-engine contract.
 *
 * Every engine registered in ./index.js must implement:
 *
 *   id            string   stable identifier stored on each ComparisonJob
 *   version       string   engine/component version string
 *   licenceNotes  string   human-readable licence status shown in /api/system/engine
 *   capabilities  object   which checks the engine genuinely performs (see CHECK_IDS)
 *   async inspect(pdfPath, { signal })            -> InspectResult
 *   async compare({ originalPath, revisedPath, workDir, options, signal }) -> ComparisonResult
 *
 * InspectResult  { pageCount, pages:[{width,height}], encrypted:false, hasTextLayer, textPages, warnings:[] }
 *   - must throw EngineError('PDF_ENCRYPTED' | 'PDF_CORRUPT' | ...) for unusable files.
 *
 * ComparisonResult is the engine-agnostic structure persisted on ComparisonJob.result and rendered by the UI.
 * Engines MUST NOT report a check as performed unless it ran, and MUST NOT report "no differences" for a check
 * that could not run (e.g. text comparison on a scan).  Image files named in `pairs[].visual.images` are
 * relative to `workDir`.
 */

export const CHECK_IDS = Object.freeze({
  TEXT: 'text',
  PAGES: 'pages',
  VISUAL: 'visual',
  FONTS: 'fonts',
  COLOUR_SPOT: 'colour_spot',
  BARCODE: 'barcode',
  OVERPRINT: 'overprint',
  DIELINE_BLEED: 'dieline_bleed',
  OCR: 'ocr',
});

export class EngineError extends Error {
  constructor(code, message, { retryable = false, details } = {}) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }
}

export function assertEngine(engine) {
  for (const k of ['id', 'version', 'capabilities']) {
    if (engine[k] === undefined) throw new Error(`Engine is missing "${k}"`);
  }
  for (const m of ['inspect', 'compare']) {
    if (typeof engine[m] !== 'function') throw new Error(`Engine "${engine.id}" is missing ${m}()`);
  }
  return engine;
}

/** Build the standard "checks" list from capabilities so unsupported checks are always disclosed. */
export function buildChecks(capabilities, notes = {}) {
  const meta = {
    [CHECK_IDS.TEXT]: 'Text content comparison',
    [CHECK_IDS.PAGES]: 'Page count / page alignment',
    [CHECK_IDS.VISUAL]: 'Rendered-page visual difference',
    [CHECK_IDS.FONTS]: 'Font substitution / embedding',
    [CHECK_IDS.COLOUR_SPOT]: 'CMYK / spot-colour value verification',
    [CHECK_IDS.BARCODE]: 'Barcode decoding and validation',
    [CHECK_IDS.OVERPRINT]: 'Overprint settings',
    [CHECK_IDS.DIELINE_BLEED]: 'Dieline, bleed and trim verification',
    [CHECK_IDS.OCR]: 'OCR of scanned / outlined text',
  };
  return Object.values(CHECK_IDS).map((id) => ({
    id,
    name: meta[id],
    status: capabilities[id] || 'not_performed', // 'performed' | 'limited' | 'not_performed'
    note: notes[id] || null,
  }));
}
