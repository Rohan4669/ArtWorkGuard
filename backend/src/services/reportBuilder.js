import PDFDocument from 'pdfkit';

// pdfkit's built-in Helvetica is WinAnsi only. Characters outside it are replaced and flagged, not silently dropped.
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const safe = (s = '') => {
  let replaced = false;
  const out = [...String(s)].map((ch) => { const c = ch.codePointAt(0); if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WINANSI_EXTRA.has(ch)) return ch; replaced = true; return c === 10 ? ' ' : '\u00bf'; }).join('');
  return { text: out, replaced };
};

const COL = { ink: '#111827', mute: '#6b7280', line: '#e5e7eb', red: '#b91c1c', green: '#15803d', amber: '#b45309', brand: '#1d4ed8' };
const STATUS_LABEL = { added: 'Page added', removed: 'Page removed', changed: 'Changed', identical: 'Identical' };

/**
 * Builds the comparison report PDF. Page images are read through `readImage(side, pair)` so this module has no
 * knowledge of storage. Returns a Buffer.
 */
export async function buildReportPdf({ appName, job, project, originalFile, revisedFile, result, readImage }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${appName} comparison report`, Author: appName }, bufferPages: true });
  const chunks = []; doc.on('data', (c) => chunks.push(c));
  const done = new Promise((r) => doc.on('end', r));
  let anyReplaced = false;
  const T = (s) => { const r = safe(s); anyReplaced ||= r.replaced; return r.text; };
  const W = doc.page.width - 80;

  doc.fillColor(COL.brand).fontSize(9).text(T(appName.toUpperCase()), { characterSpacing: 1 });
  doc.fillColor(COL.ink).fontSize(20).text('Artwork Comparison Report');
  doc.moveDown(0.3).fontSize(9).fillColor(COL.mute).text(`Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC  ·  Comparison ${job._id}`);
  doc.moveDown(0.8);

  const kv = (k, v) => { doc.fontSize(9).fillColor(COL.mute).text(k, { continued: true, width: W }).fillColor(COL.ink).text(`  ${T(v ?? '-')}`); };
  kv('Project', project.name);
  if (project.clientName) kv('Client', project.clientName);
  if (project.productName) kv('Product', project.productName);
  if (project.reference) kv('Reference', project.reference);
  kv('Original client artwork', `${originalFile.originalFilename} (${result.pages.original} page${result.pages.original === 1 ? '' : 's'})`);
  kv('Revised designer artwork', `${revisedFile.originalFilename} (${result.pages.revised} page${result.pages.revised === 1 ? '' : 's'})`);
  kv('Engine', `${result.engine.id} v${result.engine.version}`);
  doc.moveDown(0.8);

  // Verdict banner — deliberately never says "approved" or "error free".
  const found = result.verdict === 'differences_found';
  const bannerY = doc.y;
  doc.roundedRect(40, bannerY, W, 52, 4).fill(found ? '#fef3c7' : '#f3f4f6');
  doc.fillColor(found ? COL.amber : COL.ink).fontSize(12).text(found ? 'Differences detected - manual review required' : 'No differences were detected by the checks that ran', 52, bannerY + 9, { width: W - 24 });
  doc.fontSize(8.5).fillColor(COL.ink).text(found ? 'Review every marked change against the client brief before release.' : 'This is NOT a confirmation that the artwork is correct. Checks not performed are listed below.', 52, doc.y + 2, { width: W - 24 });
  doc.y = bannerY + 64; doc.x = 40;

  const s = result.summary;
  doc.fontSize(11).fillColor(COL.ink).text('Summary').moveDown(0.3);
  [['Pages added', s.pagesAdded], ['Pages removed', s.pagesRemoved], ['Pages with changes', s.pagesChanged], ['Text changes', s.textChanges], ['Words added / removed', `${s.wordsAdded} / ${s.wordsRemoved}`], ['Visual difference regions', s.visualRegions]]
    .forEach(([k, v]) => kv(k, String(v)));
  doc.moveDown(0.6);

  doc.fontSize(11).fillColor(COL.ink).text('Checks').moveDown(0.3);
  for (const c of result.checks) {
    const col = c.status === 'performed' ? COL.green : c.status === 'limited' ? COL.amber : COL.red;
    doc.fontSize(9).fillColor(col).text(c.status === 'performed' ? 'PERFORMED  ' : c.status === 'limited' ? 'LIMITED  ' : 'NOT PERFORMED  ', { continued: true, width: W }).fillColor(COL.ink).text(T(c.name + (c.note ? ` - ${c.note}` : '')));
  }
  if (result.warnings?.length) {
    doc.moveDown(0.6).fontSize(11).fillColor(COL.ink).text('Warnings').moveDown(0.3);
    for (const w of result.warnings) doc.fontSize(9).fillColor(COL.amber).text(`! ${T(w.message)}`, { width: W });
  }

  const changedPairs = result.pairs.filter((p) => p.status !== 'identical');
  for (const p of changedPairs) {
    doc.addPage();
    doc.fontSize(13).fillColor(COL.ink).text(`${STATUS_LABEL[p.status]}: original page ${p.originalPage ?? '-'}  ↔  revised page ${p.revisedPage ?? '-'}`.replace('↔', '<->'));
    doc.moveDown(0.4);
    if (p.text.changes.length) {
      doc.fontSize(10).fillColor(COL.ink).text('Text changes');
      for (const c of p.text.changes.slice(0, 25)) {
        doc.fontSize(9).fillColor(COL.red).text(`- ${T(c.original) || '(nothing)'}`, { width: W, continued: false });
        doc.fillColor(COL.green).text(`+ ${T(c.revised) || '(nothing)'}`, { width: W });
        doc.moveDown(0.15);
      }
      if (p.text.changes.length > 25) doc.fontSize(8).fillColor(COL.mute).text(`... and ${p.text.changes.length - 25} more text changes (see the on-screen results).`);
    } else if (p.textAvailable.original && p.textAvailable.revised) doc.fontSize(9).fillColor(COL.mute).text('No text changes detected on this page pair; the difference is visual only.');
    else doc.fontSize(9).fillColor(COL.amber).text('Text could not be compared for this page pair (no text layer on at least one side).');
    doc.moveDown(0.5);

    const imgW = (W - 12) / 2, top = doc.y;
    doc.fontSize(8).fillColor(COL.red).text('ORIGINAL (changes in red)', 40, top, { width: imgW });
    doc.fillColor(COL.green).text('REVISED (changes in green)', 40 + imgW + 12, top, { width: imgW });
    for (const [i, side] of ['original', 'revised'].entries()) {
      const buf = p.visual.images[side] ? await readImage(side, p) : null;
      const x = 40 + i * (imgW + 12);
      if (buf) { doc.rect(x, top + 12, imgW, 0).stroke(COL.line); doc.image(buf, x, top + 14, { fit: [imgW, 520], align: 'center' }); }
      else doc.fontSize(9).fillColor(COL.mute).text(side === 'original' ? 'No page on the original side' : 'No page on the revised side', x, top + 14, { width: imgW });
    }
  }

  doc.addPage();
  doc.fontSize(13).fillColor(COL.ink).text('Limitations of this comparison');
  doc.moveDown(0.4).fontSize(9).fillColor(COL.ink);
  [
    'This report compares text content and the rendered appearance of aligned pages. It is an aid to a human proofing process, not a replacement for it.',
    'It does not verify CMYK or spot-colour values, overprint, barcode correctness or readability, dielines, bleed and trim, or font substitution.',
    'Scanned or outlined artwork has no text layer: text changes there are only visible as pixel differences and are not read.',
    'Very small or very low-contrast visual changes may fall below the detection sensitivity. Verify critical content (net quantity, claims, warnings, legal text, codes) manually.',
    `Page images were rendered at ${result.engine.dpi}${result.engine.dpiMax && result.engine.dpiMax !== result.engine.dpi ? `–${result.engine.dpiMax}` : ''} dpi with "${result.engine.sensitivity}" sensitivity.`,
    anyReplaced ? 'Some characters outside the Latin-1 range could not be printed in this PDF and appear as "\u00bf". Use the on-screen results for exact text.' : null,
  ].filter(Boolean).forEach((t) => doc.text(`•  ${T(t)}`, { width: W }).moveDown(0.4));

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // otherwise text below the bottom margin makes pdfkit append a blank page per footer
    doc.fontSize(8).fillColor(COL.mute).text(`${T(appName)} · Page ${i + 1} of ${range.count}`, 40, doc.page.height - 30, { width: W, align: 'center', lineBreak: false });
  }
  doc.end(); await done;
  return Buffer.concat(chunks);
}