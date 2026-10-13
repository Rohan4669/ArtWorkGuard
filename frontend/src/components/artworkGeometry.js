/**
 * Geometry helpers that turn a page pair's text changes and visual regions into "focus items": one entry per
 * mistake, each carrying a highlight box for the ORIGINAL image and one for the REVISED image.
 *
 * All boxes are fractions (0..1) of the rendered page image. Visual regions are already expressed on the padded
 * canvas. Text boxes are expressed against each PDF's own page, so when the two page sizes differ they are
 * rescaled onto the padded canvas using the per-side pixel sizes reported by the engine.
 */

const CHANGE_LABEL = {
  added: 'Content added', removed: 'Content removed', changed: 'Content changed',
  colour_shift: 'Subtle colour shift', page_added: 'Whole page added', page_removed: 'Whole page removed',
};
const TEXT_LABEL = { replace: 'Changed', add: 'Added', delete: 'Deleted' };

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function toCanvas(box, side, visual) {
  if (!box) return null;
  const size = visual?.[`${side}SizePx`];
  const W = visual?.widthPx, H = visual?.heightPx;
  if (!size || !W || !H) return { x: box.x, y: box.y, w: box.w, h: box.h };
  return { x: (box.x * size.w) / W, y: (box.y * size.h) / H, w: (box.w * size.w) / W, h: (box.h * size.h) / H };
}

/** Pad tiny boxes (a single word is only a few pixels tall) so the highlight is always visible. */
export function padBox(b, { minW = 0.012, minH = 0.012, pad = 0.004 } = {}) {
  if (!b) return null;
  let { x, y, w, h } = b;
  x -= pad; y -= pad; w += pad * 2; h += pad * 2;
  if (w < minW) { x -= (minW - w) / 2; w = minW; }
  if (h < minH) { y -= (minH - h) / 2; h = minH; }
  x = clamp01(x); y = clamp01(y);
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

const excerpt = (s, n = 48) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s || '');

/**
 * @returns {Array<{id:string, kind:'text'|'visual', label:string, detail:string, boxes:{original:object|null, revised:object|null}}>}
 * A box with `ghost: true` marks "this is where the content is missing/was" on the side that lacks it.
 */
export function buildItems(pair) {
  const v = pair.visual || {};
  const items = [];
  (pair.text?.changes || []).forEach((c, i) => {
    const ob = toCanvas(c.originalBox, 'original', v), rb = toCanvas(c.revisedBox, 'revised', v);
    items.push({
      id: `t${i}`, kind: 'text', label: TEXT_LABEL[c.type] || 'Changed',
      detail: [c.original && `“${excerpt(c.original)}”`, c.original && c.revised && '→', c.revised && `“${excerpt(c.revised)}”`].filter(Boolean).join(' '),
      boxes: {
        original: ob ? padBox(ob) : rb ? { ...padBox(rb), ghost: true } : null,
        revised: rb ? padBox(rb) : ob ? { ...padBox(ob), ghost: true } : null,
      },
    });
  });
  (v.regions || []).forEach((r, j) => {
    const b = padBox({ x: r.x, y: r.y, w: r.w, h: r.h }, { pad: 0.002 });
    items.push({
      id: `v${j}`, kind: 'visual', label: `Region ${j + 1}`, detail: CHANGE_LABEL[r.change] || 'Visual difference',
      boxes: { original: b, revised: b },
    });
  });
  return items;
}

export const hasBox = (item) => Boolean(item.boxes.original || item.boxes.revised);