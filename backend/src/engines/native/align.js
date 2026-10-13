/**
 * Page alignment: global (Needleman–Wunsch style) alignment of page sequences by word-multiset similarity.
 * Output: ordered list of pairs [origIdx|null, revIdx|null].
 * Pages with no text on either side fall back to positional pairing (we cannot judge similarity).
 */
const MATCH_FLOOR = 0.2; // similarity below this is not worth matching

export function similarity(a, b) {
  if (!a.length && !b.length) return null; // unknown
  if (!a.length || !b.length) return 0;
  const m = new Map();
  for (const w of a) m.set(w, (m.get(w) || 0) + 1);
  let common = 0;
  for (const w of b) { const c = m.get(w); if (c) { common++; m.set(w, c - 1); } }
  return (2 * common) / (a.length + b.length);
}

export function alignPages(origWords, revWords) {
  const n = origWords.length, m = revWords.length;
  const anyText = origWords.some((p) => p.length) && revWords.some((p) => p.length);
  if (!anyText) return positional(n, m);

  const sim = Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => {
    const s = similarity(origWords[i], revWords[j]);
    return s === null ? (i === j ? 0.5 : 0) : s; // textless pair: prefer same index
  }));
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const back = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1)); // 1 diag, 2 up(del), 3 left(ins)
  for (let i = 1; i <= n; i++) back[i][0] = 2;
  for (let j = 1; j <= m; j++) back[0][j] = 3;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const diag = dp[i - 1][j - 1] + (sim[i - 1][j - 1] - MATCH_FLOOR);
      const up = dp[i - 1][j], left = dp[i][j - 1];
      if (diag >= up && diag >= left && sim[i - 1][j - 1] >= MATCH_FLOOR) { dp[i][j] = diag; back[i][j] = 1; }
      else if (up >= left) { dp[i][j] = up; back[i][j] = 2; }
      else { dp[i][j] = left; back[i][j] = 3; }
    }
  }
  const ops = []; let i = n, j = m;
  while (i > 0 || j > 0) {
    const b = back[i][j];
    if (b === 1) { ops.push([i - 1, j - 1]); i--; j--; }
    else if (b === 2) { ops.push([i - 1, null]); i--; }
    else { ops.push([null, j - 1]); j--; }
  }
  ops.reverse();
  return pairReplacedRuns(ops);
}

/** A run of deletions adjacent to a run of insertions is a rewritten page, not add+remove. */
function pairReplacedRuns(ops) {
  const out = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k][0] !== null && ops[k][1] !== null) { out.push(ops[k++]); continue; }
    const dels = [], ins = [];
    while (k < ops.length && (ops[k][0] === null || ops[k][1] === null)) {
      (ops[k][1] === null ? dels : ins).push(ops[k]); k++;
    }
    const pairs = Math.min(dels.length, ins.length);
    for (let t = 0; t < pairs; t++) out.push([dels[t][0], ins[t][1]]);
    for (let t = pairs; t < dels.length; t++) out.push(dels[t]);
    for (let t = pairs; t < ins.length; t++) out.push(ins[t]);
  }
  return out;
}

function positional(n, m) {
  const out = [];
  for (let i = 0; i < Math.max(n, m); i++) out.push([i < n ? i : null, i < m ? i : null]);
  return out;
}
