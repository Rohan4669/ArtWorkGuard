import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ListChecks, Maximize, X, ZoomIn, ZoomOut } from 'lucide-react';
import { hasBox } from './artworkGeometry.js';

const MAX_SCALE = 4; // 4 image pixels per screen pixel is already far beyond what the eye needs
const SIDE = {
  original: { label: 'ORIGINAL — differences in red', chip: 'bg-red-600/90 text-white' },
  revised: { label: 'REVISED — differences in green', chip: 'bg-green-600/90 text-white' },
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** The pulsing frame drawn around the selected mistake. Positioned in % so it follows any zoom level. */
export function FocusBox({ box, scale = 1, dim = true }) {
  if (!box) return null;
  const bw = Math.max(2, 3 / scale);
  return (
    <div
      aria-hidden
      className="ag-focus pointer-events-none absolute"
      style={{
        left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
        border: `${bw}px ${box.ghost ? 'dashed' : 'solid'} ${box.ghost ? '#f59e0b' : '#facc15'}`,
        borderRadius: 3,
        boxShadow: dim ? '0 0 0 100vmax rgba(2,6,23,.42)' : 'none',
      }}
    />
  );
}

/**
 * Full-screen artwork viewer.
 * - wheel / pinch-style buttons zoom around the cursor, drag pans, double-click zooms in
 * - "Side by side" keeps both panes on one shared pan/zoom so the same spot is always compared
 * - the list on the right (and the ←/→ keys) jumps between mistakes and centres the highlight
 */
export default function ArtworkLightbox({ urls, items, focusId, onFocus, initialSide = 'original', title, size, onClose }) {
  const firstSide = initialSide === 'both' ? (urls.original && urls.revised ? 'both' : urls.original ? 'original' : 'revised') : urls[initialSide] ? initialSide : urls.original ? 'original' : 'revised';
  const [mode, setMode] = useState(firstSide);
  const [panel, setPanel] = useState(true);
  const [manual, setManual] = useState(null); // user-driven view; null = derive from selection / fit
  const [smooth, setSmooth] = useState(false);
  const [loaded, setLoaded] = useState(null);
  const [pane, setPane] = useState({ w: 0, h: 0 });
  const stageRef = useRef(null), paneRef = useRef(null), drag = useRef(null), viewRef = useRef(null), listRef = useRef(null);

  const dims = size?.w && size?.h ? size : loaded;
  const navigable = useMemo(() => items.filter(hasBox), [items]);
  const focusItem = items.find((i) => i.id === focusId) || null;
  const index = navigable.findIndex((i) => i.id === focusId);
  const sides = mode === 'both' ? ['original', 'revised'] : [mode];

  // Pane size (both panes are laid out identically, so measuring one is enough).
  useEffect(() => {
    const el = paneRef.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setPane({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, [mode, panel]);

  const ready = Boolean(dims && pane.w && pane.h);
  const fitScale = ready ? Math.min(pane.w / dims.w, pane.h / dims.h) : 1;
  const maxScale = Math.max(MAX_SCALE, fitScale);
  const fitView = { s: fitScale, x: ready ? (pane.w - dims.w * fitScale) / 2 : 0, y: ready ? (pane.h - dims.h * fitScale) / 2 : 0 };

  function viewFor(item) {
    const box = item?.boxes.original && !item.boxes.original.ghost ? item.boxes.original : item?.boxes.revised || item?.boxes.original;
    if (!box || !ready) return null;
    const bw = box.w * dims.w, bh = box.h * dims.h;
    const s = clamp(Math.min((pane.w * 0.5) / bw, (pane.h * 0.5) / bh), fitScale, maxScale);
    return { s, x: pane.w / 2 - (box.x + box.w / 2) * dims.w * s, y: pane.h / 2 - (box.y + box.h / 2) * dims.h * s };
  }
  const view = manual || viewFor(focusItem) || fitView;
  useEffect(() => { viewRef.current = view; }); // handlers read the latest view without re-binding

  function select(item) { setManual(null); setSmooth(true); onFocus(item.id); }
  function step(dir) {
    if (!navigable.length) return;
    const next = navigable[index < 0 ? (dir > 0 ? 0 : navigable.length - 1) : (index + dir + navigable.length) % navigable.length];
    select(next);
  }
  function zoomAt(cx, cy, factor, animate = false) {
    const v = viewRef.current, s = clamp(v.s * factor, fitScale, maxScale), k = s / v.s;
    setSmooth(animate); setManual({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  }
  const zoomCentre = (f) => zoomAt(pane.w / 2, pane.h / 2, f, true);

  // Wheel must be a non-passive native listener to stop the page behind from scrolling.
  useEffect(() => {
    const el = stageRef.current; if (!el) return undefined;
    const onWheel = (e) => {
      const p = e.target.closest?.('[data-pane]'); if (!p) return;
      e.preventDefault();
      const r = p.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoomCentre(1.4);
      else if (e.key === '-') zoomCentre(1 / 1.4);
      else if (e.key === '0') { setSmooth(true); setManual(fitView); }
      else if (e.key === 'ArrowRight' || e.key === ']') step(1);
      else if (e.key === 'ArrowLeft' || e.key === '[') step(-1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { // lock page scroll behind the overlay
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => { listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [focusId, panel]);

  // Pointer: drag pans; a click without movement selects the mistake under the cursor.
  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, v: viewRef.current, moved: false };
  }
  function onPointerMove(e) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.px, dy = e.clientY - d.py;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true; setSmooth(false); setManual({ ...d.v, x: d.v.x + dx, y: d.v.y + dy });
  }
  function onPointerUp(e, side) {
    const d = drag.current; drag.current = null;
    if (!d || d.moved || !ready) return;
    const r = e.currentTarget.getBoundingClientRect(), v = viewRef.current;
    const fx = (e.clientX - r.left - v.x) / v.s / dims.w, fy = (e.clientY - r.top - v.y) / v.s / dims.h;
    const hit = navigable.filter((i) => { const b = i.boxes[side]; return b && fx >= b.x && fx <= b.x + b.w && fy >= b.y && fy <= b.y + b.h; })
      .sort((a, b) => a.boxes[side].w * a.boxes[side].h - b.boxes[side].w * b.boxes[side].h)[0];
    if (hit) select(hit);
  }

  const zoomPct = Math.round((view.s / fitScale) * 100);
  const btn = 'inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-white/20 bg-white/10 px-2 text-sm text-white hover:bg-white/20 disabled:opacity-40';

  return (
    <div role="dialog" aria-modal="true" aria-label={`Full screen artwork: ${title}`} className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <p className="mr-2 truncate text-sm font-semibold">{title}</p>
        <div role="group" aria-label="View" className="flex gap-1">
          {[['original', 'Original', urls.original], ['revised', 'Revised', urls.revised], ['both', 'Side by side', urls.original && urls.revised]].map(([k, l, ok]) => (
            <button key={k} disabled={!ok} aria-pressed={mode === k} className={`${btn} ${mode === k ? '!bg-white !text-slate-900' : ''}`} onClick={() => { setMode(k); setManual(null); setSmooth(false); }}>{l}</button>))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <button className={btn} aria-label="Previous mistake" disabled={!navigable.length} onClick={() => step(-1)}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-16 text-center text-xs tabular-nums text-slate-300">{navigable.length ? `${index < 0 ? '–' : index + 1} / ${navigable.length}` : 'No marks'}</span>
          <button className={btn} aria-label="Next mistake" disabled={!navigable.length} onClick={() => step(1)}><ChevronRight className="h-4 w-4" /></button>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <button className={btn} aria-label="Zoom out" onClick={() => zoomCentre(1 / 1.4)}><ZoomOut className="h-4 w-4" /></button>
          <span className="w-12 text-center text-xs tabular-nums text-slate-300">{zoomPct}%</span>
          <button className={btn} aria-label="Zoom in" onClick={() => zoomCentre(1.4)}><ZoomIn className="h-4 w-4" /></button>
          <button className={btn} onClick={() => { setSmooth(true); setManual(fitView); }}><Maximize className="h-4 w-4" />Fit</button>
          <button className={btn} aria-pressed={panel} aria-label="Toggle list of mistakes" onClick={() => setPanel((p) => !p)}><ListChecks className="h-4 w-4" /></button>
          <button className={btn} autoFocus aria-label="Close full screen" onClick={onClose}><X className="h-4 w-4" />Close</button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={stageRef} className="flex min-w-0 flex-1 gap-px bg-slate-800">
          {sides.map((side, n) => (
            <div key={side} data-pane={side} ref={n === 0 ? paneRef : undefined} className="relative min-w-0 flex-1 cursor-grab touch-none select-none overflow-hidden bg-slate-900 active:cursor-grabbing"
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => onPointerUp(e, side)} onPointerCancel={() => { drag.current = null; }}
              onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 2, true); }}>
              <span className={`pointer-events-none absolute left-2 top-2 z-10 rounded px-2 py-0.5 text-xs font-semibold shadow ${SIDE[side].chip}`}>{SIDE[side].label}</span>
              {!urls[side] ? <p className="grid h-full place-items-center text-sm text-slate-400">No page on this side</p> : (
                <>
                  {!dims && <img alt="" src={urls[side]} className="hidden" onLoad={(e) => setLoaded({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />}
                  {!ready && <p className="grid h-full place-items-center text-sm text-slate-400">Loading artwork…</p>}
                  {dims && (
                    <div className="absolute left-0 top-0 overflow-hidden bg-white" style={{ width: dims.w, height: dims.h, transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transition: smooth ? 'transform .28s ease' : 'none', willChange: 'transform', visibility: ready ? 'visible' : 'hidden' }}>
                      <img alt={`${side} artwork`} src={urls[side]} draggable={false} width={dims.w} height={dims.h} style={{ display: 'block', width: '100%', height: '100%' }} />
                      <FocusBox box={focusItem?.boxes[side]} scale={view.s} />
                    </div>)}
                </>)}
            </div>))}
        </div>

        {panel && (
          <aside aria-label="Mistakes on this page" className="hidden w-80 shrink-0 flex-col border-l border-white/10 bg-slate-950 sm:flex">
            <p className="border-b border-white/10 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Mistakes on this page ({navigable.length})</p>
            <ul ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-auto p-2">
              {navigable.length === 0 && <li className="p-2 text-sm text-slate-400">Nothing was flagged on this page.</li>}
              {navigable.map((i) => (
                <li key={i.id}>
                  <button aria-current={i.id === focusId} onClick={() => select(i)} className={`w-full rounded-md border px-3 py-2 text-left text-sm ${i.id === focusId ? 'border-yellow-400 bg-yellow-400/10' : 'border-white/10 hover:bg-white/5'}`}>
                    <span className="text-xs font-semibold text-yellow-300">{i.kind === 'text' ? 'Text' : 'Visual'} · {i.label}</span>
                    <span className="mt-0.5 block break-words text-slate-200">{i.detail}</span>
                  </button>
                </li>))}
            </ul>
            <p className="border-t border-white/10 px-3 py-2 text-[11px] leading-snug text-slate-400">Scroll to zoom · drag to pan · double-click to zoom in · click a marked area or use ← → to jump between mistakes · Esc to close</p>
          </aside>)}
      </div>
    </div>
  );
}