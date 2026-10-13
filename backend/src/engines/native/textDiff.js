import { diffArrays } from 'diff';

const union = (ws) => {
  if (!ws.length) return null;
  const x0 = Math.min(...ws.map((w) => w.x)), y0 = Math.min(...ws.map((w) => w.y));
  const x1 = Math.max(...ws.map((w) => w.x + w.w)), y1 = Math.max(...ws.map((w) => w.y + w.h));
  return { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) };
};
const round = (n) => Math.round(n * 1e5) / 1e5;

/**
 * Word-level diff of one aligned page pair. Adjacent removed+added hunks are merged into one "replace" change
 * so the reviewer sees "100 -> 1000" rather than two unrelated entries.
 * Hunks separated by only a couple of unchanged words (e.g. a rewritten paragraph where "and" or "flavor" happens
 * to survive) are merged too, so one edited sentence is one change with one highlight instead of five fragments.
 * Text excerpts are capped to keep stored results small.
 */
export function diffPageWords(origWords, revWords, { maxExcerpt = 240, mergeGap = 2, minWords = 3 } = {}) {
  const parts = diffArrays(origWords.map((w) => w.text), revWords.map((w) => w.text));
  const hunks = [];
  let oi = 0, ri = 0, wordsAdded = 0, wordsRemoved = 0, midO = [], midR = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k];
    if (!p.added && !p.removed) { midO = origWords.slice(oi, oi + p.count); midR = revWords.slice(ri, ri + p.count); oi += p.count; ri += p.count; continue; }
    let removed = [], added = [];
    while (k < parts.length && (parts[k].added || parts[k].removed)) {
      if (parts[k].removed) { removed = removed.concat(origWords.slice(oi, oi + parts[k].count)); oi += parts[k].count; }
      else { added = added.concat(revWords.slice(ri, ri + parts[k].count)); ri += parts[k].count; }
      k++;
    }
    k--;
    wordsAdded += added.length; wordsRemoved += removed.length;
    const prev = hunks[hunks.length - 1];
    // Only bridge short gaps, and only when the hunks are neighbours (a gap of 0 cannot happen: diff already joined them).
    const size = (h) => Math.max(h.removed.length, h.added.length);
    // Only bridge two substantial hunks: isolated values/headings ("526.39 -> 516.56") must stay separate.
    if (prev && midO.length > 0 && midO.length <= mergeGap && prev.touched && size(prev) >= minWords && Math.max(removed.length, added.length) >= minWords) {
      prev.removed = prev.removed.concat(midO, removed); prev.added = prev.added.concat(midR, added);
    } else {
      hunks.push({ removed, added, touched: true });
    }
    midO = []; midR = [];
    // A long unchanged run closes the previous hunk for bridging.
    const next = parts[k + 1];
    if (next && !next.added && !next.removed && next.count > mergeGap) hunks[hunks.length - 1].touched = false;
  }
  const clip = (ws) => ws.map((w) => w.text).join(' ').slice(0, maxExcerpt);
  const changes = hunks.map(({ removed, added }) => ({
    type: removed.length && added.length ? 'replace' : added.length ? 'add' : 'delete',
    original: clip(removed), revised: clip(added),
    originalBox: union(removed), revisedBox: union(added),
  }));
  return { changes, wordsAdded, wordsRemoved };
}